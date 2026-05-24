"""
面部行为参数定义

比赛数据集 Emotion CSV 为 25 列:
  - 15 个 AU 二值标签 (AU1,AU2,AU4,AU6,AU7,AU9,AU10,AU12,AU14,AU15,AU17,AU23,AU24,AU25,AU26)
  - 2 个连续维度: valence, arousal
  - 8 个离散情绪概率: Neutral,Happy,Sad,Surprise,Fear,Disgust,Anger,Contempt

模型输出 (EmotionDrivingModel) 为 25 维向量:
  - AU  [0-14]:  15 个动作单元, Sigmoid → [0, 1]
  - VA  [15-16]: valence/arousal, Tanh → [-1, 1]
  - EXP [17-24]: 8 个表情概率, Softmax → 和为 1

数据集:
  - NoXI: 46 个 session, Expert_video / Novice_video, ~3226 clips
  - RECOLA: 1 个 group, P25/P26, 20 clips
  - 帧率: 25 fps, 每 clip ~30 秒 (~750 帧)
  - 音频: 44100Hz stereo WAV
"""

# ========== Emotion 输出维度 ==========
NUM_EMOTION_PARAMS = 25   # EmotionDrivingModel 输出维度
NUM_AU_OUTPUT = 15         # AU 维度
NUM_VA_OUTPUT = 2          # Valence/Arousal 维度
NUM_EXP_OUTPUT = 8         # 离散情绪维度

# 输出切片
AU_OUTPUT_SLICE = slice(0, 15)
VA_OUTPUT_SLICE = slice(15, 17)
EXP_OUTPUT_SLICE = slice(17, 25)

# ========== 帧率 ==========

DATA_FPS = 25               # 数据集帧率 (751帧 / 30.02秒)
AUDIO_SAMPLE_RATE = 44100   # 原始音频采样率

# ========== Emotion CSV 列定义 ==========

# 15 个 Action Unit (二值 0/1)
AU_COLUMNS = [
    "AU1", "AU2", "AU4", "AU6", "AU7", "AU9", "AU10",
    "AU12", "AU14", "AU15", "AU17", "AU23", "AU24", "AU25", "AU26",
]
NUM_AU_LABELS = len(AU_COLUMNS)  # 15

# 连续维度情绪
CONTINUOUS_EMOTION_COLUMNS = ["valence", "arousal"]

# 离散情绪概率 (8类)
DISCRETE_EMOTION_COLUMNS = [
    "Neutral", "Happy", "Sad", "Surprise",
    "Fear", "Disgust", "Anger", "Contempt",
]
NUM_DISCRETE_EMOTIONS = len(DISCRETE_EMOTION_COLUMNS)  # 8

# 情绪条件向量维度: valence(1) + arousal(1) + 8 个离散情绪概率 = 10
EMOTION_CONDITION_DIM = 2 + NUM_DISCRETE_EMOTIONS  # 10

# 所有 Emotion CSV 列
ALL_EMOTION_COLUMNS = AU_COLUMNS + CONTINUOUS_EMOTION_COLUMNS + DISCRETE_EMOTION_COLUMNS

# ========== 数据集目录映射 ==========

# NoXI: Emotion 的 P1/P2 对应 Video/Audio/3D_FV 的 Expert/Novice
NOXI_ROLE_MAP = {
    "P1": "Expert_video",
    "P2": "Novice_video",
}

# RECOLA: Emotion P1→P25, P2→P26
RECOLA_SUBJECT_MAP = {
    "P1": "P25",
    "P2": "P26",
}

# ========== 兼容前端: 与 emotionService.ts 的映射 ==========

# 离散情绪 → emotionService 标签
DATASET_TO_APP_EMOTION = {
    "Neutral":  "neutral",
    "Happy":    "happy",
    "Sad":      "sad",
    "Surprise": "neutral",   # 项目中无 surprise，映射到 neutral
    "Fear":     "anxious",
    "Disgust":  "angry",
    "Anger":    "angry",
    "Contempt": "neutral",
}
