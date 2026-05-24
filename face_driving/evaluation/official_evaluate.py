"""
Official Evaluation Adapter — 适配官方评测脚本的本地评测模块

用法:
    # 方式一：通过官方 eval_emotion_metrics.py 评测（推荐，需要 tslearn）
    python -m face_driving.evaluation.official_evaluate \
        --checkpoint face_driving/checkpoints_emotion/best.pt \
        --prediction prediction_emotion.npy \
        --data_root . \
        --index_csv val_package/perfrdiff_eval_pack/person_specific_val.csv \
        --neighbor_matrix val_package/perfrdiff_eval_pack/person_specific_masked_neighbour_emotion_val.npy

    # 方式二：纯本地评测（不需要 tslearn，使用 numpy/scipy）
    python -m face_driving.evaluation.official_evaluate \
        --checkpoint face_driving/checkpoints_emotion/best.pt \
        --prediction prediction_emotion.npy \
        --data_root . \
        --index_csv val_package/perfrdiff_eval_pack/person_specific_val.csv \
        --neighbor_matrix val_package/perfrdiff_eval_pack/person_specific_masked_neighbour_emotion_val.npy \
        --local_only
"""

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np

try:
    from tslearn.metrics import dtw as tslearn_dtw
    HAS_TSLEARN = True
except ImportError:
    HAS_TSLEARN = False

try:
    from tqdm import tqdm
except ImportError:
    def tqdm(iterable, **kwargs):
        return iterable


# ============================================================
# 官方邻居矩阵角色映射（与官方脚本完全一致）
# ============================================================

RECOLA_ROLE_MAP = {
    "P25": "P1",
    "P26": "P2",
    "P41": "P1",
    "P42": "P2",
    "P45": "P1",
    "P46": "P2",
}


# ============================================================
# 核心指标计算（复刻官方 eval_emotion_metrics.py）
# ============================================================

def load_person_specific_order(index_csv):
    """读取 person_specific_val.csv 并展开为双向样本"""
    with open(index_csv, "r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    if len(rows) <= 1:
        raise ValueError(f"Index CSV is empty: {index_csv}")
    data_rows = rows[1:]
    speaker_paths = [row[1].strip() for row in data_rows]
    listener_paths = [row[2].strip() for row in data_rows]
    # 正向 + 交换
    speaker_order = speaker_paths + listener_paths
    listener_order = listener_paths + speaker_paths
    return speaker_order, listener_order


def to_emotion_rel_path(video_rel_path):
    """将 CSV 中的 video path 转为 Emotion CSV 相对路径"""
    rel_path = video_rel_path.replace("\\", "/") + ".csv"
    if "NoXI" in rel_path:
        rel_path = rel_path.replace("/Novice_video/", "/P2/")
        rel_path = rel_path.replace("/Expert_video/", "/P1/")
    if "/RECOLA/" in rel_path or rel_path.startswith("RECOLA/"):
        for src, dst in RECOLA_ROLE_MAP.items():
            rel_path = rel_path.replace(f"/{src}/", f"/{dst}/")
    return rel_path


def load_emotion_sequence(data_root, split, video_rel_path, cache, target_len):
    """加载单条 emotion 序列"""
    rel_path = to_emotion_rel_path(video_rel_path)
    if rel_path not in cache:
        emotion_path = Path(data_root) / split / "Emotion" / Path(rel_path)
        if not emotion_path.exists():
            raise FileNotFoundError(f"Emotion file not found: {emotion_path}")
        data = np.loadtxt(emotion_path, delimiter=",", skiprows=1, dtype=np.float32)
        if data.ndim != 2 or data.shape[1] != 25:
            raise ValueError(f"Unexpected emotion shape in {emotion_path}: {data.shape}")
        cache[rel_path] = data
    seq = cache[rel_path]
    if seq.shape[0] < target_len:
        raise ValueError(
            f"Emotion sequence shorter than target length {target_len}: {rel_path}, "
            f"got {seq.shape[0]}"
        )
    return seq[:target_len]


def load_ground_truth_arrays(data_root, split, index_csv, target_len):
    """加载 speaker 和 listener 的 GT 序列数组"""
    speaker_order, listener_order = load_person_specific_order(index_csv)
    cache = {}
    speaker_seqs = []
    listener_seqs = []
    for sp_rel, li_rel in tqdm(
        zip(speaker_order, listener_order),
        total=len(speaker_order),
        desc="Loading ground truth",
    ):
        speaker_seqs.append(load_emotion_sequence(data_root, split, sp_rel, cache, target_len))
        listener_seqs.append(load_emotion_sequence(data_root, split, li_rel, cache, target_len))
    return np.stack(speaker_seqs), np.stack(listener_seqs)


# ---- CCC ----
def _corrcoef(x, y):
    c = np.cov(x, y)
    try:
        d = np.diag(c)
    except ValueError:
        return c / c
    stddev = np.sqrt(d.real)
    c = c / stddev[:, None]
    c = c / stddev[None, :]
    c = np.nan_to_num(c)
    np.clip(c.real, -1, 1, out=c.real)
    return c


def concordance_correlation_coefficient(y_true, y_pred):
    """
    官方 CCC 实现（逐维计算后取平均）
    y_true, y_pred: [T, D]
    """
    if y_true.ndim != 2 or y_pred.ndim != 2:
        raise ValueError("CCC expects 2D arrays with shape [T, D].")
    ccc_list = []
    for dim_idx in range(y_true.shape[1]):
        cor = _corrcoef(y_true[:, dim_idx], y_pred[:, dim_idx])[0][1]
        mean_true = np.mean(y_true[:, dim_idx])
        mean_pred = np.mean(y_pred[:, dim_idx])
        var_true = np.var(y_true[:, dim_idx])
        var_pred = np.var(y_pred[:, dim_idx])
        sd_true = np.std(y_true[:, dim_idx])
        sd_pred = np.std(y_pred[:, dim_idx])
        numerator = 2 * cor * sd_true * sd_pred
        denominator = var_true + var_pred + (mean_true - mean_pred) ** 2
        ccc = numerator / (denominator + 1e-8)
        ccc_list.append(ccc)
    return float(np.mean(ccc_list))


# ---- DTW ----
def dtw_distance(x, y):
    """
    DTW 距离计算，优先使用 tslearn 加速
    x, y: [T, D]
    """
    if HAS_TSLEARN:
        return float(tslearn_dtw(x.astype(np.float32), y.astype(np.float32)))
    # 纯 numpy fallback（慢，仅用于无 tslearn 的环境）
    n, m = x.shape[0], y.shape[0]
    dp = np.full((n + 1, m + 1), np.inf, dtype=np.float64)
    dp[0, 0] = 0.0
    for i in range(1, n + 1):
        xi = x[i - 1]
        for j in range(1, m + 1):
            cost = np.linalg.norm(xi - y[j - 1])
            dp[i, j] = cost + min(dp[i - 1, j], dp[i, j - 1], dp[i - 1, j - 1])
    return float(dp[n, m])


def weighted_dtw(pred_seq, gt_seq):
    """
    加权 DTW 距离（官方公式）
    d(x, y) = (1/15)*DTW(AU) + 1*DTW(VA) + (1/8)*DTW(EXP)
    """
    total = 0.0
    for start, end, weight in ((0, 15, 1.0 / 15.0), (15, 17, 1.0), (17, 25, 1.0 / 8.0)):
        total += weight * dtw_distance(pred_seq[:, start:end], gt_seq[:, start:end])
    return total


# ---- FRCorr ----
def compute_frcorr(pred, listener_gt, neighbor_matrix):
    """
    官方 FRCorr: 对每个(n,k) 在邻居集合 A(n) 中取 max CCC
    pred: [N, K, T, 25]
    listener_gt: [N, T, 25]
    neighbor_matrix: [N, N]
    """
    total = 0.0
    for sample_idx in tqdm(range(pred.shape[0]), desc="FRCorr"):
        neighbor_indices = np.flatnonzero(neighbor_matrix[sample_idx])
        if neighbor_indices.size == 0:
            raise ValueError(f"Sample {sample_idx} has an empty neighbor set.")
        for cand_idx in range(pred.shape[1]):
            best = max(
                concordance_correlation_coefficient(listener_gt[neighbor_idx], pred[sample_idx, cand_idx])
                for neighbor_idx in neighbor_indices
            )
            total += best
    return total / pred.shape[0]


# ---- FRdist ----
def compute_frdist(pred, listener_gt, neighbor_matrix):
    """
    官方 FRdist: 对每个(n,k) 在邻居集合 A(n) 中取 min 加权 DTW 距离
    """
    total = 0.0
    for sample_idx in tqdm(range(pred.shape[0]), desc="FRdist"):
        neighbor_indices = np.flatnonzero(neighbor_matrix[sample_idx])
        if neighbor_indices.size == 0:
            raise ValueError(f"Sample {sample_idx} has an empty neighbor set.")
        for cand_idx in range(pred.shape[1]):
            best = min(
                weighted_dtw(pred[sample_idx, cand_idx], listener_gt[neighbor_idx])
                for neighbor_idx in neighbor_indices
            )
            total += best
    return total / pred.shape[0]


# ---- FRDiv ----
def _sum_ordered_pairwise_sq(flat_array):
    """辅助函数：计算展平后两两平方距离之和的高效实现"""
    count = flat_array.shape[0]
    if count <= 1:
        return 0.0
    sq_norm_sum = np.sum(flat_array * flat_array)
    sum_vector = np.sum(flat_array, axis=0)
    return float(2 * count * sq_norm_sum - 2 * np.dot(sum_vector, sum_vector))


def compute_frdiv(pred):
    """
    官方 FRDiv: 同一样本内 K 条候选之间的离散程度
    pred: [N, K, T, 25]
    FRDiv_n = Σ_{a,b} ||z(n,a) - z(n,b)||² / (K*(K-1)*D')
    """
    n_samples, n_candidates, seq_len, dim = pred.shape
    if n_candidates <= 1:
        return 0.0
    flat_dim = seq_len * dim
    total = 0.0
    for sample_idx in range(n_samples):
        flat = pred[sample_idx].reshape(n_candidates, flat_dim)
        total += _sum_ordered_pairwise_sq(flat) / (n_candidates * (n_candidates - 1) * flat_dim)
    return total / n_samples


# ---- FRDvs ----
def compute_frdvs(pred):
    """
    官方 FRDvs: 固定候选编号 k，比较不同样本之间的差异
    pred: [N, K, T, 25]
    FRDvs = Σ_k Σ_{n,m} ||z(n,k) - z(m,k)||² / (N*(N-1)*K*D')
    """
    n_samples, n_candidates, seq_len, dim = pred.shape
    if n_samples <= 1:
        return 0.0
    flat_dim = seq_len * dim
    total = 0.0
    for cand_idx in range(n_candidates):
        flat = pred[:, cand_idx].reshape(n_samples, flat_dim)
        total += _sum_ordered_pairwise_sq(flat)
    return total / (n_samples * (n_samples - 1) * n_candidates * flat_dim)


# ---- FRVar ----
def compute_frvar(pred):
    """
    官方 FRVar: 时间维度方差（ddof=1, Bessel 校正）
    FRVar = mean_{n,k,d}( Var_t(pred[n,k,t,d]) )
    """
    return float(np.mean(np.var(pred, axis=2, ddof=1)))


# ---- FRSyn (TLCC) ----
def _shift(x, y, lag):
    if lag > 0:
        return x[lag:], y[:-lag]
    if lag < 0:
        return x[:lag], y[-lag:]
    return x, y


def _crosscorr(datax, datay, lag):
    dim = datax.shape[1]
    pcc_list = []
    for dim_idx in range(dim):
        x_s, y_s = _shift(datax[:, dim_idx], datay[:, dim_idx], lag)
        corr = np.corrcoef(x_s, y_s)[0, 1]
        pcc_list.append(float(corr))
    return float(np.nanmean(np.array(pcc_list, dtype=np.float64)))


def _calculate_tlcc(pred_seq, speaker_seq, fps):
    """
    计算 TLCC 最佳 lag（官方实现）
    在 [-(2*fps-1), ..., +(2*fps-1)] 范围内找峰值 lag
    """
    max_lag = int(2 * fps - 1)
    lags = range(-max_lag, max_lag + 1)
    scores = [_crosscorr(pred_seq, speaker_seq, lag) for lag in lags]
    scores = np.nan_to_num(np.array(scores, dtype=np.float64), nan=0.0)
    best_idx = int(np.argmax(scores))
    best_lag = list(lags)[best_idx]
    return abs(best_lag)


def compute_frsyn(pred, speaker_gt, fps):
    """
    官方 FRSyn: TLCC 时滞互相关
    对每个(n,k) 计算与 speaker 序列的最佳 lag，取绝对值平均
    """
    offsets = []
    for sample_idx in tqdm(range(pred.shape[0]), desc="FRSyn"):
        for cand_idx in range(pred.shape[1]):
            offsets.append(
                _calculate_tlcc(pred[sample_idx, cand_idx], speaker_gt[sample_idx], fps)
            )
    return float(np.mean(np.array(offsets, dtype=np.float64)))


# ============================================================
# 综合评测函数
# ============================================================

def evaluate_prediction(
    prediction_path: str,
    data_root: str,
    index_csv: str,
    neighbor_matrix_path: str,
    fps: int = 25,
    metrics: str = "frcorr,frcorr_star,frdist,frdiv,frdvs,frvar,frsyn",
) -> dict:
    """
    对 prediction_emotion.npy 进行官方指标评测

    Args:
        prediction_path: prediction_emotion.npy 路径 [N, K, T, 25]
        data_root: 数据集根目录（包含 val/ 文件夹）
        index_csv: 官方 person_specific_val.csv 路径
        neighbor_matrix_path: 官方邻居矩阵 .npy 路径
        fps: 帧率（默认 25）
        metrics: 要计算的指标列表，逗号分隔

    Returns:
        dict 包含所有指标结果
    """
    selected = [m.strip().lower() for m in metrics.split(",") if m.strip()]
    # 标准化名称
    name_map = {"frcorr*": "frcorr_star", "frcorrstar": "frcorr_star"}
    selected = [name_map.get(s, s) for s in selected]

    # 加载预测
    prediction = np.load(prediction_path).astype(np.float32)
    if prediction.ndim != 4:
        raise ValueError(f"prediction must be [N, K, T, 25], got {prediction.shape}")
    if prediction.shape[-1] != 25:
        raise ValueError(f"prediction last dim must be 25, got {prediction.shape[-1]}")

    N, K, T, D = prediction.shape
    print(f"[Eval] Prediction: {prediction.shape}, K={K}, T={T}, D={D}")

    # 加载邻居矩阵
    neighbor_matrix = np.load(neighbor_matrix_path)
    if neighbor_matrix.ndim != 2 or neighbor_matrix.shape[0] != neighbor_matrix.shape[1]:
        raise ValueError(f"Neighbor matrix must be square, got {neighbor_matrix.shape}")
    if neighbor_matrix.shape[0] != N:
        raise ValueError(
            f"Neighbor matrix size {neighbor_matrix.shape[0]} does not match prediction N {N}"
        )

    # 加载 GT
    speaker_gt, listener_gt = load_ground_truth_arrays(data_root, "val", index_csv, T)
    if speaker_gt.shape[0] != N:
        raise ValueError(
            f"Expanded sample count from CSV is {speaker_gt.shape[0]}, but prediction N is {N}"
        )

    results = {}

    # FRCorr / FRCorr*
    if "frcorr" in selected or "frcorr_star" in selected:
        frcorr = compute_frcorr(prediction, listener_gt, neighbor_matrix)
        results["FRCorr"] = frcorr
        results["FRCorr*"] = frcorr  # 官方协议下两者相同

    # FRdist
    if "frdist" in selected:
        results["FRdist"] = compute_frdist(prediction, listener_gt, neighbor_matrix)

    # FRDiv
    if "frdiv" in selected:
        frdiv = compute_frdiv(prediction)
        results["FRDiv"] = frdiv
        results["FRDiv(%)"] = frdiv * 100.0  # 表格展示格式

    # FRDvs
    if "frdvs" in selected:
        frdvs = compute_frdvs(prediction)
        results["FRDvs"] = frdvs
        results["FRDvs(%)"] = frdvs * 100.0

    # FRVar
    if "frvar" in selected:
        frvar = compute_frvar(prediction)
        results["FRVar"] = frvar
        results["FRVar(%)"] = frvar * 100.0

    # FRSyn
    if "frsyn" in selected:
        results["FRSyn"] = compute_frsyn(prediction, speaker_gt, fps)

    return results


def compute_score_breakdown(metrics_dict: dict) -> dict:
    """
    计算官方综合评分 S 的分项分解
    S = S1 + S2 + S3 + S4 + S5 + S6 + S7 + S8
    """
    def safe_div(numerator, denominator):
        if denominator == 0 or np.isnan(denominator) or np.isinf(denominator):
            return 0.0
        return numerator / denominator

    breakdown = {}

    s1 = min(safe_div(metrics_dict.get("FRCorr", 0), 0.09) * 10, 10)
    s2 = min(safe_div(91.07, metrics_dict.get("FRdist", 0)) * 10, 10) if metrics_dict.get("FRdist", 0) > 0 else 0
    s3 = min(safe_div(metrics_dict.get("FRDiv", 0), 3.4e-2) * 10, 10)
    s4 = min(safe_div(metrics_dict.get("FRDvs", 0), 3.22e-2) * 10, 10)
    s5 = min(safe_div(metrics_dict.get("FRVar", 0), 2.02e-2) * 10, 10)
    s6 = min(safe_div(69.33, metrics_dict.get("FRRea", metrics_dict.get("FRdist", 1))) * 15, 15)
    s7 = min(safe_div(41.99, metrics_dict.get("FRSyn", 0)) * 10, 10) if metrics_dict.get("FRSyn", 0) > 0 else 0
    s8 = min(safe_div(metrics_dict.get("FRCorr*", 0), 0.45) * 25, 25)

    breakdown["S1_FRCorr"] = round(s1, 3)
    breakdown["S2_FRdist"] = round(s2, 3)
    breakdown["S3_FRDiv"] = round(s3, 3)
    breakdown["S4_FRDvs"] = round(s4, 3)
    breakdown["S5_FRVar"] = round(s5, 3)
    breakdown["S6_FRRea"] = round(s6, 3)
    breakdown["S7_FRSyn"] = round(s7, 3)
    breakdown["S8_FRCorr*"] = round(s8, 3)
    breakdown["S_total"] = round(s1 + s2 + s3 + s4 + s5 + s6 + s7 + s8, 3)

    return breakdown


def format_report(metrics_dict: dict, score_breakdown: dict = None) -> str:
    """格式化评估报告"""
    lines = [
        "=" * 62,
        "  面部行为驱动模型 — 官方协议评测报告",
        "=" * 62,
        "",
        "核心指标:",
    ]

    for key in ["FRCorr", "FRCorr*", "FRdist", "FRDiv", "FRDiv(%)",
                 "FRDvs", "FRDvs(%)", "FRVar", "FRVar(%)", "FRSyn"]:
        if key in metrics_dict:
            val = metrics_dict[key]
            if "(%)" in key:
                lines.append(f"  {key:15s} = {val:.4f}  (×100 for display)")
            else:
                lines.append(f"  {key:15s} = {val:.6f}")

    if score_breakdown:
        lines += ["", "综合评分 S 分项:", ""]
        for k, v in score_breakdown.items():
            lines.append(f"  {k:20s} = {v}")
        lines.append("")
        lines.append(f"  ★ 综合总分 S = {score_breakdown['S_total']}")

    lines.append("=" * 62)
    return "\n".join(lines)


# ============================================================
# CLI 入口
# ============================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="官方协议 Emotion 模型评测（复刻 eval_emotion_metrics.py）"
    )
    parser.add_argument("--prediction", required=True, help="prediction_emotion.npy 路径 [N, K, T, 25]")
    parser.add_argument("--data_root", required=True, help="数据集根目录")
    parser.add_argument("--index_csv", required=True, help="官方 person_specific_val.csv")
    parser.add_argument("--neighbor_matrix", required=True, help="官方邻居矩阵 .npy")
    parser.add_argument("--fps", type=int, default=25)
    parser.add_argument(
        "--metrics",
        default="frcorr,frcorr_star,frdist,frdiv,frdvs,frvar,frsyn",
        help="要计算的指标，逗号分隔",
    )
    parser.add_argument("--output_json", help="保存结果为 JSON 的路径")
    parser.add_argument("--tslearn", action="store_true", help="强制使用 tslearn 加速 DTW")
    parser.add_argument("--no_tslearn", action="store_true", help="禁用 tslearn，使用纯 numpy DTW")
    args = parser.parse_args()

    if args.no_tslearn:
        sys.modules["tslearn"] = None

    results = evaluate_prediction(
        args.prediction,
        args.data_root,
        args.index_csv,
        args.neighbor_matrix,
        args.fps,
        args.metrics,
    )

    score = compute_score_breakdown(results)
    report = format_report(results, score)
    print(report)

    if args.output_json:
        output_path = Path(args.output_json)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output = {**results, "score_breakdown": score}
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(f"\n结果已保存: {output_path}")
