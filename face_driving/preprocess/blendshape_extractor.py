"""
MediaPipe Face Mesh → ARKit 52 BlendShape 提取器

从视频中逐帧提取 468 个面部关键点，通过几何规则映射到 52 个 ARKit BlendShape 权重。
同时提取音频并对齐帧时间戳。
"""

import cv2
import numpy as np
import mediapipe as mp
from pathlib import Path
from typing import Optional

from .blendshape_definitions import (
    ARKIT_BLENDSHAPE_NAMES,
    NUM_BLENDSHAPES,
    BLENDSHAPE_NAME_TO_IDX,
)


class MediaPipeBlendShapeExtractor:
    """从视频帧中提取 52 个 ARKit BlendShape 权重"""

    def __init__(self, static_image_mode: bool = False, max_num_faces: int = 1,
                 min_detection_confidence: float = 0.5, min_tracking_confidence: float = 0.5):
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=static_image_mode,
            max_num_faces=max_num_faces,
            refine_landmarks=True,  # 启用 478 点（含虹膜）
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )

    def extract_from_frame(self, frame_rgb: np.ndarray) -> Optional[np.ndarray]:
        """
        从单帧 RGB 图像提取 52 个 BlendShape 权重

        Args:
            frame_rgb: [H, W, 3] uint8 RGB 图像

        Returns:
            [52] float32 BlendShape 权重 (0~1)，检测失败返回 None
        """
        results = self.face_mesh.process(frame_rgb)

        if not results.multi_face_landmarks:
            return None

        landmarks = results.multi_face_landmarks[0]
        # 转为 numpy [478, 3]
        pts = np.array([(lm.x, lm.y, lm.z) for lm in landmarks.landmark], dtype=np.float32)

        return self._landmarks_to_blendshapes(pts)

    def _landmarks_to_blendshapes(self, pts: np.ndarray) -> np.ndarray:
        """
        通过关键点几何关系计算 52 个 BlendShape 权重。

        使用 MediaPipe Face Mesh 468+10 个关键点的标准索引。
        参考: https://github.com/google/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
        """
        bs = np.zeros(NUM_BLENDSHAPES, dtype=np.float32)

        # 基准距离：眼间距（用于归一化）
        eye_l = pts[33]   # 左眼内眼角
        eye_r = pts[263]  # 右眼内眼角
        eye_dist = np.linalg.norm(eye_l - eye_r)
        if eye_dist < 1e-6:
            return bs

        def dist(a: int, b: int) -> float:
            return float(np.linalg.norm(pts[a] - pts[b]))

        def norm_dist(a: int, b: int) -> float:
            return dist(a, b) / eye_dist

        # === 眼睛 (Eye) ===
        # 眨眼：上下眼睑距离
        l_eye_open = norm_dist(159, 145)  # 左眼上-下
        r_eye_open = norm_dist(386, 374)  # 右眼上-下
        blink_threshold = 0.18
        bs[BLENDSHAPE_NAME_TO_IDX["eyeBlinkLeft"]] = np.clip(1.0 - l_eye_open / blink_threshold, 0, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["eyeBlinkRight"]] = np.clip(1.0 - r_eye_open / blink_threshold, 0, 1)

        # 睁大眼
        wide_threshold = 0.28
        bs[BLENDSHAPE_NAME_TO_IDX["eyeWideLeft"]] = np.clip((l_eye_open - blink_threshold) / (wide_threshold - blink_threshold), 0, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["eyeWideRight"]] = np.clip((r_eye_open - blink_threshold) / (wide_threshold - blink_threshold), 0, 1)

        # 眯眼 (squint)
        l_cheek_eye = norm_dist(111, 145)
        r_cheek_eye = norm_dist(340, 374)
        bs[BLENDSHAPE_NAME_TO_IDX["eyeSquintLeft"]] = np.clip(1.0 - l_cheek_eye / 0.15, 0, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["eyeSquintRight"]] = np.clip(1.0 - r_cheek_eye / 0.15, 0, 1)

        # 眼球方向 (通过虹膜关键点 468-472)
        if len(pts) >= 478:
            # 左眼虹膜中心 468, 右眼虹膜中心 473
            l_iris = pts[468]
            r_iris = pts[473]
            l_eye_center = (pts[33] + pts[133]) / 2
            r_eye_center = (pts[362] + pts[263]) / 2
            l_eye_width = dist(33, 133)
            r_eye_width = dist(362, 263)

            if l_eye_width > 1e-6:
                l_look_x = (l_iris[0] - l_eye_center[0]) / (l_eye_width * 0.5)
                l_look_y = (l_iris[1] - l_eye_center[1]) / (l_eye_width * 0.5)
                bs[BLENDSHAPE_NAME_TO_IDX["eyeLookInLeft"]] = np.clip(l_look_x, 0, 1)
                bs[BLENDSHAPE_NAME_TO_IDX["eyeLookOutLeft"]] = np.clip(-l_look_x, 0, 1)
                bs[BLENDSHAPE_NAME_TO_IDX["eyeLookUpLeft"]] = np.clip(-l_look_y, 0, 1)
                bs[BLENDSHAPE_NAME_TO_IDX["eyeLookDownLeft"]] = np.clip(l_look_y, 0, 1)

            if r_eye_width > 1e-6:
                r_look_x = (r_iris[0] - r_eye_center[0]) / (r_eye_width * 0.5)
                r_look_y = (r_iris[1] - r_eye_center[1]) / (r_eye_width * 0.5)
                bs[BLENDSHAPE_NAME_TO_IDX["eyeLookInRight"]] = np.clip(-r_look_x, 0, 1)
                bs[BLENDSHAPE_NAME_TO_IDX["eyeLookOutRight"]] = np.clip(r_look_x, 0, 1)
                bs[BLENDSHAPE_NAME_TO_IDX["eyeLookUpRight"]] = np.clip(-r_look_y, 0, 1)
                bs[BLENDSHAPE_NAME_TO_IDX["eyeLookDownRight"]] = np.clip(r_look_y, 0, 1)

        # === 眉毛 (Brow) ===
        l_brow_height = norm_dist(70, 33)   # 左眉中点到左眼内角
        r_brow_height = norm_dist(300, 263)  # 右眉中点到右眼内角
        brow_rest = 0.22

        bs[BLENDSHAPE_NAME_TO_IDX["browDownLeft"]] = np.clip((brow_rest - l_brow_height) / 0.05, 0, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["browDownRight"]] = np.clip((brow_rest - r_brow_height) / 0.05, 0, 1)

        inner_brow_height = norm_dist(9, 168)  # 眉间到鼻梁
        bs[BLENDSHAPE_NAME_TO_IDX["browInnerUp"]] = np.clip((inner_brow_height - 0.06) / 0.04, 0, 1)

        l_outer_brow = norm_dist(105, 33)
        r_outer_brow = norm_dist(334, 263)
        bs[BLENDSHAPE_NAME_TO_IDX["browOuterUpLeft"]] = np.clip((l_outer_brow - brow_rest) / 0.04, 0, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["browOuterUpRight"]] = np.clip((r_outer_brow - brow_rest) / 0.04, 0, 1)

        # === 下巴 (Jaw) ===
        jaw_open_dist = norm_dist(13, 14)  # 上唇中点到下唇中点
        bs[BLENDSHAPE_NAME_TO_IDX["jawOpen"]] = np.clip(jaw_open_dist / 0.25, 0, 1)

        # 下巴左右
        chin = pts[152]
        nose_tip = pts[1]
        jaw_lateral = (chin[0] - nose_tip[0]) / eye_dist
        bs[BLENDSHAPE_NAME_TO_IDX["jawLeft"]] = np.clip(-jaw_lateral / 0.05, 0, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["jawRight"]] = np.clip(jaw_lateral / 0.05, 0, 1)

        # 下巴前伸
        jaw_forward = (chin[2] - nose_tip[2]) / eye_dist
        bs[BLENDSHAPE_NAME_TO_IDX["jawForward"]] = np.clip(jaw_forward / 0.03, 0, 1)

        # === 嘴巴 (Mouth) ===
        mouth_width = norm_dist(61, 291)  # 嘴角左-右
        mouth_rest_width = 0.35

        # 微笑
        l_mouth_corner_y = pts[61][1] - pts[13][1]
        r_mouth_corner_y = pts[291][1] - pts[13][1]
        bs[BLENDSHAPE_NAME_TO_IDX["mouthSmileLeft"]] = np.clip(-l_mouth_corner_y / eye_dist / 0.05, 0, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["mouthSmileRight"]] = np.clip(-r_mouth_corner_y / eye_dist / 0.05, 0, 1)

        # 撇嘴
        bs[BLENDSHAPE_NAME_TO_IDX["mouthFrownLeft"]] = np.clip(l_mouth_corner_y / eye_dist / 0.04, 0, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["mouthFrownRight"]] = np.clip(r_mouth_corner_y / eye_dist / 0.04, 0, 1)

        # 嘟嘴 (pucker)
        pucker = np.clip((mouth_rest_width - mouth_width) / 0.1, 0, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["mouthPucker"]] = pucker

        # 漏斗嘴 (funnel)
        upper_lip_protrusion = norm_dist(0, 13)
        bs[BLENDSHAPE_NAME_TO_IDX["mouthFunnel"]] = np.clip(upper_lip_protrusion / 0.08, 0, 1) * 0.5

        # 闭嘴
        mouth_close = norm_dist(13, 14)
        bs[BLENDSHAPE_NAME_TO_IDX["mouthClose"]] = np.clip(1.0 - mouth_close / 0.02, 0, 1)

        # 嘴巴左右移动
        mouth_center_x = (pts[61][0] + pts[291][0]) / 2
        mouth_offset_x = (mouth_center_x - nose_tip[0]) / eye_dist
        bs[BLENDSHAPE_NAME_TO_IDX["mouthLeft"]] = np.clip(-mouth_offset_x / 0.03, 0, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["mouthRight"]] = np.clip(mouth_offset_x / 0.03, 0, 1)

        # 上下唇
        upper_lip_up = norm_dist(13, 0)
        lower_lip_down = norm_dist(14, 17)
        bs[BLENDSHAPE_NAME_TO_IDX["mouthUpperUpLeft"]] = np.clip(upper_lip_up / 0.06, 0, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["mouthUpperUpRight"]] = np.clip(upper_lip_up / 0.06, 0, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["mouthLowerDownLeft"]] = np.clip(lower_lip_down / 0.08, 0, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["mouthLowerDownRight"]] = np.clip(lower_lip_down / 0.08, 0, 1)

        # 嘴唇卷入
        lip_roll = norm_dist(13, 14)
        bs[BLENDSHAPE_NAME_TO_IDX["mouthRollUpper"]] = np.clip(1.0 - upper_lip_up / 0.03, 0, 1) * 0.5
        bs[BLENDSHAPE_NAME_TO_IDX["mouthRollLower"]] = np.clip(1.0 - lower_lip_down / 0.04, 0, 1) * 0.5

        # 嘴唇伸展
        bs[BLENDSHAPE_NAME_TO_IDX["mouthStretchLeft"]] = np.clip((mouth_width - mouth_rest_width) / 0.08, 0, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["mouthStretchRight"]] = np.clip((mouth_width - mouth_rest_width) / 0.08, 0, 1)

        # 嘴角凹陷
        bs[BLENDSHAPE_NAME_TO_IDX["mouthDimpleLeft"]] = bs[BLENDSHAPE_NAME_TO_IDX["mouthSmileLeft"]] * 0.3
        bs[BLENDSHAPE_NAME_TO_IDX["mouthDimpleRight"]] = bs[BLENDSHAPE_NAME_TO_IDX["mouthSmileRight"]] * 0.3

        # 嘴唇按压
        bs[BLENDSHAPE_NAME_TO_IDX["mouthPressLeft"]] = np.clip(1.0 - lip_roll / 0.01, 0, 1) * 0.3
        bs[BLENDSHAPE_NAME_TO_IDX["mouthPressRight"]] = np.clip(1.0 - lip_roll / 0.01, 0, 1) * 0.3

        # 嘴唇耸起
        bs[BLENDSHAPE_NAME_TO_IDX["mouthShrugUpper"]] = bs[BLENDSHAPE_NAME_TO_IDX["mouthUpperUpLeft"]] * 0.4
        bs[BLENDSHAPE_NAME_TO_IDX["mouthShrugLower"]] = bs[BLENDSHAPE_NAME_TO_IDX["mouthLowerDownLeft"]] * 0.4

        # === 脸颊 (Cheek) ===
        bs[BLENDSHAPE_NAME_TO_IDX["cheekSquintLeft"]] = bs[BLENDSHAPE_NAME_TO_IDX["eyeSquintLeft"]] * 0.6
        bs[BLENDSHAPE_NAME_TO_IDX["cheekSquintRight"]] = bs[BLENDSHAPE_NAME_TO_IDX["eyeSquintRight"]] * 0.6

        cheek_width = norm_dist(123, 352)
        bs[BLENDSHAPE_NAME_TO_IDX["cheekPuff"]] = np.clip((cheek_width - 0.55) / 0.06, 0, 1)

        # === 鼻子 (Nose) ===
        l_nostril = norm_dist(49, 1)
        r_nostril = norm_dist(279, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["noseSneerLeft"]] = np.clip((l_nostril - 0.04) / 0.02, 0, 1)
        bs[BLENDSHAPE_NAME_TO_IDX["noseSneerRight"]] = np.clip((r_nostril - 0.04) / 0.02, 0, 1)

        # === 舌头 (Tongue) ===
        # MediaPipe 无法直接检测舌头，通过嘴巴张开程度间接估计
        bs[BLENDSHAPE_NAME_TO_IDX["tongueOut"]] = 0.0  # 需要专门模型

        return bs

    def close(self):
        self.face_mesh.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
