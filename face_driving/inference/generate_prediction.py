"""
生成 prediction_emotion.npy — 官方评测提交文件

按照 person_specific_val.csv 定义的样本顺序，生成 [N, K, T, 25] 预测文件。
支持 EMA 权重和后处理优化。

用法:
    python -m face_driving.inference.generate_prediction \
        --checkpoint face_driving/checkpoints_emotion/best.pt \
        --index-csv val_package/perfrdiff_eval_pack/person_specific_val.csv \
        --output prediction_emotion.npy

    # 带后处理
    python -m face_driving.inference.generate_prediction \
        --checkpoint face_driving/checkpoints_emotion/best.pt \
        --index-csv val_package/perfrdiff_eval_pack/person_specific_val.csv \
        --smooth-window 3 --var-alpha 1.3
"""

import csv
import argparse
import numpy as np
import torch
from pathlib import Path
from tqdm import tqdm

from face_driving.model.emotion_driving_model import EmotionDrivingModel, EMA
from face_driving.training.emotion_dataset import EmotionDataset


RECOLA_ROLE_MAP = {
    "P25": "P1", "P26": "P2",
    "P41": "P1", "P42": "P2",
    "P45": "P1", "P46": "P2",
}


def load_config_from_checkpoint(ckpt):
    cfg = ckpt["config"]
    mc = cfg["model"]
    return cfg, mc


def build_model(mc, checkpoint_path, device):
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
    ckpt = torch.load(checkpoint_path, map_location=device, weights_only=False)
    model.load_state_dict(ckpt["model_state_dict"])

    # 如果有 EMA 权重，应用
    if "ema_shadow" in ckpt:
        print("[Gen] 检测到 EMA 权重，应用中...")
        ema = EMA(model, decay=0.999)
        ema.shadow = ckpt["ema_shadow"]
        ema.apply()

    model.to(device)
    model.eval()
    return model


def load_person_specific_order(index_csv):
    """读取 person_specific_val.csv 并展开为双向样本"""
    with open(index_csv, "r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    data_rows = rows[1:]  # skip header

    speaker_paths = [row[1].strip() for row in data_rows]
    listener_paths = [row[2].strip() for row in data_rows]

    # 正向: speaker → listener + 反向: listener → speaker
    all_speakers = speaker_paths + listener_paths
    all_listeners = listener_paths + speaker_paths

    return all_speakers, all_listeners


def video_path_to_audio_path(video_rel_path, data_root, split="val"):
    """将 CSV 中的 video 相对路径转为 audio 路径"""
    # e.g. "NoXI/005_2016-03-18_Paris/Expert_video/2" → "{data_root}/val/Audio_files/NoXI/.../Expert_video/2.wav"
    audio_rel = video_rel_path + ".wav"
    return Path(data_root) / split / "Audio_files" / audio_rel


def video_path_to_emotion_csv(video_rel_path, data_root, split="val"):
    """将 CSV 中的 video 相对路径转为 Emotion CSV 路径 (用于提取 speaker 情绪条件)"""
    rel = video_rel_path.replace("\\", "/") + ".csv"

    if "NoXI" in rel:
        rel = rel.replace("/Novice_video/", "/P2/")
        rel = rel.replace("/Expert_video/", "/P1/")
    if "/RECOLA/" in rel:
        for src, dst in RECOLA_ROLE_MAP.items():
            rel = rel.replace(f"/{src}/", f"/{dst}/")

    return Path(data_root) / split / "Emotion" / rel


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=str, required=True)
    parser.add_argument("--data-root", type=str, default=".")
    parser.add_argument("--split", type=str, default="val")
    parser.add_argument("--index-csv", type=str, required=True)
    parser.add_argument("--output", type=str, default="prediction_emotion.npy")
    parser.add_argument("--k", type=int, default=10)
    parser.add_argument("--noise-sigma", type=float, default=0.3)
    parser.add_argument("--target-frames", type=int, default=750)
    parser.add_argument("--device", type=str, default="auto")
    parser.add_argument("--smooth-window", type=int, default=3, help="时序平滑窗口 (0=禁用)")
    parser.add_argument("--var-alpha", type=float, default=1.3, help="方差放大系数 (1.0=禁用)")
    parser.add_argument("--no-postprocess", action="store_true", help="禁用后处理")
    parser.add_argument(
        "--diversity-strategy", type=str, default="diverse",
        choices=["stable", "diverse"],
        help="多样性策略: stable=原版, diverse=增强多样性(提升FRDiv)",
    )
    args = parser.parse_args()

    if args.device == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    else:
        device = torch.device(args.device)

    # 加载模型
    ckpt = torch.load(args.checkpoint, map_location=device, weights_only=False)
    cfg, mc = load_config_from_checkpoint(ckpt)
    model = build_model(mc, args.checkpoint, device)
    print(f"[Gen] 模型就绪: {args.checkpoint}")

    # 读取样本顺序
    speaker_paths, listener_paths = load_person_specific_order(args.index_csv)
    N = len(speaker_paths)
    print(f"[Gen] 样本数: {N}, K={args.k}, T={args.target_frames}")

    # 构建临时 dataset 用于音频加载
    target_sr = cfg["data"]["target_audio_sr"]
    segment_sec = cfg["data"]["segment_sec"]
    segment_audio_len = int(segment_sec * target_sr)

    all_predictions = []

    for sample_idx in tqdm(range(N), desc="Generating"):
        speaker_rel = speaker_paths[sample_idx]
        audio_path = video_path_to_audio_path(speaker_rel, args.data_root, args.split)

        # 加载 speaker 音频 (复用 dataset 的音频加载逻辑)
        if not audio_path.exists():
            print(f"[WARN] 音频不存在: {audio_path}, 用零填充")
            audio_tensor = torch.zeros(1, segment_audio_len, dtype=torch.float32)
        else:
            import scipy.io.wavfile as wavfile
            import scipy.signal
            sr, wav_data = wavfile.read(str(audio_path))
            if wav_data.dtype == np.int16:
                wav_data = wav_data.astype(np.float32) / 32768.0
            elif wav_data.dtype != np.float32:
                wav_data = wav_data.astype(np.float32)
            if wav_data.ndim > 1:
                wav_data = wav_data.mean(axis=1)
            if sr != target_sr:
                n_target = int(len(wav_data) * target_sr / sr)
                wav_data = scipy.signal.resample(wav_data, n_target).astype(np.float32)
            audio_tensor = torch.from_numpy(wav_data)
            if audio_tensor.size(0) > segment_audio_len:
                audio_tensor = audio_tensor[:segment_audio_len]
            elif audio_tensor.size(0) < segment_audio_len:
                audio_tensor = torch.nn.functional.pad(
                    audio_tensor, (0, segment_audio_len - audio_tensor.size(0))
                )
            audio_tensor = audio_tensor.unsqueeze(0)  # [1, segment_audio_len]

        # speaker 情绪条件
        emo_csv_path = video_path_to_emotion_csv(speaker_rel, args.data_root, args.split)
        if emo_csv_path.exists():
            import pandas as pd
            from face_driving.preprocess.blendshape_definitions import (
                CONTINUOUS_EMOTION_COLUMNS, DISCRETE_EMOTION_COLUMNS,
            )
            for enc in ["utf-8", "utf-8-sig", "gbk", "latin-1"]:
                try:
                    df = pd.read_csv(str(emo_csv_path), encoding=enc)
                    break
                except (UnicodeDecodeError, UnicodeError):
                    continue
            else:
                df = None
            if df is not None:
                va = df[CONTINUOUS_EMOTION_COLUMNS].mean().values
                discrete = df[DISCRETE_EMOTION_COLUMNS].mean().values
                emo_cond = np.concatenate([va, discrete]).astype(np.float32)
            else:
                emo_cond = np.zeros(10, dtype=np.float32)
        else:
            emo_cond = np.zeros(10, dtype=np.float32)
        emo_tensor = torch.from_numpy(emo_cond).unsqueeze(0)  # [1, 10]

        audio_tensor = audio_tensor.to(device)
        emo_tensor = emo_tensor.to(device)

        # K 次前向（根据多样性策略选择方法）
        if args.diversity_strategy == "diverse":
            k_pred = model.predict_k_diverse(
                audio_tensor, emo_tensor,
                target_len=args.target_frames,
                k=args.k,
                noise_sigma=args.noise_sigma,
            )
        else:
            k_pred = model.predict_k(
                audio_tensor, emo_tensor,
                target_len=args.target_frames,
                k=args.k,
                noise_sigma=args.noise_sigma,
            )  # [1, K, T, 25]

        all_predictions.append(k_pred[0].cpu().numpy())  # [K, T, 25]

    # 组装为 [N, K, T, 25]
    prediction = np.stack(all_predictions, axis=0).astype(np.float32)  # [N, K, T, 25]

    # 后处理（时序平滑 + 方差放大）
    if not args.no_postprocess:
        from face_driving.postprocess import postprocess_emotion
        print(f"[Gen] 应用后处理: smooth_window={args.smooth_window}, var_alpha={args.var_alpha}")
        prediction = postprocess_emotion(
            prediction,
            smooth_window=args.smooth_window,
            var_alpha=args.var_alpha,
        )

    np.save(args.output, prediction)
    print(f"\n[Gen] 保存: {args.output}")
    print(f"[Gen] 形状: {prediction.shape}")
    print(f"[Gen] AU range: [{prediction[:,:,:,:15].min():.4f}, {prediction[:,:,:,:15].max():.4f}]")
    print(f"[Gen] VA range: [{prediction[:,:,:,15:17].min():.4f}, {prediction[:,:,:,15:17].max():.4f}]")
    print(f"[Gen] EXP sum range: [{prediction[:,:,:,17:25].sum(axis=-1).min():.4f}, {prediction[:,:,:,17:25].sum(axis=-1).max():.4f}]")


if __name__ == "__main__":
    main()
