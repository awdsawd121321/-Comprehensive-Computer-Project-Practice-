"""
face_driving.evaluation — 官方协议评测模块

提供:
  - official_evaluate: 复刻官方 eval_emotion_metrics.py 的指标计算
  - eval_pipeline: 一键生成预测 + 评测流程
"""

from .official_evaluate import (
    evaluate_prediction,
    compute_score_breakdown,
    format_report,
    compute_frcorr,
    compute_frdist,
    compute_frdiv,
    compute_frdvs,
    compute_frvar,
    compute_frsyn,
    concordance_correlation_coefficient,
    weighted_dtw,
)
