"""
Emotion Driving Loss — 25 维输出损失函数（对齐官方评测指标）

分组:
  - AU (dim 0-14):  15 个动作单元, Sigmoid → BCE 损失（AU 数据是二进制）
  - VA (dim 15-16): valence/arousal, Tanh → MSE + L1 损失
  - EXP (dim 17-24): 8 个表情概率, Softmax → BCE 损失（加 label smoothing）

对齐评测指标:
  - CCC Loss: 直接优化 FRCorr / FRCorr*（权重最高）
  - Velocity Loss: 一阶差分一致性（间接优化 FRSyn）
  - Temporal Sync Loss: 预测-目标的速度相关性（直接优化 FRSyn TLCC）
  - Temporal Variance: 逐维度时间方差匹配（直接优化 FRVar）
  - Batch Diversity: 跨样本多样性正则（间接优化 FRDvs）
"""

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


# 25 维分组常量
AU_SLICE = slice(0, 15)
VA_SLICE = slice(15, 17)
EXP_SLICE = slice(17, 25)


def compute_ccc(pred: torch.Tensor, target: torch.Tensor, dim: int = 1) -> torch.Tensor:
    """
    计算 Concordance Correlation Coefficient (CCC)

    对齐官方评测中的 CCC 实现。

    Args:
        pred:   [B, T, D]
        target: [B, T, D]
        dim:    时间维度

    Returns:
        标量 CCC，在所有 batch 和特征维度上取平均
    """
    pred_mean = pred.mean(dim=dim)
    target_mean = target.mean(dim=dim)
    pred_var = pred.var(dim=dim)
    target_var = target.var(dim=dim)

    # 协方差
    cov = ((pred - pred_mean.unsqueeze(dim)) * (target - target_mean.unsqueeze(dim))).mean(dim=dim)

    # CCC per feature dimension: [B, D]
    ccc = (2 * cov) / (pred_var + target_var + (pred_mean - target_mean) ** 2 + 1e-8)

    return ccc.mean()  # 在 batch 和特征维度上取平均


def compute_velocity_corr(pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    """
    计算预测和目标在速度（一阶差分）层面的相关性

    这直接优化 FRSyn 指标的核心要素：
    FRSyn 测量的是 pred 和 speaker 的时间对齐，
    速度相关性强意味着动作的时序节奏一致。

    Args:
        pred:   [B, T, D]
        target: [B, T, D]

    Returns:
        速度 CCC 标量
    """
    pred_vel = pred[:, 1:] - pred[:, :-1]     # [B, T-1, D]
    target_vel = target[:, 1:] - target[:, :-1]

    return compute_ccc(pred_vel, target_vel, dim=1)


class EmotionDrivingLoss(nn.Module):
    """25 维 Emotion 驱动损失（对齐官方评测指标）"""

    def __init__(
        self,
        w_au: float = 1.0,
        w_va: float = 2.0,
        w_exp: float = 0.5,
        w_vel: float = 0.5,
        w_acc: float = 0.2,
        w_div: float = 0.1,
        w_tvar: float = 1.0,
        w_ccc_au: float = 2.0,
        w_ccc_va: float = 3.0,
        w_ccc_exp: float = 1.0,
        w_sync: float = 1.0,
    ):
        """
        Args:
            w_au:     AU 重建损失权重（改用 MSE）
            w_va:     VA 重建损失权重
            w_exp:    EXP 重建损失权重
            w_vel:    速度一致性权重
            w_acc:    加速度一致性权重
            w_div:    跨样本多样性权重
            w_tvar:   时间方差匹配权重（对齐 FRVar）
            w_ccc_au: AU CCC 权重（对齐 FRCorr）
            w_ccc_va: VA CCC 权重（对齐 FRCorr）
            w_ccc_exp: EXP CCC 权重（对齐 FRCorr）
            w_sync:   时间同步权重（对齐 FRSyn）
        """
        super().__init__()
        self.w_au = w_au
        self.w_va = w_va
        self.w_exp = w_exp
        self.w_vel = w_vel
        self.w_acc = w_acc
        self.w_div = w_div
        self.w_tvar = w_tvar
        self.w_ccc_au = w_ccc_au
        self.w_ccc_va = w_ccc_va
        self.w_ccc_exp = w_ccc_exp
        self.w_sync = w_sync

    def forward(self, pred: torch.Tensor, target: torch.Tensor, au_logits: torch.Tensor = None, exp_logits: torch.Tensor = None) -> dict:
        """
        Args:
            pred:   [B, T, 25]
            target: [B, T, 25]
            au_logits: [B, T, 15] 可选，用于 BCEWithLogitsLoss
            exp_logits: [B, T, 8] 可选，用于 BCEWithLogitsLoss
        """
        losses = {}

        # 对齐长度
        T = min(pred.size(1), target.size(1))
        pred = pred[:, :T]
        target = target[:, :T]

        # 分离三组
        pred_au = pred[:, :, AU_SLICE]       # [B, T, 15]
        target_au = target[:, :, AU_SLICE]
        pred_va = pred[:, :, VA_SLICE]       # [B, T, 2]
        target_va = target[:, :, VA_SLICE]
        pred_exp = pred[:, :, EXP_SLICE]     # [B, T, 8]
        target_exp = target[:, :, EXP_SLICE]

        # === AU 重建损失: BCE（AU 数据是二进制 0/1，MSE 趋向均值 0.5）===
        if au_logits is not None:
            l_au = F.binary_cross_entropy_with_logits(au_logits, target_au)
        else:
            l_au = F.binary_cross_entropy(pred_au, target_au)
        losses["au"] = l_au

        # === VA 重建损失: MSE + L1 ===
        l_va = 0.7 * F.mse_loss(pred_va, target_va) + 0.3 * F.l1_loss(pred_va, target_va)
        losses["va"] = l_va

        # === EXP 重建损失 (MSE) ===
        l_exp = F.mse_loss(pred_exp, target_exp)
        losses["exp"] = l_exp

        # === 速度一致性 ===
        pred_vel = pred[:, 1:] - pred[:, :-1]
        target_vel = target[:, 1:] - target[:, :-1]
        l_vel = F.mse_loss(pred_vel, target_vel)
        losses["vel"] = l_vel

        # === 加速度一致性 ===
        if T > 2:
            pred_acc = pred_vel[:, 1:] - pred_vel[:, :-1]
            target_acc = target_vel[:, 1:] - target_vel[:, :-1]
            l_acc = F.mse_loss(pred_acc, target_acc)
        else:
            l_acc = torch.tensor(0.0, device=pred.device)
        losses["acc"] = l_acc

        # === 跨样本多样性正则（间接优化 FRDvs）===
        if pred.size(0) > 1:
            feat_mean = pred.mean(dim=1)  # [B, 25]
            l_div = -torch.pdist(feat_mean).mean()
        else:
            l_div = torch.tensor(0.0, device=pred.device)
        losses["div"] = l_div

        # === 逐维度时间方差匹配 (直接优化 FRVar, 使用 ddof=1 近似) ===
        pred_var = pred.var(dim=1, unbiased=True)   # [B, 25], ddof=1
        target_var = target.var(dim=1, unbiased=True)
        l_tvar = F.mse_loss(pred_var, target_var)
        losses["tvar"] = l_tvar

        # === CCC Loss (直接优化 FRCorr / FRCorr* 评测指标) ===
        l_ccc_au = 1.0 - compute_ccc(pred_au, target_au, dim=1)
        l_ccc_va = 1.0 - compute_ccc(pred_va, target_va, dim=1)
        l_ccc_exp = 1.0 - compute_ccc(pred_exp, target_exp, dim=1)
        l_ccc = (l_ccc_au + l_ccc_va + l_ccc_exp) / 3.0
        losses["ccc"] = l_ccc
        losses["ccc_au"] = l_ccc_au
        losses["ccc_va"] = l_ccc_va
        losses["ccc_exp"] = l_ccc_exp

        # === 时间同步 Loss (直接优化 FRSyn TLCC) ===
        # 速度 CCC：预测与 GT 的运动节奏一致性
        l_sync = 1.0 - compute_velocity_corr(pred, target)
        losses["sync"] = l_sync

        # === 总损失 ===
        total = (self.w_au * l_au +
                 self.w_va * l_va +
                 self.w_exp * l_exp +
                 self.w_vel * l_vel +
                 self.w_acc * l_acc +
                 self.w_div * l_div +
                 self.w_tvar * l_tvar +
                 self.w_ccc_au * l_ccc_au +
                 self.w_ccc_va * l_ccc_va +
                 self.w_ccc_exp * l_ccc_exp +
                 self.w_sync * l_sync)
        losses["total"] = total

        return losses


class EmotionDrivingLossV2(nn.Module):
    """
    25 维 Emotion 驱动损失 V2 — 抗过拟合 + 对齐评测指标

    改进:
      - AU 使用 BCE（AU 数据是二进制）
      - VA 使用 MSE + L1（更鲁棒）
      - EXP 使用 label smoothing BCE
      - CCC 权重大幅提高（直接优化 FRCorr，占比最大的指标）
      - 新增 L1 辅助损失（更平滑的梯度）
    """

    def __init__(
        self,
        w_au: float = 1.0,
        w_va: float = 2.0,
        w_exp: float = 0.5,
        w_vel: float = 0.5,
        w_acc: float = 0.2,
        w_div: float = 0.1,
        w_tvar: float = 1.0,
        w_ccc_au: float = 5.0,
        w_ccc_va: float = 8.0,
        w_ccc_exp: float = 3.0,
        w_sync: float = 2.0,
        w_l1: float = 0.5,
        exp_label_smoothing: float = 0.1,
    ):
        super().__init__()
        self.w_au = w_au
        self.w_va = w_va
        self.w_exp = w_exp
        self.w_vel = w_vel
        self.w_acc = w_acc
        self.w_div = w_div
        self.w_tvar = w_tvar
        self.w_ccc_au = w_ccc_au
        self.w_ccc_va = w_ccc_va
        self.w_ccc_exp = w_ccc_exp
        self.w_sync = w_sync
        self.w_l1 = w_l1
        self.exp_label_smoothing = exp_label_smoothing

    def forward(self, pred: torch.Tensor, target: torch.Tensor,
                au_logits: torch.Tensor = None, exp_logits: torch.Tensor = None) -> dict:
        """
        Args:
            pred:   [B, T, 25] 模型输出（AU 已过 Sigmoid, VA 已过 Tanh, EXP 已过 Softmax）
            target: [B, T, 25] 真实标签
            au_logits: [B, T, 15] 可选，用于 BCEWithLogitsLoss
            exp_logits: [B, T, 8] 可选，用于 BCEWithLogitsLoss + label smoothing

        Returns:
            dict with individual and total losses
        """
        losses = {}

        # 对齐长度
        T = min(pred.size(1), target.size(1))
        pred = pred[:, :T]
        target = target[:, :T]

        # 分离三组
        pred_au = pred[:, :, AU_SLICE]
        target_au = target[:, :, AU_SLICE]
        pred_va = pred[:, :, VA_SLICE]
        target_va = target[:, :, VA_SLICE]
        pred_exp = pred[:, :, EXP_SLICE]
        target_exp = target[:, :, EXP_SLICE]

        # === AU: BCEWithLogits（AU 数据是二进制，使用 logits 更稳定且 AMP 友好）===
        if au_logits is not None:
            l_au = F.binary_cross_entropy_with_logits(au_logits, target_au)
        else:
            l_au = F.binary_cross_entropy(pred_au, target_au)
        losses["au"] = l_au

        # === VA: MSE + L1 ===
        l_va = 0.7 * F.mse_loss(pred_va, target_va) + 0.3 * F.l1_loss(pred_va, target_va)
        losses["va"] = l_va

        # === EXP: BCE with label smoothing ===
        if exp_logits is not None and self.exp_label_smoothing > 0:
            smooth = target_exp * (1 - self.exp_label_smoothing) + \
                     torch.full_like(target_exp, 1.0 / 8) * self.exp_label_smoothing
            l_exp = F.binary_cross_entropy_with_logits(exp_logits, smooth)
        elif exp_logits is not None:
            l_exp = F.cross_entropy(exp_logits.transpose(-1, -2), target_exp.argmax(dim=-1))
        else:
            l_exp = F.mse_loss(pred_exp, target_exp)
        losses["exp"] = l_exp

        # === 速度一致性 ===
        pred_vel = pred[:, 1:] - pred[:, :-1]
        target_vel = target[:, 1:] - target[:, :-1]
        l_vel = F.mse_loss(pred_vel, target_vel)
        losses["vel"] = l_vel

        # === 加速度一致性 ===
        if T > 2:
            pred_acc = pred_vel[:, 1:] - pred_vel[:, :-1]
            target_acc = target_vel[:, 1:] - target_vel[:, :-1]
            l_acc = F.mse_loss(pred_acc, target_acc)
        else:
            l_acc = torch.tensor(0.0, device=pred.device)
        losses["acc"] = l_acc

        # === 跨样本多样性正则（间接优化 FRDvs）===
        if pred.size(0) > 1:
            feat_mean = pred.mean(dim=1)  # [B, 25]
            l_div = -torch.pdist(feat_mean).mean()
        else:
            l_div = torch.tensor(0.0, device=pred.device)
        losses["div"] = l_div

        # === 逐维度时间方差匹配 (直接优化 FRVar) ===
        pred_var = pred.var(dim=1, unbiased=True)   # [B, 25], ddof=1
        target_var = target.var(dim=1, unbiased=True)
        l_tvar = F.mse_loss(pred_var, target_var)
        losses["tvar"] = l_tvar

        # === L1 辅助损失（更平滑的梯度信号）===
        l_l1 = F.l1_loss(pred, target)
        losses["l1"] = l_l1

        # === CCC Loss (直接优化 FRCorr — 最高权重) ===
        l_ccc_au = 1.0 - compute_ccc(pred_au, target_au, dim=1)
        l_ccc_va = 1.0 - compute_ccc(pred_va, target_va, dim=1)
        l_ccc_exp = 1.0 - compute_ccc(pred_exp, target_exp, dim=1)
        l_ccc = (l_ccc_au + l_ccc_va + l_ccc_exp) / 3.0
        losses["ccc"] = l_ccc
        losses["ccc_au"] = l_ccc_au
        losses["ccc_va"] = l_ccc_va
        losses["ccc_exp"] = l_ccc_exp

        # === 时间同步 Loss (直接优化 FRSyn TLCC) ===
        l_sync = 1.0 - compute_velocity_corr(pred, target)
        losses["sync"] = l_sync

        # === 总损失 ===
        total = (self.w_au * l_au +
                 self.w_va * l_va +
                 self.w_exp * l_exp +
                 self.w_vel * l_vel +
                 self.w_acc * l_acc +
                 self.w_div * l_div +
                 self.w_tvar * l_tvar +
                 self.w_l1 * l_l1 +
                 self.w_ccc_au * l_ccc_au +
                 self.w_ccc_va * l_ccc_va +
                 self.w_ccc_exp * l_ccc_exp +
                 self.w_sync * l_sync)
        losses["total"] = total

        return losses
