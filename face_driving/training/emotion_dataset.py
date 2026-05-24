"""
Emotion 数据集 — speaker 音频 → listener 情绪序列配对

任务: 给定说话者音频，预测听者的面部行为反应 (25 维 Emotion 特征)

数据配对逻辑:
    每个 session 中 clip_id 相同的 speaker 和 listener 构成一对:
    - NoXI: Expert_video/{clip}.wav (speaker) ↔ P2/{clip}.csv (listener)
            Novice_video/{clip}.wav (speaker) ↔ P1/{clip}.csv (listener)
    - RECOLA: P25/{clip}.wav ↔ P2/{clip}.csv, P26/{clip}.wav ↔ P1/{clip}.csv

输出:
    speaker_audio:       [80000] float32 (16kHz mono, 5 秒片段或整 clip)
    listener_emotion:    [750, 25] float32 (15 AU + 2 VA + 8 EXP)
    speaker_emo_cond:    [10] float32 (speaker 情绪条件)
"""

import os
import random
import numpy as np
import pandas as pd
import torch
import scipy.io.wavfile as wavfile
import scipy.signal
from pathlib import Path
from torch.utils.data import Dataset

from face_driving.preprocess.blendshape_definitions import (
    CONTINUOUS_EMOTION_COLUMNS,
    DISCRETE_EMOTION_COLUMNS,
    NOXI_ROLE_MAP,
    DATA_FPS,
)

# RECOLA subject → Emotion role 映射
RECOLA_SUBJECT_ROLE = {
    "P25": "P1",
    "P26": "P2",
    "P41": "P1",
    "P42": "P2",
    "P45": "P1",
    "P46": "P2",
}


class AudioAugmentor:
    """
    轻量级音频增强流水线 — 在训练时随机变换音频

    变换:
      1. 高斯噪声注入 (σ=0.005, 50% 概率)
      2. 随机增益 (0.8~1.2, 50% 概率)
      3. 随机时间平移 (circular shift ±2%, 30% 概率)
      4. 随机片段静音 (5% 能量, 30% 概率)
    """

    def __init__(
        self,
        noise_sigma: float = 0.005,
        gain_range: tuple = (0.8, 1.2),
        time_shift_ratio: float = 0.02,
        dropout_prob: float = 0.3,
        dropout_range: tuple = (0.005, 0.02),
    ):
        self.noise_sigma = noise_sigma
        self.gain_range = gain_range
        self.time_shift_ratio = time_shift_ratio
        self.dropout_prob = dropout_prob
        self.dropout_range = dropout_range

    def __call__(self, audio: torch.Tensor) -> torch.Tensor:
        r = random.random()

        # 1. 高斯噪声 (50% 概率)
        if r < 0.5:
            audio = audio + torch.randn_like(audio) * self.noise_sigma

        # 2. 随机增益 (50% 概率)
        r = random.random()
        if r < 0.5:
            audio = audio * random.uniform(*self.gain_range)

        # 3. 随机时间平移 (30% 概率，circular shift)
        r = random.random()
        if r < 0.3:
            shift = random.randint(
                -int(len(audio) * self.time_shift_ratio),
                int(len(audio) * self.time_shift_ratio),
            )
            audio = torch.roll(audio, shift, dims=0)

        # 4. 随机片段静音 (30% 概率)
        r = random.random()
        if r < self.dropout_prob:
            mask_len = random.randint(
                int(len(audio) * self.dropout_range[0]),
                int(len(audio) * self.dropout_range[1]),
            )
            mask_start = random.randint(0, max(0, len(audio) - mask_len))
            audio = audio.clone()
            audio[mask_start:mask_start + mask_len] *= 0.1

        return audio


class EmotionDataset(Dataset):
    """
    speaker 音频 → listener 情绪序列配对数据集
    """

    def __init__(
        self,
        data_root: str,
        target_audio_sr: int = 16000,
        segment_sec: float = 30.0,
        target_frames: int = 750,
        augment: bool = False,
    ):
        self.data_root = Path(data_root)
        self.target_audio_sr = target_audio_sr
        self.segment_sec = segment_sec
        self.target_frames = target_frames
        self.segment_audio_len = int(segment_sec * target_audio_sr)  # 480000 @ 30s
        self.augment = augment
        self.audio_augmentor = AudioAugmentor() if augment else None

        self.samples = []
        self._build_index()

    def _build_index(self):
        """扫描数据目录，构建 speaker audio → listener emotion 配对索引"""
        audio_root = self.data_root / "Audio_files"
        emotion_root = self.data_root / "Emotion"

        if not audio_root.exists() or not emotion_root.exists():
            print(f"[EmotionDataset] 目录不存在: {audio_root} 或 {emotion_root}")
            return

        # 处理 NoXI
        noxi_audio = audio_root / "NoXI"
        if noxi_audio.exists():
            self._index_noxi(noxi_audio, emotion_root / "NoXI")

        # 处理 RECOLA
        recola_audio = audio_root / "RECOLA"
        if recola_audio.exists():
            self._index_recola(recola_audio, emotion_root / "RECOLA")

        print(f"[EmotionDataset] 索引完成: {len(self.samples)} 个配对样本")

    def _index_noxi(self, audio_root: Path, emotion_root: Path):
        """索引 NoXI: 双向配对"""
        # NoXI Emotion: P1=Expert, P2=Novice
        # speaker=Expert, listener=P2 / speaker=Novice, listener=P1
        pairings = [
            ("Expert_video", "P2"),  # Expert 说 → P2 情绪反应
            ("Novice_video", "P1"),  # Novice 说 → P1 情绪反应
        ]

        for session_dir in sorted(audio_root.iterdir()):
            if not session_dir.is_dir() or session_dir.name.startswith("."):
                continue
            session_name = session_dir.name

            for speaker_role, listener_emo_role in pairings:
                speaker_audio_dir = session_dir / speaker_role
                listener_emo_dir = emotion_root / session_name / listener_emo_role
                # speaker 的情绪条件也加载
                speaker_emo_role = "P1" if speaker_role == "Expert_video" else "P2"
                speaker_emo_dir = emotion_root / session_name / speaker_emo_role

                if not speaker_audio_dir.exists() or not listener_emo_dir.exists():
                    continue

                for wav_file in sorted(speaker_audio_dir.glob("*.wav")):
                    if wav_file.name.startswith("."):
                        continue
                    clip_id = wav_file.stem
                    listener_csv = listener_emo_dir / f"{clip_id}.csv"
                    speaker_csv = speaker_emo_dir / f"{clip_id}.csv"

                    if not listener_csv.exists():
                        continue

                    self.samples.append({
                        "speaker_audio_path": str(wav_file),
                        "listener_emo_path": str(listener_csv),
                        "speaker_emo_path": str(speaker_csv) if speaker_csv.exists() else None,
                    })

    def _index_recola(self, audio_root: Path, emotion_root: Path):
        """索引 RECOLA: 按分组配对"""
        for group_dir in sorted(audio_root.iterdir()):
            if not group_dir.is_dir() or group_dir.name.startswith("."):
                continue
            group_name = group_dir.name

            # 动态发现 subject 目录
            subject_dirs = sorted([
                d.name for d in group_dir.iterdir()
                if d.is_dir() and not d.name.startswith(".")
            ])

            if len(subject_dirs) < 2:
                continue

            # subjects[0] 说 → P2 听, subjects[1] 说 → P1 听
            pairings = [
                (subject_dirs[0], "P2"),
                (subject_dirs[1], "P1"),
            ]

            for subject, listener_role in pairings:
                speaker_audio_dir = group_dir / subject
                listener_emo_dir = emotion_root / group_name / listener_role
                speaker_role = RECOLA_SUBJECT_ROLE.get(subject, "P1")
                speaker_emo_dir = emotion_root / group_name / speaker_role

                if not speaker_audio_dir.exists() or not listener_emo_dir.exists():
                    continue

                for wav_file in sorted(speaker_audio_dir.glob("*.wav")):
                    if wav_file.name.startswith("."):
                        continue
                    clip_id = wav_file.stem
                    listener_csv = listener_emo_dir / f"{clip_id}.csv"
                    speaker_csv = speaker_emo_dir / f"{clip_id}.csv"

                    if not listener_csv.exists():
                        continue

                    self.samples.append({
                        "speaker_audio_path": str(wav_file),
                        "listener_emo_path": str(listener_csv),
                        "speaker_emo_path": str(speaker_csv) if speaker_csv.exists() else None,
                    })

    def _load_audio(self, path: str) -> torch.Tensor:
        """加载音频并降采样到 16kHz mono"""
        sr, wav_data = wavfile.read(path)
        if wav_data.dtype == np.int16:
            wav_data = wav_data.astype(np.float32) / 32768.0
        elif wav_data.dtype == np.int32:
            wav_data = wav_data.astype(np.float32) / 2147483648.0
        elif wav_data.dtype != np.float32:
            wav_data = wav_data.astype(np.float32)

        # stereo → mono
        if wav_data.ndim > 1:
            wav_data = wav_data.mean(axis=1)

        # 降采样到 target_audio_sr
        if sr != self.target_audio_sr:
            n_target = int(len(wav_data) * self.target_audio_sr / sr)
            wav_data = scipy.signal.resample(wav_data, n_target).astype(np.float32)

        # 裁切或 padding 到固定长度
        audio_tensor = torch.from_numpy(wav_data)
        if audio_tensor.size(0) > self.segment_audio_len:
            audio_tensor = audio_tensor[:self.segment_audio_len]
        elif audio_tensor.size(0) < self.segment_audio_len:
            audio_tensor = torch.nn.functional.pad(
                audio_tensor, (0, self.segment_audio_len - audio_tensor.size(0))
            )

        return audio_tensor

    def _load_emotion(self, path: str) -> np.ndarray:
        """加载 Emotion CSV 为 [T, 25] 数组"""
        # 尝试不同编码
        for enc in ["utf-8", "utf-8-sig", "gbk", "latin-1"]:
            try:
                df = pd.read_csv(path, encoding=enc)
                break
            except (UnicodeDecodeError, UnicodeError):
                continue
        else:
            raise ValueError(f"无法读取 CSV: {path}")

        data = df.values.astype(np.float32)  # [T, 25]

        # 裁切或 padding 到 target_frames
        if data.shape[0] >= self.target_frames:
            data = data[:self.target_frames]
        else:
            pad_len = self.target_frames - data.shape[0]
            data = np.pad(data, ((0, pad_len), (0, 0)), mode="edge")

        return data  # [750, 25]

    def _load_speaker_emo_cond(self, path: str) -> np.ndarray:
        """从 speaker 的 Emotion CSV 提取 clip 级情绪条件 [10]"""
        for enc in ["utf-8", "utf-8-sig", "gbk", "latin-1"]:
            try:
                df = pd.read_csv(path, encoding=enc)
                break
            except (UnicodeDecodeError, UnicodeError):
                continue
        else:
            return np.zeros(10, dtype=np.float32)

        va = df[CONTINUOUS_EMOTION_COLUMNS].mean().values       # [2]
        discrete = df[DISCRETE_EMOTION_COLUMNS].mean().values   # [8]
        return np.concatenate([va, discrete]).astype(np.float32)  # [10]

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx: int) -> dict:
        sample = self.samples[idx]

        # 1. speaker 音频
        speaker_audio = self._load_audio(sample["speaker_audio_path"])

        # 2. listener 情绪 GT [750, 25]
        listener_emotion = self._load_emotion(sample["listener_emo_path"])

        # 3. speaker 情绪条件 [10]
        if sample["speaker_emo_path"] is not None:
            speaker_emo_cond = self._load_speaker_emo_cond(sample["speaker_emo_path"])
        else:
            speaker_emo_cond = np.zeros(10, dtype=np.float32)

        # 4. 训练时音频增强
        if self.augment and self.audio_augmentor is not None:
            speaker_audio = self.audio_augmentor(speaker_audio)

        return {
            "speaker_audio": speaker_audio,                                    # [80000]
            "listener_emotion": torch.from_numpy(listener_emotion).float(),    # [750, 25]
            "speaker_emo_cond": torch.from_numpy(speaker_emo_cond).float(),    # [10]
        }
