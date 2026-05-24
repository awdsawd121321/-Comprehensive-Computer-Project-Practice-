"""
EmotionDrivingModel — WebSocket 实时推理服务 (25 维)

协议:
    客户端发送:
        {"audio": "<base64 float32 PCM>", "emotion": [v, a, n, h, s, su, f, d, an, c]}
    或 Mock 模式:
        {"emotion": [v, a, n, h, s, su, f, d, an, c], "duration": 3.0}

    服务端逐帧返回:
        [v0, ..., v24]  // 25 个 float (AU×15 + VA×2 + EXP×8)

启动:
    python -m face_driving.inference.emotion_server --checkpoint face_driving/checkpoints_emotion/best.pt
    python -m face_driving.inference.emotion_server --mock
"""

import asyncio
import json
import base64
import struct
import argparse
import numpy as np
import torch

try:
    import websockets
except ImportError:
    print("[ERROR] pip install websockets")
    raise

from face_driving.preprocess.blendshape_definitions import DATA_FPS
from face_driving.postprocess import postprocess_emotion


# 25 维输出参数
NUM_EMOTION_PARAMS = 25

# 后处理参数
DEFAULT_SMOOTH_WINDOW = 3
DEFAULT_VAR_ALPHA = 1.3


class EmotionDrivingServer:
    """EmotionDrivingModel 推理服务 — 25 维情感驱动"""

    def __init__(self, checkpoint_path: str, device: str = "auto"):
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = torch.device(device)

        ckpt = torch.load(checkpoint_path, map_location=self.device, weights_only=False)
        cfg = ckpt["config"]
        mc = cfg["model"]

        from face_driving.model.emotion_driving_model import EmotionDrivingModel
        self.model = EmotionDrivingModel(
            audio_encoder_name=mc["audio_encoder"],
            audio_feat_dim=mc["audio_feat_dim"],
            freeze_audio_encoder=True,
            d_model=mc["d_model"],
            n_heads=mc["n_heads"],
            n_layers=mc["n_layers"],
            dropout=0,
            output_fps=mc["output_fps"],
            noise_sigma=mc.get("noise_sigma", 0.05),
        )

        # 优先加载 EMA 权重
        if "ema_shadow" in ckpt:
            self.model.load_state_dict(ckpt["ema_shadow"])
            print("[Server] 已加载 EMA 平滑权重")
        else:
            self.model.load_state_dict(ckpt["model_state_dict"])

        self.model.to(self.device)
        self.model.eval()
        self.output_fps = mc["output_fps"]
        print(f"[Server] EmotionDrivingModel 就绪 (device={self.device}, output_fps={self.output_fps})")

    async def handle_client(self, websocket):
        client_id = id(websocket)
        print(f"[Server] 连接: {client_id}")
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    audio_b64 = data.get("audio", "")
                    emotion = data.get("emotion", [0, 0, 1, 0, 0, 0, 0, 0, 0, 0])

                    audio_bytes = base64.b64decode(audio_b64)
                    n_samples = len(audio_bytes) // 4
                    audio_np = np.array(
                        struct.unpack(f'{n_samples}f', audio_bytes[:n_samples * 4]),
                        dtype=np.float32,
                    )

                    audio_t = torch.from_numpy(audio_np).unsqueeze(0).to(self.device)
                    emo_t = torch.tensor([emotion], dtype=torch.float32).to(self.device)

                    with torch.no_grad():
                        output, _, _ = self.model(audio_t, emo_t)  # [1, T, 25]

                    # 后处理: 时序平滑 + 方差放大
                    frames_np = output[0].cpu().numpy()  # [T, 25]
                    frames_4d = frames_np[np.newaxis, np.newaxis]  # [1, 1, T, 25]
                    frames_4d = postprocess_emotion(
                        frames_4d,
                        smooth_window=DEFAULT_SMOOTH_WINDOW,
                        var_alpha=DEFAULT_VAR_ALPHA,
                    )
                    frames = frames_4d[0, 0]  # [T, 25]

                    # 逐帧发送
                    for frame in frames:
                        payload = [round(float(v), 4) for v in frame]
                        await websocket.send(json.dumps(payload))
                        await asyncio.sleep(1.0 / self.output_fps)

                except Exception as e:
                    await websocket.send(json.dumps({"error": str(e)}))
        except websockets.exceptions.ConnectionClosed:
            pass

    async def start(self, host="0.0.0.0", port=10097):
        print(f"[Server] ws://{host}:{port}")
        async with websockets.serve(self.handle_client, host, port):
            await asyncio.Future()


class MockEmotionServer:
    """模拟推理服务 — 无需模型，用于前端开发调试"""

    def __init__(self):
        print("[MockEmotionServer] 模拟推理服务启动 (25 维)")

    async def handle_client(self, websocket):
        try:
            async for message in websocket:
                data = json.loads(message)
                emotion = data.get("emotion", [0, 0, 1, 0, 0, 0, 0, 0, 0, 0])
                duration = data.get("duration", 3.0)
                n_frames = int(duration * DATA_FPS)

                for i in range(n_frames):
                    t = i / DATA_FPS
                    frame = self._mock_frame(t, emotion)
                    await websocket.send(json.dumps(frame))
                    await asyncio.sleep(1.0 / DATA_FPS)
        except websockets.exceptions.ConnectionClosed:
            pass

    def _mock_frame(self, t: float, emotion: list) -> list:
        """
        生成 25 维模拟帧:
          AU[0:15] sigmoid→[0,1], VA[15:17] tanh→[-1,1], EXP[17:25] softmax→sum≈1
        """
        out = [0.0] * NUM_EMOTION_PARAMS

        happy_p = emotion[3] if len(emotion) > 3 else 0

        # ---- AU (dim 0-14) ----
        # AU6 (cheek raiser) + AU12 (lip corner puller) 跟随 happy
        out[3] = 0.3 * happy_p
        out[7] = 0.5 * happy_p  # 嘴角上扬
        # AU25 (lips part) 模拟说话
        out[13] = max(0, 0.3 * np.sin(t * 8) + 0.1 * np.sin(t * 13))
        # AU26 (jaw drop) 跟随说话
        out[14] = out[13] * 0.5

        # ---- VA (dim 15-16) ----
        out[15] = happy_p * 0.5   # valence: happy → 正面
        out[16] = 0.2 + happy_p * 0.3  # arousal: 略有活力

        # ---- EXP (dim 17-24): 模拟 softmax 概率 ----
        neutral = max(0, 1.0 - happy_p * 0.8)
        happy = happy_p * 0.8
        total = neutral + happy + 0.01  # 避免除零
        out[17] = round(neutral / total, 4)  # Neutral
        out[18] = round(happy / total, 4)    # Happy
        out[19] = 0.001  # Sad
        out[20] = 0.001  # Surprise
        out[21] = 0.0    # Fear
        out[22] = 0.0    # Disgust
        out[23] = 0.0    # Anger
        out[24] = 0.0    # Contempt

        # 确保 softmax 归一化
        exp_sum = sum(out[17:25])
        if exp_sum > 0:
            for j in range(17, 25):
                out[j] = round(out[j] / exp_sum, 4)

        return [round(v, 4) for v in out]

    async def start(self, host="0.0.0.0", port=10097):
        print(f"[MockEmotionServer] ws://{host}:{port}")
        async with websockets.serve(self.handle_client, host, port):
            await asyncio.Future()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="EmotionDrivingModel WebSocket 推理服务")
    parser.add_argument("--checkpoint", type=str, default=None,
                        help="模型 checkpoint 路径 (不指定则用 mock 模式)")
    parser.add_argument("--port", type=int, default=10097)
    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--mock", action="store_true", help="使用 mock 模式")
    args = parser.parse_args()

    if args.mock or args.checkpoint is None:
        server = MockEmotionServer()
    else:
        server = EmotionDrivingServer(args.checkpoint)
    asyncio.run(server.start(args.host, args.port))
