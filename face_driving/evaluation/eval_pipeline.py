"""
Emotion 模型评测流程 — 生成预测 + 官方协议评测一键脚本

用法:
    # 完整流程（生成预测 + 评测）
    python -m face_driving.evaluation.eval_pipeline \
        --checkpoint face_driving/checkpoints_emotion/best.pt \
        --data_root . \
        --index_csv val_package/perfrdiff_eval_pack/person_specific_val.csv \
        --neighbor_matrix val_package/perfrdiff_eval_pack/person_specific_masked_neighbour_emotion_val.npy \
        --output_dir face_driving/evaluation_results \
        --k 10 --sigma 0.3

    # 仅评测已有预测文件
    python -m face_driving.evaluation.eval_pipeline \
        --prediction face_driving/evaluation_results/prediction_emotion.npy \
        --data_root . \
        --index_csv val_package/perfrdiff_eval_pack/person_specific_val.csv \
        --neighbor_matrix val_package/perfrdiff_eval_pack/person_specific_masked_neighbour_emotion_val.npy \
        --skip_generation
"""

import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
import scipy.io.wavfile as wavfile
import scipy.signal
from tqdm import tqdm

# 确保 face_driving 在 path 中
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from face_driving.model.emotion_driving_model import EmotionDrivingModel, EMA
from face_driving.evaluation.official_evaluate import (
    evaluate_prediction,
    compute_score_breakdown,
    format_report,
)


# ============================================================
# 数据加载工具
# ============================================================

RECOLA_ROLE_MAP = {
    "P25": "P1", "P26": "P2",
    "P41": "P1", "P42": "P2",
    "P45": "P1", "P46": "P2",
}

CONTINUOUS_EMOTION_COLUMNS = ["valence", "arousal"]
DISCRETE_EMOTION_COLUMNS = [
    "Neutral", "Happy", "Sad", "Surprise",
    "Fear", "Disgust", "Anger", "Contempt",
]


def load_config_from_checkpoint(checkpoint_path, device):
    ckpt = torch.load(checkpoint_path, map_location=device, weights_only=False)
    return ckpt["config"]


def load_audio(path, target_sr=16000):
    sr, wav = wavfile.read(path)
    if wav.dtype == np.int16:
        wav = wav.astype(np.float32) / 32768.0
    elif wav.dtype == np.int32:
        wav = wav.astype(np.float32) / 2147483648.0
    elif wav.dtype != np.float32:
        wav = wav.astype(np.float32)
    if wav.ndim > 1:
        wav = wav.mean(axis=1)
    if sr != target_sr:
        wav = scipy.signal.resample(wav, int(len(wav) * target_sr / sr)).astype(np.float32)
    return wav


def load_emotion_csv(path):
    import pandas as pd
    for enc in ["utf-8-sig", "utf-8", "gbk", "latin-1"]:
        try:
            df = pd.read_csv(path, encoding=enc)
            break
        except (UnicodeDecodeError, UnicodeError):
            continue
    va = df[CONTINUOUS_EMOTION_COLUMNS].mean().values
    discrete = df[DISCRETE_EMOTION_COLUMNS].mean().values
    return np.concatenate([va, discrete]).astype(np.float32)


def to_emotion_rel_path(video_rel_path):
    rel_path = video_rel_path.replace("\\", "/") + ".csv"
    if "NoXI" in rel_path:
        rel_path = rel_path.replace("/Novice_video/", "/P2/")
        rel_path = rel_path.replace("/Expert_video/", "/P1/")
    if "/RECOLA/" in rel_path or rel_path.startswith("RECOLA/"):
        for src, dst in RECOLA_ROLE_MAP.items():
            rel_path = rel_path.replace(f"/{src}/", f"/{dst}/")
    return rel_path


# ============================================================
# 预测生成
# ============================================================

def generate_predictions(
    checkpoint_path: str,
    data_root: str,
    index_csv: str,
    output_path: str,
    k: int = 10,
    sigma: float = 0.3,
    target_frames: int = 750,
    batch_size: int = 4,
    device: str = "auto",
    smooth_window: int = 3,
    var_alpha: float = 1.3,
    no_postprocess: bool = False,
    diversity_strategy: str = "diverse",
):
    """按官方 CSV 顺序生成预测文件"""
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    device = torch.device(device)

    # 加载模型
    cfg = load_config_from_checkpoint(checkpoint_path, device)
    mc = cfg["model"]
    model = EmotionDrivingModel(
        audio_encoder_name=mc["audio_encoder"],
        audio_feat_dim=mc["audio_feat_dim"],
        freeze_audio_encoder=mc["freeze_audio_encoder"],
        d_model=mc["d_model"],
        n_heads=mc["n_heads"],
        n_layers=mc["n_layers"],
        dropout=0,
        output_fps=mc["output_fps"],
    )
    model.load_state_dict(torch.load(checkpoint_path, map_location=device, weights_only=False)["model_state_dict"])

    # 应用 EMA 权重（如果可用）
    ckpt_full = torch.load(checkpoint_path, map_location=device, weights_only=False)
    if "ema_shadow" in ckpt_full:
        ema = EMA(model, decay=0.999)
        ema.shadow = ckpt_full["ema_shadow"]
        ema.apply()
        print("[Generate] 应用 EMA 权重")
    else:
        ema = None

    model.to(device)
    model.eval()

    # 读取 CSV 构建样本列表
    with open(index_csv, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    data_rows = rows[1:]
    n_orig = len(data_rows)

    # 正向 + 交换
    samples = []
    for row in data_rows:
        speaker_audio = (
            Path(data_root) / "val" / "Audio_files" / row[1].strip().replace("\\", "/")
        ).with_suffix(".wav")
        listener_emo_csv = Path(data_root) / "val" / "Emotion" / to_emotion_rel_path(row[2].strip())
        samples.append(("speaker", str(speaker_audio), str(listener_emo_csv)))

    for row in data_rows:
        listener_audio = (
            Path(data_root) / "val" / "Audio_files" / row[2].strip().replace("\\", "/")
        ).with_suffix(".wav")
        speaker_emo_csv = Path(data_root) / "val" / "Emotion" / to_emotion_rel_path(row[1].strip())
        samples.append(("listener", str(listener_audio), str(speaker_emo_csv)))

    print(f"[Generate] 共 {len(samples)} 样本 (原始 {n_orig} * 2), K={k}, sigma={sigma}")

    # 预加载 emotion 条件
    emo_cache = {}
    def get_emo_cond(csv_path):
        if csv_path not in emo_cache:
            emo_cache[csv_path] = load_emotion_csv(csv_path)
        return emo_cache[csv_path]

    results = []
    batch_audio, batch_cond = [], []

    with torch.no_grad():
        for idx, (_, audio_path, emo_csv) in enumerate(tqdm(samples, desc="生成预测")):
            audio = load_audio(audio_path)
            audio_tensor = torch.from_numpy(audio).float()

            # padding/truncating 到 30s
            if audio_tensor.size(0) > 480000:
                audio_tensor = audio_tensor[:480000]
            elif audio_tensor.size(0) < 480000:
                audio_tensor = torch.nn.functional.pad(
                    audio_tensor, (0, 480000 - audio_tensor.size(0))
                )

            emo_cond = torch.from_numpy(get_emo_cond(emo_csv)).float()
            batch_audio.append(audio_tensor)
            batch_cond.append(emo_cond)

            if len(batch_audio) == batch_size or idx == len(samples) - 1:
                audio_batch = torch.stack(batch_audio).to(device)
                cond_batch = torch.stack(batch_cond).to(device)

                pred_k = model.predict_k_diverse(
                    audio_batch, cond_batch,
                    target_len=target_frames,
                    k=k,
                    noise_sigma=sigma,
                ) if diversity_strategy == "diverse" else model.predict_k(
                    audio_batch, cond_batch,
                    target_len=target_frames,
                    k=k,
                    noise_sigma=sigma,
                )
                results.append(pred_k.cpu().numpy())

                batch_audio, batch_cond = [], []

    pred = np.concatenate(results, axis=0).astype(np.float32)
    print(f"[Generate] 形状: {pred.shape}")

    # 后处理（时序平滑 + 方差放大）
    if not no_postprocess:
        try:
            from face_driving.postprocess import postprocess_emotion
            pred = postprocess_emotion(pred, smooth_window=smooth_window, var_alpha=var_alpha)
            print(f"[Generate] 后处理已应用: smooth_window={smooth_window}, var_alpha={var_alpha}")
        except Exception as e:
            print(f"[Generate] 后处理失败（跳过）: {e}")

    # 恢复 EMA 权重
    if ema is not None:
        ema.restore()

    # 保存
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    np.save(output_path, pred)

    # 打印数据范围检查
    print(f"[Generate] AU 范围: [{pred[:,:,:,:15].min():.4f}, {pred[:,:,:,:15].max():.4f}]")
    print(f"[Generate] VA 范围: [{pred[:,:,:,15:17].min():.4f}, {pred[:,:,:,15:17].max():.4f}]")
    print(f"[Generate] EXP 和: [{pred[:,:,:,17:25].sum(axis=-1).min():.4f}, {pred[:,:,:,17:25].sum(axis=-1).max():.4f}]")
    print(f"[Generate] 已保存: {output_path}")

    return pred


# ============================================================
# 主流程
# ============================================================

def run_pipeline(
    checkpoint_path: str = None,
    prediction_path: str = None,
    data_root: str = ".",
    index_csv: str = None,
    neighbor_matrix: str = None,
    output_dir: str = "face_driving/evaluation_results",
    k: int = 10,
    sigma: float = 0.3,
    target_frames: int = 750,
    batch_size: int = 4,
    device: str = "auto",
    skip_generation: bool = False,
    fps: int = 25,
    metrics: str = "frcorr,frdist,frdiv,frdvs,frvar,frsyn",
):
    """
    一键运行生成 + 评测流程
    """
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # 确定预测文件路径
    if prediction_path:
        pred_path = prediction_path
        generated = False
    else:
        pred_path = str(output_dir / "prediction_emotion.npy")
        generated = True

    # Step 1: 生成预测
    if not skip_generation:
        if checkpoint_path is None:
            raise ValueError("需要提供 --checkpoint 来生成预测")
        t0 = time.time()
        generate_predictions(
            checkpoint_path, data_root, index_csv, pred_path,
            k=k, sigma=sigma, target_frames=target_frames,
            batch_size=batch_size, device=device,
        )
        print(f"[Pipeline] 生成耗时: {time.time()-t0:.1f}s")

    # Step 2: 验证预测文件
    if not Path(pred_path).exists():
        raise FileNotFoundError(f"预测文件不存在: {pred_path}")
    pred_shape = np.load(pred_path).shape
    print(f"[Pipeline] 评测预测文件: {pred_path}, shape={pred_shape}")

    # Step 3: 官方评测
    t1 = time.time()
    results = evaluate_prediction(
        pred_path, data_root, index_csv, neighbor_matrix,
        fps=fps, metrics=metrics,
    )
    score = compute_score_breakdown(results)
    report = format_report(results, score)
    print(report)
    print(f"[Pipeline] 评测耗时: {time.time()-t1:.1f}s")

    # Step 4: 保存结果
    results_json = {**results, "score_breakdown": score}
    results_json["_meta"] = {
        "prediction_path": pred_path,
        "generated": generated,
        "k": k,
        "sigma": sigma,
        "target_frames": target_frames,
        "checkpoint": checkpoint_path,
    }

    results_file = output_dir / "official_metrics.json"
    with open(results_file, "w", encoding="utf-8") as f:
        json.dump(results_json, f, ensure_ascii=False, indent=2)
    print(f"\n[Pipeline] 结果已保存: {results_file}")

    return results, score


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Emotion 模型评测流程（生成 + 官方评测）")
    parser.add_argument("--checkpoint", type=str, help="模型 checkpoint 路径（用于生成预测）")
    parser.add_argument("--prediction", type=str, help="已有的 prediction_emotion.npy 路径（跳过生成）")
    parser.add_argument("--data_root", type=str, default=".", help="数据集根目录")
    parser.add_argument("--index_csv", type=str, required=True, help="person_specific_val.csv")
    parser.add_argument("--neighbor_matrix", type=str, required=True, help="邻居矩阵 .npy")
    parser.add_argument("--output_dir", type=str, default="face_driving/evaluation_results")
    parser.add_argument("--k", type=int, default=10)
    parser.add_argument("--sigma", type=float, default=0.3)
    parser.add_argument("--target_frames", type=int, default=750)
    parser.add_argument("--batch_size", type=int, default=4)
    parser.add_argument("--device", type=str, default="auto")
    parser.add_argument("--skip_generation", action="store_true", help="跳过生成，直接评测已有文件")
    parser.add_argument("--fps", type=int, default=25)
    parser.add_argument("--smooth_window", type=int, default=3, help="时序平滑窗口 (0=禁用)")
    parser.add_argument("--var_alpha", type=float, default=1.3, help="方差放大系数 (1.0=禁用)")
    parser.add_argument("--no_postprocess", action="store_true", help="禁用后处理")
    parser.add_argument(
        "--metrics",
        default="frcorr,frdist,frdiv,frdvs,frvar,frsyn",
        help="要评测的指标",
    )

    args = parser.parse_args()
    run_pipeline(
        checkpoint_path=args.checkpoint,
        prediction_path=args.prediction,
        data_root=args.data_root,
        index_csv=args.index_csv,
        neighbor_matrix=args.neighbor_matrix,
        output_dir=args.output_dir,
        k=args.k,
        sigma=args.sigma,
        target_frames=args.target_frames,
        batch_size=args.batch_size,
        device=args.device,
        skip_generation=args.skip_generation,
        fps=args.fps,
        metrics=args.metrics,
    )
