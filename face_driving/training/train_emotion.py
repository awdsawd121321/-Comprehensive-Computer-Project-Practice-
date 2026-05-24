"""
Emotion Driving Model 训练脚本 (25 维输出)

用法:
    python -m face_driving.training.train_emotion --config face_driving/configs/emotion_default.yaml
    python -m face_driving.training.train_emotion --config face_driving/configs/emotion_default.yaml --resume face_driving/checkpoints_emotion/epoch_20.pt
"""

import os
import yaml
import argparse
import math
import random
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, random_split
from torch.optim.lr_scheduler import LambdaLR
from torch.utils.tensorboard import SummaryWriter
from pathlib import Path
from tqdm import tqdm

from face_driving.model.emotion_driving_model import EmotionDrivingModel, EMA
from face_driving.model.emotion_losses import EmotionDrivingLossV2
from face_driving.training.emotion_dataset import EmotionDataset


def load_config(config_path: str) -> dict:
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def build_model(cfg: dict) -> EmotionDrivingModel:
    mc = cfg["model"]
    return EmotionDrivingModel(
        audio_encoder_name=mc["audio_encoder"],
        audio_feat_dim=mc["audio_feat_dim"],
        freeze_audio_encoder=mc["freeze_audio_encoder"],
        d_model=mc["d_model"],
        n_heads=mc["n_heads"],
        n_layers=mc["n_layers"],
        dropout=mc["dropout"],
        output_fps=mc["output_fps"],
        noise_sigma=mc.get("noise_sigma", 0.01),
    )


def progressive_unfreeze(model, epoch, start_epoch=0):
    """
    渐进式解冻 HuBERT 编码器

    解冻计划（相对于 start_epoch）:
      - 0-9 epochs: 完全冻结
      - 10+ epochs: 解冻最后 2 层
    """
    if not hasattr(model, 'audio_encoder'):
        return False

    encoder = model.audio_encoder
    total_layers = len(encoder.encoder.layers)
    adjusted_epoch = epoch - start_epoch
    changed = False

    if adjusted_epoch >= 10 and not any(
        p.requires_grad for p in encoder.encoder.layers[-1].parameters()
    ):
        # 解冻最后 2 层
        for i in range(total_layers - 2, total_layers):
            for p in encoder.encoder.layers[i].parameters():
                p.requires_grad = True
        changed = True

    if changed:
        trainable = sum(p.numel() for p in encoder.parameters() if p.requires_grad)
        total = sum(p.numel() for p in encoder.parameters())
        print(f"  [Unfreeze] Epoch {epoch+1}: HuBERT {trainable}/{total} params trainable")

    return changed


def get_layerwise_lr_groups(model, base_lr, weight_decay):
    """
    创建分层学习率参数组
    - HuBERT 层: 较低学习率（越底层越低）
    - Backbone: base_lr
    """
    groups = []
    backbone_params = []
    total_hubert_layers = len(model.audio_encoder.encoder.layers)
    decay = 0.85

    for name, param in model.named_parameters():
        if not param.requires_grad:
            continue

        if "audio_encoder" in name:
            # 确定层号
            layer_num = None
            parts = name.split(".")
            for i, part in enumerate(parts):
                if part == "layers" and i + 1 < len(parts):
                    try:
                        layer_num = int(parts[i + 1])
                    except ValueError:
                        pass

            if layer_num is not None:
                layer_lr = base_lr * (decay ** (total_hubert_layers - layer_num))
            else:
                layer_lr = base_lr * (decay ** (total_hubert_layers + 1))
            groups.append({"params": [param], "lr": layer_lr, "weight_decay": weight_decay})
        else:
            backbone_params.append(param)

    groups.append({"params": backbone_params, "lr": base_lr, "weight_decay": weight_decay})
    return groups


def get_cosine_warmup_scheduler(optimizer, warmup_steps, total_steps, eta_min=1e-5):
    """线性 warmup + cosine decay 调度器（step 级别）"""
    def lr_lambda(step):
        if step < warmup_steps:
            return step / max(1, warmup_steps)
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        return eta_min + 0.5 * (1.0 - eta_min) * (1 + math.cos(math.pi * progress))
    return LambdaLR(optimizer, lr_lambda)


def train_one_epoch(
    model, dataloader, criterion, optimizer, device, grad_clip,
    accumulation_steps=1, scheduler=None, ema=None, scaler=None,
) -> dict:
    model.train()
    if hasattr(model, 'freeze_audio_encoder') and model.freeze_audio_encoder:
        model.audio_encoder.eval()

    epoch_losses = {}
    n_batches = 0
    optimizer.zero_grad()

    for batch in tqdm(dataloader, desc="Train", leave=False):
        audio = batch["speaker_audio"].to(device)
        target = batch["listener_emotion"].to(device)
        emo_cond = batch["speaker_emo_cond"].to(device)

        with torch.cuda.amp.autocast(enabled=scaler is not None):
            pred, au_logits, exp_logits = model(audio, emo_cond, target_len=target.size(1))
            losses = criterion(pred, target, au_logits=au_logits, exp_logits=exp_logits)

        # 归一化损失以适应梯度累积
        scaled_loss = losses["total"] / accumulation_steps
        if scaler is not None:
            scaler.scale(scaled_loss).backward()
        else:
            scaled_loss.backward()

        if (n_batches + 1) % accumulation_steps == 0:
            if scaler is not None:
                if grad_clip > 0:
                    scaler.unscale_(optimizer)
                    nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
                scaler.step(optimizer)
                scaler.update()
            else:
                if grad_clip > 0:
                    nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
                optimizer.step()
            optimizer.zero_grad()
            if scheduler is not None:
                scheduler.step()
            if ema is not None:
                ema.update()

        for k, v in losses.items():
            epoch_losses[k] = epoch_losses.get(k, 0) + v.item()
        n_batches += 1

    # 处理末尾不足 accumulation_steps 的残余梯度
    if n_batches % accumulation_steps != 0:
        if scaler is not None:
            if grad_clip > 0:
                scaler.unscale_(optimizer)
                nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
            scaler.step(optimizer)
            scaler.update()
        else:
            if grad_clip > 0:
                nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
            optimizer.step()
        optimizer.zero_grad()
        if scheduler is not None:
            scheduler.step()
        if ema is not None:
            ema.update()

    return {k: v / max(n_batches, 1) for k, v in epoch_losses.items()}


@torch.no_grad()
def validate(model, dataloader, criterion, device, ema=None) -> dict:
    model.eval()
    if ema is not None:
        ema.apply()

    epoch_losses = {}
    n_batches = 0

    for batch in tqdm(dataloader, desc="Val", leave=False):
        audio = batch["speaker_audio"].to(device)
        target = batch["listener_emotion"].to(device)
        emo_cond = batch["speaker_emo_cond"].to(device)

        pred, au_logits, exp_logits = model(audio, emo_cond, target_len=target.size(1))
        losses = criterion(pred, target, au_logits=au_logits, exp_logits=exp_logits)

        for k, v in losses.items():
            epoch_losses[k] = epoch_losses.get(k, 0) + v.item()
        n_batches += 1

    if ema is not None:
        ema.restore()

    return {k: v / max(n_batches, 1) for k, v in epoch_losses.items()}


def train(config_path: str, resume_path: str = None, max_epochs_override: int = None):
    cfg = load_config(config_path)
    tc = cfg["training"]

    # 命令行覆盖 epoch 数
    if max_epochs_override is not None:
        tc["max_epochs"] = max_epochs_override

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[Train] Device: {device}")

    # --- 构建模型 ---
    model = build_model(cfg).to(device)
    print(f"[Train] 参数量: {model.get_param_count()}")

    # --- AMP (混合精度) ---
    use_amp = tc.get("use_amp", True) and torch.cuda.is_available()
    scaler = torch.amp.GradScaler("cuda") if use_amp else None
    if use_amp:
        print("[Train] 混合精度 (AMP) 已启用")

    # --- EMA ---
    use_ema = tc.get("use_ema", True)
    ema_decay = tc.get("ema_decay", 0.999)
    ema = EMA(model, decay=ema_decay) if use_ema else None
    if use_ema:
        print(f"[Train] EMA 已启用 (decay={ema_decay})")

    # --- 损失函数 V2 ---
    lw = tc["loss_weights"]
    criterion = EmotionDrivingLossV2(
        w_au=lw.get("au", 1.0),
        w_va=lw.get("va", 2.0),
        w_exp=lw.get("exp", 0.5),
        w_vel=lw.get("velocity", 0.5),
        w_acc=lw.get("acceleration", 0.2),
        w_div=lw.get("diversity", 0.1),
        w_tvar=lw.get("temporal_var", 1.0),
        w_l1=lw.get("l1", 0.5),
        w_ccc_au=lw.get("ccc_au", 5.0),
        w_ccc_va=lw.get("ccc_va", 8.0),
        w_ccc_exp=lw.get("ccc_exp", 3.0),
        w_sync=lw.get("sync", 2.0),
        exp_label_smoothing=tc.get("exp_label_smoothing", 0.1),
    )

    # --- 数据集（含增强） ---
    full_dataset = EmotionDataset(
        data_root=cfg["data"]["data_root"],
        target_audio_sr=cfg["data"]["target_audio_sr"],
        segment_sec=cfg["data"]["segment_sec"],
        target_frames=cfg["data"]["target_frames"],
        augment=tc.get("use_augmentation", False),
    )

    val_ratio = tc.get("val_split", 0.1)
    total = len(full_dataset)
    val_size = int(total * val_ratio)
    train_size = total - val_size
    train_dataset, val_dataset = random_split(
        full_dataset, [train_size, val_size],
        generator=torch.Generator().manual_seed(42),
    )

    train_loader = DataLoader(
        train_dataset, batch_size=tc["batch_size"],
        shuffle=True, num_workers=2, pin_memory=True, drop_last=True,
    )
    val_loader = DataLoader(
        val_dataset, batch_size=tc["batch_size"],
        shuffle=False, num_workers=2, pin_memory=True,
    )

    print(f"[Train] 训练集: {len(train_dataset)} 段, 验证集: {len(val_dataset)} 段")
    if tc.get("use_augmentation"):
        print("[Train] 音频增强已启用")

    # --- 优化器（初始，仅 backbone 参数）---
    accumulation_steps = tc.get("accumulation_steps", 1)
    base_lr = tc["learning_rate"]
    trainable_params = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(trainable_params, lr=base_lr, weight_decay=tc["weight_decay"])

    # --- Scheduler ---
    steps_per_epoch = len(train_loader)
    total_steps = tc["max_epochs"] * steps_per_epoch
    warmup_steps = tc.get("warmup_steps", 500)

    scheduler = None
    if tc.get("lr_scheduler") == "cosine_warmup":
        scheduler = get_cosine_warmup_scheduler(
            optimizer,
            warmup_steps=warmup_steps,
            total_steps=total_steps,
            eta_min=tc.get("lr_eta_min", 1e-6),
        )
        print(f"[Train] 调度器: cosine_warmup, warmup={warmup_steps}, total_steps={total_steps}")
    elif tc.get("lr_scheduler") == "cosine":
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
            optimizer, T_max=tc["max_epochs"], eta_min=1e-6
        )
        print(f"[Train] 调度器: cosine, T_max={tc['max_epochs']}")

    # --- 日志设置 ---
    writer = SummaryWriter(cfg["logging"]["tensorboard_dir"])
    ckpt_dir = Path(cfg["checkpoint"]["save_dir"])
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    logs_dir = Path("face_driving/logs")
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_file = logs_dir / "emotion_train_log.csv"
    if not resume_path:
        log_file.write_text(
            "epoch,train_total,train_au,train_va,train_exp,train_ccc,train_sync,val_total,val_au,val_va,val_exp,val_ccc,val_sync,lr\n"
        )

    # --- 从 checkpoint 恢复 ---
    start_epoch = 0
    best_val_loss = float("inf")
    patience_counter = 0
    global_step = 0

    if resume_path and os.path.exists(resume_path):
        ckpt = torch.load(resume_path, map_location=device, weights_only=False)
        model.load_state_dict(ckpt["model_state_dict"])
        if "optimizer_state_dict" in ckpt:
            optimizer.load_state_dict(ckpt["optimizer_state_dict"])
        start_epoch = ckpt["epoch"] + 1
        best_val_loss = ckpt.get("best_val_loss", float("inf"))
        global_step = ckpt.get("global_step", 0)
        # 恢复 EMA shadow
        if use_ema and "ema_shadow" in ckpt:
            if ema is None:
                ema = EMA(model, decay=ema_decay)
            ema.shadow = ckpt["ema_shadow"]
            print(f"[Train] 恢复 EMA shadow, decay={ema_decay}")
        # 恢复 scheduler
        if scheduler is not None and ckpt.get("scheduler_state_dict") is not None:
            try:
                scheduler.load_state_dict(ckpt["scheduler_state_dict"])
                print(f"[Train] 恢复 scheduler 状态, global_step={global_step}")
            except Exception as e:
                print(f"[Train] scheduler 恢复失败: {e}")
        # 恢复 progressive unfreeze 状态（确保 HuBERT 的 requires_grad 与 checkpoint 一致）
        if "hubert_unfrozen" in ckpt:
            unfrozen_layers = ckpt["hubert_unfrozen"]
            for i in unfrozen_layers:
                for p in model.audio_encoder.encoder.layers[i].parameters():
                    p.requires_grad = True
            print(f"[Train] 恢复 HuBERT unfreeze: layers {unfrozen_layers}")
        print(f"[Train] 恢复: epoch {start_epoch}, best_val_loss={best_val_loss:.6f}")

    # --- 训练循环 ---
    for epoch in range(start_epoch, tc["max_epochs"]):
        print(f"\n=== Epoch {epoch + 1}/{tc['max_epochs']} ===")

        # 渐进式解冻（从 start_epoch 开始计算）
        if tc.get("progressive_unfreeze", False):
            changed = progressive_unfreeze(model, epoch, start_epoch)
            # 解冻后重建优化器以包含新参数（分层学习率）
            if changed:
                groups = get_layerwise_lr_groups(model, base_lr, tc["weight_decay"])
                optimizer = torch.optim.AdamW(groups)

        # 训练
        train_losses = train_one_epoch(
            model, train_loader, criterion, optimizer, device,
            tc["gradient_clip"], accumulation_steps, scheduler,
            ema=ema, scaler=scaler,
        )

        # 验证（用 EMA 权重）
        val_losses = validate(model, val_loader, criterion, device, ema=ema)

        # Scheduler (epoch-based cosine)
        if scheduler is not None and tc.get("lr_scheduler") == "cosine":
            scheduler.step()

        global_step = (epoch + 1) * steps_per_epoch
        lr = optimizer.param_groups[0]["lr"]
        print(f"  Train: total={train_losses['total']:.6f} au={train_losses['au']:.6f} "
              f"va={train_losses['va']:.6f} exp={train_losses['exp']:.6f} "
              f"ccc={train_losses.get('ccc', 0):.4f} sync={train_losses.get('sync', 0):.6f}")
        print(f"  Val:   total={val_losses['total']:.6f} au={val_losses['au']:.6f} "
              f"va={val_losses['va']:.6f} exp={val_losses['exp']:.6f} "
              f"ccc={val_losses.get('ccc', 0):.4f} sync={val_losses.get('sync', 0):.6f}")
        print(f"  LR: {lr:.2e}")

        # 写入 logs
        with open(log_file, "a") as lf:
            train_ccc = train_losses.get("ccc", 0.0)
            train_sync = train_losses.get("sync", 0.0)
            val_ccc = val_losses.get("ccc", 0.0)
            val_sync = val_losses.get("sync", 0.0)
            lf.write(f"{epoch+1},{train_losses['total']:.6f},{train_losses['au']:.6f},"
                     f"{train_losses['va']:.6f},{train_losses['exp']:.6f},{train_ccc:.6f},{train_sync:.6f},"
                     f"{val_losses['total']:.6f},{val_losses['au']:.6f},"
                     f"{val_losses['va']:.6f},{val_losses['exp']:.6f},{val_ccc:.6f},{val_sync:.6f},{lr:.6e}\n")

        # TensorBoard
        for k, v in train_losses.items():
            writer.add_scalar(f"train/{k}", v, epoch)
        for k, v in val_losses.items():
            writer.add_scalar(f"val/{k}", v, epoch)
        writer.add_scalar("lr", lr, epoch)

        # Early stopping
        is_best = val_losses["total"] < best_val_loss
        if is_best:
            best_val_loss = val_losses["total"]
            patience_counter = 0
        else:
            patience_counter += 1

        # 保存 checkpoint
        if is_best or (epoch + 1) % cfg["checkpoint"]["save_every_epoch"] == 0:
            ckpt_path = ckpt_dir / f"epoch_{epoch + 1}.pt"
            save_dict = {
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "train_losses": train_losses,
                "val_losses": val_losses,
                "best_val_loss": best_val_loss,
                "global_step": global_step,
                "config": cfg,
            }
            if scheduler is not None:
                save_dict["scheduler_state_dict"] = scheduler.state_dict()
            # 保存 EMA shadow
            if use_ema and ema is not None:
                save_dict["ema_shadow"] = ema.shadow
                save_dict["ema_decay"] = ema_decay
            # 保存 progressive unfreeze 状态
            if tc.get("progressive_unfreeze", False):
                unfrozen = [
                    i for i in range(12)
                    if any(p.requires_grad for p in model.audio_encoder.encoder.layers[i].parameters())
                ]
                save_dict["hubert_unfrozen"] = unfrozen
            torch.save(save_dict, ckpt_path)

            if is_best:
                best_path = ckpt_dir / "best.pt"
                best_save = {
                    "epoch": epoch,
                    "model_state_dict": model.state_dict(),
                    "global_step": global_step,
                    "config": cfg,
                }
                if use_ema and ema is not None:
                    best_save["ema_shadow"] = ema.shadow
                    best_save["ema_decay"] = ema_decay
                if tc.get("progressive_unfreeze", False):
                    best_save["hubert_unfrozen"] = unfrozen
                torch.save(best_save, best_path)
                print(f"  * Best: {best_path}")

            # 清理旧 checkpoint
            keep_top_k = cfg["checkpoint"].get("keep_top_k", 5)
            epoch_ckpts = sorted(ckpt_dir.glob("epoch_*.pt"), key=lambda p: p.stat().st_mtime)
            while len(epoch_ckpts) > keep_top_k:
                old = epoch_ckpts.pop(0)
                old.unlink()
                print(f"  Clean: {old.name}")

        if patience_counter >= tc["early_stopping_patience"]:
            print(f"\n[Train] Early stop: {tc['early_stopping_patience']} epochs no improvement")
            break

    writer.close()
    print(f"\n[Train] Done. Best val loss: {best_val_loss:.6f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="训练 Emotion Driving Model")
    parser.add_argument("--config", type=str, default="face_driving/configs/emotion_default.yaml")
    parser.add_argument("--resume", type=str, default=None)
    parser.add_argument("--epochs", type=int, default=None, help="覆盖配置中的 max_epochs (快速测试用)")
    args = parser.parse_args()
    train(args.config, args.resume, args.epochs)
