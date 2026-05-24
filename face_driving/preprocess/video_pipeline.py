"""
视频预处理管道

从比赛提供的视频数据中提取:
1. 逐帧 52 维 BlendShape GT 权重 (通过 MediaPipe)
2. 对应的音频 WAV 文件
3. 帧级时间对齐信息

输出格式:
  data/<video_name>/
    blendshapes.npy    # [T, 52] float32
    audio.wav          # 16kHz mono
    metadata.json      # fps, duration, n_frames 等
"""

import cv2
import json
import subprocess
import numpy as np
from pathlib import Path
from tqdm import tqdm
from typing import Optional

from .blendshape_extractor import MediaPipeBlendShapeExtractor
from .blendshape_definitions import ARKIT_BLENDSHAPE_NAMES


def extract_audio(video_path: str, output_wav: str, sample_rate: int = 16000) -> bool:
    """用 ffmpeg 从视频中提取音频（16kHz mono WAV）"""
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vn",                    # 不要视频流
        "-acodec", "pcm_s16le",   # PCM 16bit
        "-ar", str(sample_rate),  # 采样率
        "-ac", "1",               # 单声道
        output_wav,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[ERROR] ffmpeg 音频提取失败: {result.stderr}")
        return False
    return True


def process_video(
    video_path: str,
    output_dir: str,
    target_fps: Optional[float] = None,
    audio_sample_rate: int = 16000,
) -> dict:
    """
    处理单个视频文件，提取 BlendShape GT 和音频。

    Args:
        video_path: 输入视频路径
        output_dir: 输出目录
        target_fps: 目标帧率（None 表示保持原始帧率）
        audio_sample_rate: 音频采样率

    Returns:
        metadata dict
    """
    video_path = Path(video_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. 提取音频
    audio_path = output_dir / "audio.wav"
    print(f"[1/3] 提取音频: {video_path.name}")
    if not extract_audio(str(video_path), str(audio_path), audio_sample_rate):
        raise RuntimeError(f"音频提取失败: {video_path}")

    # 2. 逐帧提取 BlendShape
    print(f"[2/3] 提取 BlendShape: {video_path.name}")
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频: {video_path}")

    original_fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / original_fps if original_fps > 0 else 0

    fps = target_fps or original_fps
    frame_interval = original_fps / fps if fps < original_fps else 1

    blendshapes_list = []
    frame_timestamps = []
    failed_frames = []

    extractor = MediaPipeBlendShapeExtractor()

    frame_idx = 0
    next_sample = 0.0

    with tqdm(total=total_frames, desc="帧处理") as pbar:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx >= next_sample:
                # BGR → RGB
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                bs = extractor.extract_from_frame(frame_rgb)

                timestamp = frame_idx / original_fps

                if bs is not None:
                    blendshapes_list.append(bs)
                    frame_timestamps.append(timestamp)
                else:
                    # 检测失败：使用前一帧或零向量
                    if blendshapes_list:
                        blendshapes_list.append(blendshapes_list[-1].copy())
                    else:
                        blendshapes_list.append(np.zeros(52, dtype=np.float32))
                    frame_timestamps.append(timestamp)
                    failed_frames.append(frame_idx)

                next_sample += frame_interval

            frame_idx += 1
            pbar.update(1)

    cap.release()
    extractor.close()

    blendshapes = np.array(blendshapes_list, dtype=np.float32)  # [T, 52]

    # 3. 平滑处理（减少关键点抖动）
    print(f"[3/3] 时序平滑")
    blendshapes = temporal_smooth(blendshapes, window_size=3)

    # 保存
    np.save(output_dir / "blendshapes.npy", blendshapes)
    np.save(output_dir / "timestamps.npy", np.array(frame_timestamps, dtype=np.float64))

    metadata = {
        "video_name": video_path.stem,
        "original_fps": original_fps,
        "target_fps": fps,
        "duration_sec": duration,
        "n_frames": len(blendshapes_list),
        "n_failed_frames": len(failed_frames),
        "failed_frame_indices": failed_frames[:20],  # 只保存前 20 个
        "audio_sample_rate": audio_sample_rate,
        "blendshape_names": ARKIT_BLENDSHAPE_NAMES,
        "blendshape_shape": list(blendshapes.shape),
    }

    with open(output_dir / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print(f"  完成: {blendshapes.shape[0]} 帧, {len(failed_frames)} 帧检测失败 ({len(failed_frames)/max(1,blendshapes.shape[0])*100:.1f}%)")
    return metadata


def temporal_smooth(data: np.ndarray, window_size: int = 3) -> np.ndarray:
    """简单均值滑动窗口平滑，减少逐帧抖动"""
    if window_size <= 1 or len(data) <= window_size:
        return data
    smoothed = np.copy(data)
    half = window_size // 2
    for i in range(half, len(data) - half):
        smoothed[i] = data[i - half:i + half + 1].mean(axis=0)
    return smoothed


def batch_process(
    video_dir: str,
    output_dir: str,
    target_fps: float = 30.0,
    video_extensions: tuple = (".mp4", ".avi", ".mov", ".mkv", ".webm"),
):
    """
    批量处理目录下所有视频

    Args:
        video_dir: 视频目录
        output_dir: 输出根目录
        target_fps: 统一目标帧率
        video_extensions: 视频文件扩展名
    """
    video_dir = Path(video_dir)
    output_dir = Path(output_dir)

    videos = sorted([
        f for f in video_dir.iterdir()
        if f.suffix.lower() in video_extensions
    ])

    if not videos:
        print(f"[WARN] 未找到视频文件: {video_dir}")
        return

    print(f"找到 {len(videos)} 个视频文件")

    all_metadata = []
    for video_path in videos:
        out_path = output_dir / video_path.stem
        try:
            meta = process_video(
                str(video_path),
                str(out_path),
                target_fps=target_fps,
            )
            all_metadata.append(meta)
        except Exception as e:
            print(f"[ERROR] 处理失败 {video_path.name}: {e}")

    # 保存汇总元数据
    with open(output_dir / "dataset_summary.json", "w", encoding="utf-8") as f:
        json.dump({
            "total_videos": len(videos),
            "processed": len(all_metadata),
            "target_fps": target_fps,
            "samples": all_metadata,
        }, f, ensure_ascii=False, indent=2)

    print(f"\n全部完成: {len(all_metadata)}/{len(videos)} 个视频处理成功")


# CLI 入口
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="视频 → BlendShape GT 预处理")
    parser.add_argument("--video_dir", type=str, required=True, help="视频目录路径")
    parser.add_argument("--output_dir", type=str, required=True, help="输出目录路径")
    parser.add_argument("--fps", type=float, default=30.0, help="目标帧率 (默认 30)")
    parser.add_argument("--single", type=str, default=None, help="处理单个视频文件")

    args = parser.parse_args()

    if args.single:
        process_video(args.single, args.output_dir, target_fps=args.fps)
    else:
        batch_process(args.video_dir, args.output_dir, target_fps=args.fps)
