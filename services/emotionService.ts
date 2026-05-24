/**
 * 情绪识别服务
 * 对用户输入（文字/语音转文字）进行细粒度情绪分析，
 * 并将结果映射到数字人状态。
 */

/** 细粒度用户情绪类型 */
export type UserEmotion =
    | 'happy'     // 开心、愉悦
    | 'sad'       // 悲伤、失落
    | 'anxious'   // 焦虑、紧张、害怕
    | 'angry'     // 生气、烦躁
    | 'confused'  // 困惑、迷茫
    | 'lonely'    // 孤独、想念亲人
    | 'calm'      // 平静
    | 'neutral';  // 无明显情绪

/** 情绪分析结果 */
export interface EmotionResult {
    primary: UserEmotion;
    intensity: number;    // 0-1
    sentiment: 'positive' | 'neutral' | 'negative';
    confidence: number;   // 0-1
}

/** 情绪→数字人共情映射 */
export interface EmotionAvatarMapping {
    mood: 'happy' | 'calm' | 'tired' | 'worried' | 'sleepy';
    facialExpression: 'peaceful' | 'neutral' | 'distressed' | 'pained';
    ttsSpeedRatio: number;   // 1.0 = 正常，<1 放慢，>1 加快
    ttsPitchOffset: number;  // 0 = 正常，>0 偏高，<0 偏低
}

// 关键词 → 情绪映射规则
interface EmotionRule {
    keywords: string[];
    emotion: UserEmotion;
    weight: number;  // 匹配权重
}

const EMOTION_RULES: EmotionRule[] = [
    // happy
    { keywords: ['开心', '高兴', '太好了', '哈哈', '真棒', '喜欢', '好玩', '有趣', '快乐', '幸福', '满意', '感谢', '谢谢'], emotion: 'happy', weight: 1.0 },
    // sad
    { keywords: ['难过', '伤心', '哭', '不开心', '心疼', '可惜', '遗憾', '难受', '心酸', '失落'], emotion: 'sad', weight: 1.0 },
    // anxious
    { keywords: ['害怕', '紧张', '担心', '焦虑', '不安', '恐惧', '怕', '着急', '慌', '惶恐', '不敢'], emotion: 'anxious', weight: 1.0 },
    // angry
    { keywords: ['生气', '烦', '讨厌', '愤怒', '恼火', '不耐烦', '气死', '受够', '烦死', '可恶'], emotion: 'angry', weight: 1.0 },
    // confused
    { keywords: ['不知道', '不明白', '不懂', '迷糊', '糊涂', '搞不清', '忘了', '记不起', '是什么', '怎么回事', '什么意思'], emotion: 'confused', weight: 0.8 },
    // lonely
    { keywords: ['想你', '想家', '想儿子', '想女儿', '想孙子', '想孙女', '一个人', '孤独', '寂寞', '没人', '陪我', '什么时候回来', '回来看我'], emotion: 'lonely', weight: 1.0 },
    // calm positive
    { keywords: ['还好', '还行', '不错', '挺好', '可以', '好的', '行'], emotion: 'calm', weight: 0.5 },
];

/** 情绪→数字人共情映射表 */
const EMOTION_AVATAR_MAP: Record<UserEmotion, EmotionAvatarMapping> = {
    happy:    { mood: 'happy',   facialExpression: 'peaceful',   ttsSpeedRatio: 1.0,  ttsPitchOffset: 1 },
    sad:      { mood: 'worried', facialExpression: 'distressed', ttsSpeedRatio: 0.85, ttsPitchOffset: -1 },
    anxious:  { mood: 'worried', facialExpression: 'distressed', ttsSpeedRatio: 0.9,  ttsPitchOffset: 0 },
    angry:    { mood: 'calm',    facialExpression: 'neutral',    ttsSpeedRatio: 0.9,  ttsPitchOffset: 0 },
    confused: { mood: 'calm',    facialExpression: 'neutral',    ttsSpeedRatio: 0.85, ttsPitchOffset: 0 },
    lonely:   { mood: 'worried', facialExpression: 'peaceful',   ttsSpeedRatio: 0.85, ttsPitchOffset: -1 },
    calm:     { mood: 'calm',    facialExpression: 'peaceful',   ttsSpeedRatio: 1.0,  ttsPitchOffset: 0 },
    neutral:  { mood: 'calm',    facialExpression: 'neutral',    ttsSpeedRatio: 1.0,  ttsPitchOffset: 0 },
};

export class EmotionService {
    private lastResult: EmotionResult | null = null;
    private lastTimestamp: number = 0;
    /** 情绪有效期（毫秒），超时后衰减为 neutral */
    private readonly DECAY_MS = 5 * 60 * 1000; // 5 分钟

    /**
     * 分析用户输入文本的情绪
     */
    analyze(text: string): EmotionResult {
        if (!text || !text.trim()) {
            return { primary: 'neutral', intensity: 0, sentiment: 'neutral', confidence: 0 };
        }

        const scores: Record<UserEmotion, number> = {
            happy: 0, sad: 0, anxious: 0, angry: 0,
            confused: 0, lonely: 0, calm: 0, neutral: 0,
        };

        let totalHits = 0;

        for (const rule of EMOTION_RULES) {
            for (const keyword of rule.keywords) {
                if (text.includes(keyword)) {
                    scores[rule.emotion] += rule.weight;
                    totalHits++;
                }
            }
        }

        // 找到最高分的情绪
        let primary: UserEmotion = 'neutral';
        let maxScore = 0;
        for (const [emotion, score] of Object.entries(scores)) {
            if (score > maxScore) {
                maxScore = score;
                primary = emotion as UserEmotion;
            }
        }

        // 计算强度（归一化到 0-1）
        const intensity = totalHits === 0 ? 0 : Math.min(1, maxScore / 2);

        // 计算置信度
        const confidence = totalHits === 0 ? 0.3 : Math.min(1, 0.5 + totalHits * 0.15);

        // 确定情感极性
        let sentiment: EmotionResult['sentiment'] = 'neutral';
        if (['happy', 'calm'].includes(primary)) sentiment = 'positive';
        if (['sad', 'anxious', 'angry', 'lonely'].includes(primary)) sentiment = 'negative';

        const result: EmotionResult = { primary, intensity, sentiment, confidence };

        this.lastResult = result;
        this.lastTimestamp = Date.now();

        console.log('[Emotion] 情绪分析结果:', { text: text.slice(0, 30), ...result });
        return result;
    }

    /**
     * 获取当前有效的情绪（含衰减）
     */
    getCurrentEmotion(): EmotionResult {
        if (!this.lastResult) {
            return { primary: 'neutral', intensity: 0, sentiment: 'neutral', confidence: 0 };
        }

        const elapsed = Date.now() - this.lastTimestamp;
        if (elapsed > this.DECAY_MS) {
            return { primary: 'neutral', intensity: 0, sentiment: 'neutral', confidence: 0 };
        }

        // 线性衰减强度
        const decay = 1 - elapsed / this.DECAY_MS;
        return {
            ...this.lastResult,
            intensity: this.lastResult.intensity * decay,
        };
    }

    /**
     * 获取情绪对应的数字人共情映射
     */
    getAvatarMapping(emotion?: EmotionResult): EmotionAvatarMapping {
        const e = emotion || this.getCurrentEmotion();
        return EMOTION_AVATAR_MAP[e.primary];
    }

    /**
     * 获取情绪对应的 sentiment（兼容 cognitiveService）
     */
    toSentiment(text: string): 'positive' | 'neutral' | 'negative' {
        return this.analyze(text).sentiment;
    }
}

// 单例导出
export const emotionService = new EmotionService();