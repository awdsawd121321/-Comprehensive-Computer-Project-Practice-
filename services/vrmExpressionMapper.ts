/**
 * VRM 表情映射器
 *
 * 将 EmotionDrivingModel 的 25 维输出映射到 VRM Expression 权重。
 * VRoid 模型只支持 VRM 标准的十几个表情，不支持全部 52 个 ARKit BlendShape。
 *
 * 25 维输出结构:
 *   AU  [0-14]  15 个 Action Unit, sigmoid → [0, 1]
 *   VA  [15-16] valence, arousal, tanh → [-1, 1]
 *   EXP [17-24] 8 个离散情绪概率, softmax → [0, 1], sum ≈ 1
 *
 * AU 索引对照 (AU_COLUMNS):
 *   0:AU1  1:AU2  2:AU4  3:AU6  4:AU7  5:AU9  6:AU10
 *   7:AU12  8:AU14  9:AU15  10:AU17  11:AU23  12:AU24  13:AU25  14:AU26
 *
 * EXP 索引对照 (DISCRETE_EMOTION_COLUMNS):
 *   17:Neutral  18:Happy  19:Sad  20:Surprise
 *   21:Fear  22:Disgust  23:Anger  24:Contempt
 */

// ========== AU 索引常量 ==========
const AU = {
    INNER_BROW_RAISER: 0,     // AU1  - 内眉上提
    OUTER_BROW_RAISER: 1,     // AU2  - 外眉上提
    BROW_LOWERER: 2,          // AU4  - 皱眉
    CHEEK_RAISER: 3,          // AU6  - 颧骨提升（笑眼）
    LID_TIGHTENER: 4,         // AU7  - 眼睑收紧
    NOSE_WRINKLER: 5,         // AU9  - 皱鼻
    UPPER_LIP_RAISER: 6,      // AU10 - 上唇提升
    LIP_CORNER_PULLER: 7,     // AU12 - 嘴角上扬
    DIMPLER: 8,               // AU14 - 酒窝
    LIP_CORNER_DEPRESSOR: 9,  // AU15 - 嘴角下压
    CHIN_RAISER: 10,          // AU17 - 下颌提升
    LIP_TIGHTENER: 11,        // AU23 - 嘴唇收紧
    LIP_PRESSOR: 12,          // AU24 - 嘴唇挤压
    LIPS_PART: 13,            // AU25 - 嘴唇分开
    JAW_DROP: 14,             // AU26 - 下颌下落
} as const;

// ========== EXP 偏移常量 ==========
const EXP_OFFSET = 17;
const EXP = {
    NEUTRAL: 0,   // index 17
    HAPPY: 1,     // index 18
    SAD: 2,       // index 19
    SURPRISE: 3,  // index 20
    FEAR: 4,      // index 21
    DISGUST: 5,   // index 22
    ANGER: 6,     // index 23
    CONTEMPT: 7,  // index 24
} as const;

// ========== VRM Expression 权重接口 ==========
export interface VRMExpressionWeights {
    /** 预设表情 */
    happy: number;
    sad: number;
    angry: number;
    surprised: number;
    relaxed: number;
    /** 口型（viseme） */
    aa: number;
    ih: number;
    ou: number;
    ee: number;
    oh: number;
    /** 眨眼 */
    blinkLeft: number;
    blinkRight: number;
}

// 默认权重（全零 / 中性脸）
const DEFAULT_WEIGHTS: VRMExpressionWeights = {
    happy: 0, sad: 0, angry: 0, surprised: 0, relaxed: 0,
    aa: 0, ih: 0, ou: 0, ee: 0, oh: 0,
    blinkLeft: 0, blinkRight: 0,
};

// ========== 工具函数 ==========

/** clamp [min, max] */
function clamp(v: number, min: number, max: number): number {
    return v < min ? min : v > max ? max : v;
}

/** smoothstep：x 在 [edge0, edge1] 间平滑过渡 */
function smoothstep(x: number, edge0: number, edge1: number): number {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

// ========== 上一帧状态（用于时域平滑） ==========
let prevWeights: VRMExpressionWeights = { ...DEFAULT_WEIGHTS };
let blinkTimer = 0;

/**
 * 将 25 维情感模型输出映射到 VRM Expression 权重
 *
 * @param emo25 长度 25 的数组 [AU×15, VA×2, EXP×8]
 * @param deltaTime 距上一帧的时间间隔（秒），用于平滑和眨眼计时
 * @returns VRM Expression 权重
 */
export function mapEmotionToVRM(
    emo25: number[],
    deltaTime: number = 0.04,  // 25fps → 40ms
): VRMExpressionWeights {
    if (!emo25 || emo25.length < 25) {
        return { ...DEFAULT_WEIGHTS };
    }

    // ---- 1. 提取分量 ----
    const au = emo25.slice(0, 15);     // [0, 1]
    const valence = emo25[15];         // [-1, 1]
    const arousal = emo25[16];         // [-1, 1]
    const exp = emo25.slice(17, 25);   // softmax 概率

    // ---- 2. Arousal 调制因子 ----
    // arousal 归一化到 [0.4, 1.0]：低唤醒时减弱表情，高唤醒时增强
    const arousalMod = 0.4 + ((arousal + 1) / 2) * 0.6;

    // ---- 3. 预设表情权重 ----

    // happy: EXP_Happy 为主，AU12（嘴角上扬）+ AU6（笑眼）辅助
    const happy = clamp(
        (exp[EXP.HAPPY] * 0.6 + au[AU.LIP_CORNER_PULLER] * 0.25 + au[AU.CHEEK_RAISER] * 0.15) * arousalMod,
        0, 1,
    );

    // sad: EXP_Sad + AU15（嘴角下压）
    const sad = clamp(
        (exp[EXP.SAD] * 0.65 + au[AU.LIP_CORNER_DEPRESSOR] * 0.25 + au[AU.OUTER_BROW_RAISER] * 0.1) * arousalMod,
        0, 1,
    );

    // angry: EXP_Anger + AU4（皱眉）
    const angry = clamp(
        (exp[EXP.ANGER] * 0.55 + au[AU.BROW_LOWERER] * 0.35 + au[AU.LIP_TIGHTENER] * 0.1) * arousalMod,
        0, 1,
    );

    // surprised: EXP_Surprise + AU1（内眉上提）+ AU2（外眉上提）
    const surprised = clamp(
        (exp[EXP.SURPRISE] * 0.5 + au[AU.INNER_BROW_RAISER] * 0.25 + au[AU.OUTER_BROW_RAISER] * 0.25) * arousalMod,
        0, 1,
    );

    // relaxed: Neutral 概率 + 低 Arousal
    const relaxed = clamp(
        exp[EXP.NEUTRAL] * (1 - arousalMod) * 0.5,
        0, 1,
    );

    // ---- 4. 口型（viseme） ----
    // AU25（嘴唇分开）+ AU26（下颌下落）→ 张嘴
    const mouthOpen = au[AU.LIPS_PART] * 0.6 + au[AU.JAW_DROP] * 0.4;

    // aa: 大张嘴
    const aa = clamp(smoothstep(mouthOpen, 0.25, 0.6) * arousalMod, 0, 1);

    // oh: 上唇提升（AU10）+ 中等张嘴
    const oh = clamp(
        (au[AU.UPPER_LIP_RAISER] * 0.5 + smoothstep(mouthOpen, 0.15, 0.4) * 0.5) * arousalMod,
        0, 1,
    );

    // ou: 嘴唇收紧（AU24）+ 轻微张嘴
    const ou = clamp(
        (au[AU.LIP_PRESSOR] * 0.6 + au[AU.LIP_TIGHTENER] * 0.4) * arousalMod,
        0, 1,
    );

    // ee: 嘴角拉开（AU12 的弱化）+ 少量 AU14
    const ee = clamp(
        (au[AU.DIMPLER] * 0.5 + au[AU.LIP_CORNER_PULLER] * 0.15) * arousalMod,
        0, 1,
    );

    // ---- 5. 眨眼 ----
    // AU7（眼睑收紧）作为基础，叠加自动周期眨眼
    blinkTimer += deltaTime;
    // 3.5 秒周期眨眼
    const autoBlink = smoothstep(blinkTimer % 3.5, 3.3, 3.4) * (1 - smoothstep(blinkTimer % 3.5, 3.4, 3.5));
    // AU7 触发眨眼
    const auBlink = smoothstep(au[AU.LID_TIGHTENER], 0.3, 0.7);
    const blinkValue = clamp(Math.max(autoBlink, auBlink) * arousalMod, 0, 1);

    // ---- 6. 组装 ----
    const raw: VRMExpressionWeights = {
        happy,
        sad,
        angry,
        surprised,
        relaxed,
        aa, ih: 0, ou, ee, oh,
        blinkLeft: blinkValue,
        blinkRight: blinkValue,
    };

    // ---- 7. 时域平滑（指数移动平均，防止跳变） ----
    const smoothFactor = 0.3; // 越小越平滑，越大越灵敏
    const smoothed: VRMExpressionWeights = {} as VRMExpressionWeights;
    for (const key of Object.keys(raw) as (keyof VRMExpressionWeights)[]) {
        smoothed[key] = prevWeights[key] * (1 - smoothFactor) + raw[key] * smoothFactor;
    }
    prevWeights = { ...smoothed };

    return smoothed;
}

/**
 * 重置映射器内部状态（切换场景时调用）
 */
export function resetMapperState(): void {
    prevWeights = { ...DEFAULT_WEIGHTS };
    blinkTimer = 0;
}
