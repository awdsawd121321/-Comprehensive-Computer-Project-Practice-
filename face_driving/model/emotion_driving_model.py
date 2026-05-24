"""
Emotion Driving Model — speaker 音频 → listener 情绪序列 (25 维)

输出 25 维面部行为特征:
  - AU (dim 0-14):  15 个动作单元, Sigmoid → [0,1]
  - VA (dim 15-16): valence/arousal, Tanh → [-1,1]
  - EXP (dim 17-24): 8 个表情概率, Softmax → 和为 1

改进:
  - AU head 输出 logits（去掉内置 Sigmoid），支持 BCEWithLogitsLoss
  - FiLM 条件注入替代 broadcast add
  - predict_k_stable: 更稳定的多样性策略
  - EMA 权重平滑，提升泛化
  - 音频-帧交叉注意力增强 FRSyn 时间同步
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import math


class EMA:
    """
    Exponential Moving Average — 推理时使用平滑权重提升泛化
    """

    def __init__(self, model: nn.Module, decay: float = 0.999):
        self.model = model
        self.decay = decay
        self.shadow = {}
        self.backup = {}
        for name, param in model.named_parameters():
            if param.requires_grad:
                self.shadow[name] = param.data.clone()
        for name, buf in model.named_buffers():
            self.shadow[name] = buf.data.clone()

    @torch.no_grad()
    def update(self):
        for name, param in self.model.named_parameters():
            if param.requires_grad:
                new_val = self.decay * self.shadow[name] + (1 - self.decay) * param.data
                self.shadow[name] = new_val

    def apply(self):
        """临时替换为 EMA 权重（推理前调用）"""
        for name, param in self.model.named_parameters():
            if param.requires_grad:
                self.backup[name] = param.data.clone()
                param.data = self.shadow[name].clone()

    def restore(self):
        """恢复原始权重（推理后调用）"""
        for name, param in self.model.named_parameters():
            if param.requires_grad and name in self.backup:
                param.data = self.backup[name].clone()
        self.backup = {}

    def state_dict(self):
        return {"shadow": self.shadow, "decay": self.decay}

    def load_state_dict(self, state_dict):
        self.shadow = state_dict["shadow"]
        self.decay = state_dict.get("decay", self.decay)


class PositionalEncoding(nn.Module):
    def __init__(self, d_model: int, max_len: int = 5000, dropout: float = 0.1):
        super().__init__()
        self.dropout = nn.Dropout(p=dropout)
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0)
        self.register_buffer("pe", pe)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.pe[:, :x.size(1)]
        return self.dropout(x)


class FiLMConditioner(nn.Module):
    """Feature-wise Linear Modulation: gamma * x + beta"""
    def __init__(self, cond_dim: int, d_model: int):
        super().__init__()
        self.gamma_net = nn.Sequential(
            nn.Linear(cond_dim, d_model),
            nn.GELU(),
            nn.Linear(d_model, d_model),
        )
        self.beta_net = nn.Sequential(
            nn.Linear(cond_dim, d_model),
            nn.GELU(),
            nn.Linear(d_model, d_model),
        )

    def forward(self, x: torch.Tensor, cond: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x:    [B, T, d_model]
            cond: [B, cond_dim]
        Returns:
            [B, T, d_model]
        """
        gamma = self.gamma_net(cond).unsqueeze(1)  # [B, 1, d_model]
        beta = self.beta_net(cond).unsqueeze(1)
        return gamma * x + beta


class AudioFrameCrossAttention(nn.Module):
    """
    音频特征到输出帧的交叉注意力
    增强 audio-to-face 的时间对齐，直接改善 FRSyn

    audio_feat [B, T_audio, d_model] 作为 K/V
    frame_feat [B, T_out, d_model] 作为 Q
    输出 [B, T_out, d_model]，每帧 attend 到对应音频时刻
    """
    def __init__(self, d_model: int, n_heads: int = 4):
        super().__init__()
        self.cross_attn = nn.MultiheadAttention(
            embed_dim=d_model,
            num_heads=n_heads,
            dropout=0.1,
            batch_first=True,
        )
        self.norm = nn.LayerNorm(d_model)
        self.ffn = nn.Sequential(
            nn.Linear(d_model, d_model * 2),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(d_model * 2, d_model),
            nn.Dropout(0.1),
        )

    def forward(self, frame_feat: torch.Tensor, audio_feat: torch.Tensor) -> torch.Tensor:
        """
        Args:
            frame_feat: [B, T_out, d_model] — 输出帧特征
            audio_feat: [B, T_audio, d_model] — 音频特征
        Returns:
            [B, T_out, d_model]
        """
        # 交叉注意力: Q=frame_feat, K/V=audio_feat
        attn_out, _ = self.cross_attn(
            query=frame_feat,
            key=audio_feat,
            value=audio_feat,
        )
        x = self.norm(frame_feat + attn_out)
        x = x + self.ffn(x)
        return x


class EmotionDrivingModel(nn.Module):
    """
    Speaker 音频 → Listener 情绪序列 (25 维)

    输入:
        audio_input:      [B, wav_len] 16kHz 音频
        emotion_cond:     [B, 10] speaker 情绪条件 (valence + arousal + 8 离散概率)
        noise_sigma:      float, transformer 输出后的 noise 强度 (0 = 无噪声)

    输出:
        emotion_output:   [B, T, 25] listener 情绪序列

    架构改进:
      - AudioFrameCrossAttention: 音频-帧交叉注意力增强时间同步（FRSyn）
      - 预测头部更深，支持 MC Dropout 多样性
    """

    def __init__(
        self,
        audio_encoder_name: str = "TencentGameMate/chinese-hubert-base",
        audio_feat_dim: int = 768,
        freeze_audio_encoder: bool = True,
        d_model: int = 256,
        n_heads: int = 4,
        n_layers: int = 4,
        dropout: float = 0.1,
        output_fps: int = 25,
        noise_sigma: float = 0.0,
    ):
        super().__init__()

        self.output_fps = output_fps
        self.freeze_audio_encoder = freeze_audio_encoder
        self.noise_sigma = noise_sigma
        self.d_model = d_model

        # 输出维度
        self.n_au = 15
        self.n_va = 2
        self.n_exp = 8

        # === 音频编码器 (HuBERT) ===
        from transformers import HubertModel
        self.audio_encoder = HubertModel.from_pretrained(audio_encoder_name)
        if freeze_audio_encoder:
            for param in self.audio_encoder.parameters():
                param.requires_grad = False
            self.audio_encoder.eval()

        self.audio_proj = nn.Sequential(
            nn.Linear(audio_feat_dim, d_model),
            nn.LayerNorm(d_model),
            nn.GELU(),
        )

        # === FiLM 情绪条件注入 ===
        self.film = FiLMConditioner(cond_dim=10, d_model=d_model)

        # === 位置编码 + Transformer ===
        self.pos_enc = PositionalEncoding(d_model, max_len=2000, dropout=dropout)

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_model * 4,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=n_layers)

        # === Audio-Frame 交叉注意力（增强 FRSyn 时间对齐）===
        self.audio_cross_attn = AudioFrameCrossAttention(d_model, n_heads=n_heads)

        # === 三头输出（AU 输出 logits，支持 BCEWithLogitsLoss）===
        # AU Head: 15 维, 输出 logits（手动 Sigmoid）
        self.au_head = nn.Sequential(
            nn.Linear(d_model, d_model),
            nn.GELU(),
            nn.LayerNorm(d_model),
            nn.Dropout(dropout),
            nn.Linear(d_model, d_model // 2),
            nn.GELU(),
            nn.Linear(d_model // 2, self.n_au),
            # 注意：不加 Sigmoid，forward 中手动应用以支持 BCEWithLogitsLoss
        )

        # VA Head: 2 维, Tanh
        self.va_head = nn.Sequential(
            nn.Linear(d_model, d_model),
            nn.GELU(),
            nn.LayerNorm(d_model),
            nn.Dropout(dropout),
            nn.Linear(d_model, d_model // 2),
            nn.GELU(),
            nn.Linear(d_model // 2, self.n_va),
            nn.Tanh(),
        )

        # EXP Head: 8 维, Softmax
        self.exp_head = nn.Sequential(
            nn.Linear(d_model, d_model),
            nn.GELU(),
            nn.LayerNorm(d_model),
            nn.Dropout(dropout),
            nn.Linear(d_model, d_model // 2),
            nn.GELU(),
            nn.Linear(d_model // 2, self.n_exp),
        )

    def _encode(
        self,
        audio_input: torch.Tensor,
        emotion_cond: torch.Tensor,
        target_len: int = None,
        return_audio_feat: bool = False,
    ) -> torch.Tensor:
        """共享编码器：音频 → HuBERT → proj → FiLM → Transformer → AudioCrossAttn → 帧率适配"""
        # 1. 音频特征
        if self.freeze_audio_encoder:
            with torch.no_grad():
                audio_feat = self.audio_encoder(audio_input).last_hidden_state
        else:
            audio_feat = self.audio_encoder(audio_input).last_hidden_state
        audio_feat_proj = self.audio_proj(audio_feat)  # [B, T_audio, d_model]

        # 2. FiLM 条件注入
        feat = self.film(audio_feat_proj, emotion_cond)

        # 3. 位置编码 + Transformer
        feat = self.pos_enc(feat)
        feat = self.transformer(feat)

        # 4. Audio-Frame 交叉注意力（增强时间对齐）
        feat = self.audio_cross_attn(feat, audio_feat_proj)

        # 5. 帧率适配
        if target_len is None:
            audio_duration = audio_input.size(1) / 16000.0
            target_len = int(audio_duration * self.output_fps)

        if target_len != feat.size(1) and target_len > 0:
            feat = feat.permute(0, 2, 1)
            feat = F.interpolate(feat, size=target_len, mode="linear", align_corners=False)
            feat = feat.permute(0, 2, 1)

        if return_audio_feat:
            return feat, audio_feat_proj
        return feat

    def _encode_from_audio_feat(
        self,
        audio_feat_proj: torch.Tensor,
        emotion_cond: torch.Tensor,
        target_len: int = None,
    ) -> torch.Tensor:
        """
        从预计算的 audio_feat_proj 开始编码，跳过 HuBERT 重计算。
        用于 predict_k_diverse：HuBERT 只算一次，后面的 FiLM+Transformer 重用。
        """
        # 1. FiLM 条件注入
        feat = self.film(audio_feat_proj, emotion_cond)

        # 2. 位置编码 + Transformer
        feat = self.pos_enc(feat)
        feat = self.transformer(feat)

        # 3. Audio-Frame 交叉注意力
        feat = self.audio_cross_attn(feat, audio_feat_proj)

        # 4. 帧率适配
        if target_len != feat.size(1) and target_len > 0:
            feat = feat.permute(0, 2, 1)
            feat = F.interpolate(feat, size=target_len, mode="linear", align_corners=False)
            feat = feat.permute(0, 2, 1)

        return feat

    def forward(
        self,
        audio_input: torch.Tensor,
        emotion_cond: torch.Tensor,
        target_len: int = None,
        noise_sigma: float = None,
        mc_dropout: bool = False,
        return_logits: bool = False,
    ) -> torch.Tensor:
        """
        Args:
            audio_input:  [B, wav_len] 16kHz
            emotion_cond: [B, 10]
            target_len:   目标帧数 (None = 自动计算)
            noise_sigma:  noise 强度覆盖
            mc_dropout:   是否启用 MC Dropout（推理时多样化）
            return_logits: 是否返回 AU logits（用于 BCE loss）

        Returns:
            return_logits=False: [B, T, 25] 概率输出
            return_logits=True:  (output, au_logits) 元组
        """
        sigma = noise_sigma if noise_sigma is not None else self.noise_sigma

        # 推理时可选启用 dropout（需 model.train() 模式）
        if mc_dropout:
            self.train()
        else:
            self.eval()

        feat = self._encode(audio_input, emotion_cond, target_len)

        # 噪声注入（在 logit space，即激活前）
        if sigma > 0 and self.training:
            noise = torch.randn_like(feat) * sigma
            feat = feat + noise

        # 三头输出
        au_logits = self.au_head(feat)        # [B, T, 15] logits
        au_out = torch.sigmoid(au_logits)      # [B, T, 15] probabilities
        va_out = self.va_head(feat)            # [B, T, 2] tanh activated
        exp_logits = self.exp_head(feat)       # [B, T, 8] logits
        exp_out = F.softmax(exp_logits, dim=-1) # [B, T, 8] probabilities

        output = torch.cat([au_out, va_out, exp_out], dim=-1)

        return output, au_logits, exp_logits

    def predict_k(
        self,
        audio_input: torch.Tensor,
        emotion_cond: torch.Tensor,
        target_len: int = 750,
        k: int = 10,
        noise_sigma: float = 0.3,
        mc_dropout: bool = True,
    ) -> torch.Tensor:
        """
        生成 K 条不同候选（稳定版多样性策略）

        多样性策略（不再使用 logit 反演 + 时序偏移，避免数值不稳定和 FRSyn 退化）：
          1. 在 transformer 特征上加递增噪声（核心多样性来源）
          2. MC Dropout（不同 dropout mask）

        Returns:
            [B, K, T, 25]
        """
        self.eval()
        with torch.no_grad():
            feat = self._encode(audio_input, emotion_cond, target_len)

            results = []
            for i in range(k):
                # 递增噪声: 低噪→高噪，早期候选更接近确定性输出
                scale = noise_sigma * (0.2 + 0.8 * i / max(k - 1, 1))
                f_i = feat + torch.randn_like(feat) * scale

                au_out = torch.sigmoid(self.au_head(f_i))
                va_out = self.va_head(f_i)
                exp_out = F.softmax(self.exp_head(f_i), dim=-1)

                out = torch.cat([au_out, va_out, exp_out], dim=-1)
                results.append(out.unsqueeze(1))

        return torch.cat(results, dim=1)  # [B, K, T, 25]

    def predict_k_diverse(
        self,
        audio_input: torch.Tensor,
        emotion_cond: torch.Tensor,
        target_len: int = 750,
        k: int = 10,
        noise_sigma: float = 0.3,
    ) -> torch.Tensor:
        """
        多样性增强版 predict_k — 混合策略提升 FRDiv

        三层候选策略:
          Tier 1 (0-3): 原始条件 + 微噪声 → 保 FRCorr/FRSyn
          Tier 2 (4-6): 轻度条件偏移 + 中噪声 → 平衡质量与多样性
          Tier 3 (7-9): 较强条件偏移 + 高噪声 → 拉高 FRDiv

        条件偏移通过重新 FiLM+Transformer 实现（共享 HuBERT 计算）

        Returns:
            [B, K, T, 25]
        """
        self.eval()
        with torch.no_grad():
            # 1. HuBERT 编码一次（最耗时的部分）
            if self.freeze_audio_encoder:
                audio_feat = self.audio_encoder(audio_input).last_hidden_state
            else:
                audio_feat = self.audio_encoder(audio_input).last_hidden_state
            audio_feat_proj = self.audio_proj(audio_feat)

            # 2. 原始条件特征（Tier 1 基准）
            feat_base = self._encode_from_audio_feat(audio_feat_proj, emotion_cond, target_len)

            # 3. 生成两组偏移条件特征（共享 audio_feat_proj）
            cond_moderate = emotion_cond + torch.randn_like(emotion_cond) * 0.2
            feat_moderate = self._encode_from_audio_feat(audio_feat_proj, cond_moderate, target_len)

            cond_strong = emotion_cond + torch.randn_like(emotion_cond) * 0.5
            feat_strong = self._encode_from_audio_feat(audio_feat_proj, cond_strong, target_len)

            # 4. 按层级生成候选
            results = []
            for i in range(k):
                if i < 4:
                    # Tier 1: 原始特征 + 微噪声 (保质量)
                    scale = noise_sigma * (0.03 + 0.07 * i)
                    f_i = feat_base + torch.randn_like(feat_base) * scale
                elif i < 7:
                    # Tier 2: 混合原始+偏移特征 + 中噪声
                    alpha = 0.3 + 0.2 * (i - 4)  # 0.3, 0.5, 0.7
                    f_i = (1 - alpha) * feat_base + alpha * feat_moderate
                    f_i = f_i + torch.randn_like(f_i) * noise_sigma * 0.4
                else:
                    # Tier 3: 混合原始+强偏移特征 + 高噪声
                    alpha = 0.4 + 0.2 * (i - 7)  # 0.4, 0.6, 0.8
                    f_i = (1 - alpha) * feat_base + alpha * feat_strong
                    f_i = f_i + torch.randn_like(f_i) * noise_sigma * 0.8

                au_out = torch.sigmoid(self.au_head(f_i))
                va_out = self.va_head(f_i)
                exp_out = F.softmax(self.exp_head(f_i), dim=-1)

                out = torch.cat([au_out, va_out, exp_out], dim=-1)
                results.append(out.unsqueeze(1))

        return torch.cat(results, dim=1)  # [B, K, T, 25]
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        return {"total": total, "trainable": trainable, "trainable_M": f"{trainable / 1e6:.2f}M"}
