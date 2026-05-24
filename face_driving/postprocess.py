"""
后处理模块 — 推理输出优化

包含两个版本:
  - amplify_variance: 58 维 3D_FV 模型专用（原有）
  - temporal_smooth_emotion / amplify_variance_emotion / postprocess_emotion:
    25 维 Emotion 模型后处理，用于官方评测提交前优化

算法:
  1. 时序平滑: uniform_filter1d 减少帧间噪声，改善 FRSyn
  2. 方差放大: output = mean + α*(output - mean) 恢复时序动态，改善 FRVar
  3. 归一化: AU clip [0,1], VA clip [-1,1], EXP re-softmax
"""

import numpy as np
from typing import Optional
from scipy.ndimage import uniform_filter1d


# ============================================================
# 58 维 3D_FV 模型后处理（原有）
# ============================================================

def amplify_variance(
    pred: np.ndarray,
    alpha: float = 5.0,
    au_slice: slice = slice(0, 52),
) -> np.ndarray:
    """
    方差放大后处理 — 58 维 3D_FV 模型专用

    Args:
        pred:  [N, T, D] 或 [T, D] 预测数组
        alpha: 放大系数，1.0 = 不变
    """
    if alpha == 1.0:
        return pred

    result = pred.copy()
    mean = result.mean(axis=1, keepdims=True)
    result = mean + alpha * (result - mean)

    au_end = au_slice.stop if isinstance(au_slice, slice) else au_slice
    result[:, :, au_slice] = np.clip(result[:, :, :au_end], 0, None)

    return result


# ============================================================
# 25 维 Emotion 模型后处理
# ============================================================

def temporal_smooth_emotion(pred: np.ndarray, window: int = 3) -> np.ndarray:
    """
    时序平滑 — 减少帧间噪声，改善 FRSyn

    Args:
        pred:   [N, K, T, 25] 或 [T, 25]
        window: 平滑窗口大小（3 或 5）
    """
    if window < 2:
        return pred

    original_shape = pred.shape
    if pred.ndim == 4:
        # [N, K, T, 25] → 展平前两维处理
        B, K, T, D = pred.shape
        flat = pred.reshape(-1, T, D)
    elif pred.ndim == 2:
        flat = pred[np.newaxis]
    else:
        flat = pred

    result = np.stack([
        uniform_filter1d(f, size=window, axis=0, mode='nearest')
        for f in flat
    ])

    if pred.ndim == 4:
        return result.reshape(original_shape)
    elif pred.ndim == 2:
        return result[0]
    return result


def amplify_variance_emotion(pred: np.ndarray, alpha: float = 1.3) -> np.ndarray:
    """
    方差放大 — 恢复时序动态，改善 FRVar

    MSE 训练导致回归到均值，通过 alpha > 1 放大偏离:
        output = mean + alpha * (output - mean)

    Args:
        pred:  [N, K, T, 25]
        alpha: 放大系数，>1.0 增加方差
    """
    if alpha == 1.0:
        return pred

    result = pred.copy()
    # 在时间维度上计算均值并放大偏离
    mean = result.mean(axis=-2, keepdims=True)  # mean over T
    result = mean + alpha * (result - mean)

    # Clip 到合法范围
    result[..., :15] = np.clip(result[..., :15], 0, 1)       # AU [0, 1]
    result[..., 15:17] = np.clip(result[..., 15:17], -1, 1)  # VA [-1, 1]

    # EXP 重新归一化为概率分布
    exp_sum = result[..., 17:25].sum(axis=-1, keepdims=True)
    exp_sum = np.where(exp_sum > 1e-8, exp_sum, 1.0)
    result[..., 17:25] = result[..., 17:25] / exp_sum
    # 确保非负
    result[..., 17:25] = np.clip(result[..., 17:25], 0, None)

    return result


def postprocess_emotion(
    pred: np.ndarray,
    smooth_window: int = 3,
    var_alpha: float = 1.3,
) -> np.ndarray:
    """
    25 维 Emotion 预测完整后处理流水线

    应用: 时序平滑 → 方差放大 → clip/归一化

    Args:
        pred:          [N, K, T, 25] 预测数组
        smooth_window: 时序平滑窗口（0 禁用）
        var_alpha:     方差放大系数（1.0 禁用）

    Returns:
        处理后的 [N, K, T, 25] 数组
    """
    result = pred.copy()

    if smooth_window > 1:
        result = temporal_smooth_emotion(result, smooth_window)

    if var_alpha != 1.0:
        result = amplify_variance_emotion(result, var_alpha)

    return result
