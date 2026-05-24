/**
 * 健康状态服务
 * 管理老人的健康数据并映射到头像状态
 */

import { openclawSyncService } from './openclawSyncService';
import { type UserEmotion, emotionService } from './emotionService';

export interface HealthMetrics {
    heartRate: number;        // 心率 (bpm)
    bloodOxygen: number;      // 血氧 (%)
    sleepHours: number;       // 昨晚睡眠 (小时)
    steps: number;            // 今日步数
    bloodPressure?: {
        systolic: number;       // 收缩压
        diastolic: number;      // 舒张压
    };
    temperature?: number;     // 体温
    lastMealTime?: Date;      // 上次进餐时间
    lastMedicationTime?: Date; // 上次服药时间
}

/** 生命体征预设类型 */
export type VitalPresetType = 'healthy' | 'subhealthy';

/** 完整健康生命体征预设 - 各项指标均在正常范围内 */
export const HEALTHY_VITALS: HealthMetrics = {
    heartRate: 72,
    bloodOxygen: 98,
    sleepHours: 7.5,
    steps: 5200,
    bloodPressure: { systolic: 118, diastolic: 76 },
    temperature: 36.5,
};

/** 亚健康生命体征预设 - 高血压等异常情况 */
export const SUBHEALTHY_VITALS: HealthMetrics = {
    heartRate: 88,
    bloodOxygen: 94,
    sleepHours: 5.2,
    steps: 1800,
    bloodPressure: { systolic: 152, diastolic: 98 },
    temperature: 36.8,
};

export interface AvatarState {
    energy: number;           // 精力值 0-100
    mood: 'happy' | 'calm' | 'tired' | 'worried' | 'sleepy';
    skinTone: 'healthy' | 'pale' | 'flushed';
    posture: 'upright' | 'relaxed' | 'slouched';
    eyeState: 'wide' | 'normal' | 'droopy' | 'closed';
    animation: 'idle' | 'breathing_slow' | 'breathing_fast' | 'nodding';
    alertLevel: 'normal' | 'attention' | 'warning' | 'critical';
    message?: string;         // 状态提示语
    // 新增：更细致的生理表现
    breathingRate: 'slow' | 'normal' | 'fast' | 'rapid';  // 呼吸频率
    sweating: number;         // 出汗程度 0-1
    tremor: number;           // 颤抖/不稳 0-1（低血糖、疲劳、高血压危象时）
    facialExpression: 'peaceful' | 'neutral' | 'distressed' | 'pained';  // 面部表情
    lipColor: 'rosy' | 'normal' | 'pale' | 'cyanotic';  // 嘴唇颜色（血氧反映）
    headTilt: number;         // 头部下垂程度 0-1（疲劳、血压低）
    shoulderSlump: number;    // 肩膀下沉 0-1（精力、姿态）
    darkCircleIntensity: number;  // 黑眼圈程度 0-1（睡眠不足时）
    // 新增：更直观的生命体征视觉反馈
    heartbeatIntensity: number;   // 心跳可视化强度 0-1（心率越高越明显）
    heartbeatSpeed: number;       // 心跳速度（每秒跳动次数，基于心率）
    fingerCyanosis: number;       // 指尖紫绀程度 0-1（低血氧）
    templeVeinPulse: number;      // 太阳穴血管跳动 0-1（高血压）
    headachePose: boolean;        // 头痛姿势（手扶额头）
    bodyStability: number;        // 身体稳定性 0-1（步数、运动量反映）
    overallHealthGlow: 'green' | 'yellow' | 'orange' | 'red';  // 整体健康光晕
    // 对话情绪维度（由 emotionService 驱动）
    conversationMood?: UserEmotion;          // 对话检测到的用户情绪
    conversationMoodIntensity?: number;      // 情绪强度 0-1（含衰减）
}

export interface HealthAlert {
    type: 'warning' | 'critical';
    metric: string;
    value: number;
    threshold: number;
    message: string;
    timestamp: Date;
}

/**
 * 健康状态服务类
 */
export class HealthStateService {
    private currentMetrics: HealthMetrics | null = null;
    private alertHistory: HealthAlert[] = [];
    private listeners: ((state: AvatarState) => void)[] = [];

    // 健康阈值配置
    private thresholds = {
        heartRate: { low: 50, high: 100, critical: 120 },
        bloodOxygen: { low: 95, critical: 90 },
        sleepHours: { min: 6, ideal: 8 },
        steps: { min: 2000, ideal: 5000 },
        bloodPressure: {
            systolicHigh: 140,
            systolicCritical: 160,
            diastolicHigh: 90,
        },
    };

    /**
     * 更新健康指标
     */
    updateMetrics(metrics: Partial<HealthMetrics>): void {
        this.currentMetrics = {
            ...this.getDefaultMetrics(),
            ...this.currentMetrics,
            ...metrics,
        };

        // 检查是否需要发出警报
        this.checkAlerts();

        // 通知监听器
        const state = this.calculateAvatarState();
        this.listeners.forEach(listener => listener(state));
        openclawSyncService.syncHealthMetrics(this.currentMetrics, this.alertHistory);
    }

    /**
     * 获取当前头像状态
     */
    getAvatarState(): AvatarState {
        return this.calculateAvatarState();
    }

    /**
     * 计算头像状态
     */
    private calculateAvatarState(): AvatarState {
        const metrics = this.currentMetrics || this.getDefaultMetrics();

        // 计算精力值 (综合多项指标)
        const energy = this.calculateEnergy(metrics);

        // 确定心情
        const mood = this.determineMood(metrics, energy);

        // 确定肤色
        const skinTone = this.determineSkinTone(metrics);

        // 确定姿态
        const posture = this.determinePosture(energy);

        // 确定眼睛状态
        const eyeState = this.determineEyeState(metrics, energy);

        // 确定动画
        const animation = this.determineAnimation(metrics);

        // 确定警报级别
        const alertLevel = this.determineAlertLevel(metrics);

        // 生成状态消息
        const message = this.generateStateMessage(metrics, mood, alertLevel);

        // 新增：确定呼吸频率（基于心率和血氧）
        const breathingRate = this.determineBreathingRate(metrics);

        // 新增：确定出汗程度（高血压、心率过快时）
        const sweating = this.determineSweating(metrics);

        // 新增：确定颤抖程度（严重低血氧、极度疲劳）
        const tremor = this.determineTremor(metrics, energy);

        // 新增：面部表情（疼痛、不适）
        const facialExpression = this.determineFacialExpression(metrics, alertLevel);

        // 新增：嘴唇颜色（血氧直接影响）
        const lipColor = this.determineLipColor(metrics);

        // 新增：头部下垂（疲劳、低血压）
        const headTilt = this.determineHeadTilt(metrics, energy);

        // 新增：肩膀下沉（精力、姿态）
        const shoulderSlump = this.determineShoulderSlump(energy);

        // 新增：黑眼圈程度（睡眠不足时）
        const darkCircleIntensity = this.determineDarkCircleIntensity(metrics);

        // 新增：心跳可视化（基于心率）
        const { heartbeatIntensity, heartbeatSpeed } = this.determineHeartbeat(metrics);

        // 新增：指尖紫绀（低血氧）
        const fingerCyanosis = this.determineFingerCyanosis(metrics);

        // 新增：太阳穴血管跳动（高血压）
        const templeVeinPulse = this.determineTempleVeinPulse(metrics);

        // 新增：头痛姿势（高血压危象）
        const headachePose = this.determineHeadachePose(metrics);

        // 新增：身体稳定性（步数、运动量）
        const bodyStability = this.determineBodyStability(metrics);

        // 新增：整体健康光晕
        const overallHealthGlow = this.determineOverallHealthGlow(alertLevel);

        // 对话情绪融合：从 emotionService 读取当前情绪（含衰减）
        const conversationEmotion = emotionService.getCurrentEmotion();
        const conversationMood = conversationEmotion.intensity > 0.1 ? conversationEmotion.primary : undefined;
        const conversationMoodIntensity = conversationEmotion.intensity;

        // 融合对话情绪到 mood 和 facialExpression
        const fusedMood = this.fuseMoodWithEmotion(mood, conversationMood, conversationMoodIntensity);
        const fusedExpression = this.fuseExpressionWithEmotion(facialExpression, conversationMood, conversationMoodIntensity);

        return {
            energy,
            mood: fusedMood,
            skinTone,
            posture,
            eyeState,
            animation,
            alertLevel,
            message,
            breathingRate,
            sweating,
            tremor,
            facialExpression: fusedExpression,
            lipColor,
            headTilt,
            shoulderSlump,
            darkCircleIntensity,
            heartbeatIntensity,
            heartbeatSpeed,
            fingerCyanosis,
            templeVeinPulse,
            headachePose,
            bodyStability,
            overallHealthGlow,
            conversationMood,
            conversationMoodIntensity,
        };
    }

    /**
     * 确定黑眼圈程度（睡眠不足时）
     * 医学依据：睡眠剥夺会导致眼周血管淤血、色素沉着
     */
    private determineDarkCircleIntensity(metrics: HealthMetrics): number {
        const h = metrics.sleepHours;
        if (h >= 7) return 0;
        if (h >= 6) return 0.2;
        if (h >= 5) return 0.5;
        if (h >= 4) return 0.8;
        return 1;
    }

    /**
     * 确定心跳可视化参数
     * 医学依据：心率直接反映心脏跳动频率，可通过胸部起伏可视化
     */
    private determineHeartbeat(metrics: HealthMetrics): { heartbeatIntensity: number; heartbeatSpeed: number } {
        const hr = metrics.heartRate;
        // 心跳速度 = 心率 / 60（每秒跳动次数）
        const heartbeatSpeed = hr / 60;
        
        // 心跳强度：正常心率时适中，过快或过慢时更明显
        let intensity = 0.3; // 基础强度
        if (hr > this.thresholds.heartRate.critical) {
            intensity = 1.0;  // 心率 > 120，非常明显
        } else if (hr > this.thresholds.heartRate.high) {
            intensity = 0.7;  // 心率 > 100
        } else if (hr < this.thresholds.heartRate.low) {
            intensity = 0.5;  // 心率 < 50，较慢但明显
        }
        
        return { heartbeatIntensity: intensity, heartbeatSpeed };
    }

    /**
     * 确定指尖紫绀程度
     * 医学依据：血氧 < 90% 时末梢循环首先出现紫绀
     */
    private determineFingerCyanosis(metrics: HealthMetrics): number {
        const o2 = metrics.bloodOxygen;
        if (o2 >= 95) return 0;
        if (o2 >= 92) return 0.3;
        if (o2 >= 90) return 0.6;
        return 1.0;
    }

    /**
     * 确定太阳穴血管跳动程度
     * 医学依据：高血压时颞动脉压力增大，可见明显搏动
     */
    private determineTempleVeinPulse(metrics: HealthMetrics): number {
        if (!metrics.bloodPressure) return 0;
        const sys = metrics.bloodPressure.systolic;
        const dia = metrics.bloodPressure.diastolic;
        
        if (sys >= this.thresholds.bloodPressure.systolicCritical || dia >= 100) {
            return 1.0;
        }
        if (sys >= this.thresholds.bloodPressure.systolicHigh || dia >= this.thresholds.bloodPressure.diastolicHigh) {
            return 0.6;
        }
        if (sys >= 130 || dia >= 85) {
            return 0.3;
        }
        return 0;
    }

    /**
     * 确定头痛姿势（手扶额头）
     * 医学依据：高血压危象常伴随剧烈头痛
     */
    private determineHeadachePose(metrics: HealthMetrics): boolean {
        if (!metrics.bloodPressure) return false;
        // 收缩压 >= 160 或 舒张压 >= 100 时触发头痛姿势
        return metrics.bloodPressure.systolic >= this.thresholds.bloodPressure.systolicCritical ||
               metrics.bloodPressure.diastolic >= 100;
    }

    /**
     * 确定身体稳定性
     * 医学依据：运动量影响肌肉力量和平衡能力
     */
    private determineBodyStability(metrics: HealthMetrics): number {
        const steps = metrics.steps;
        // 步数越多，身体越稳定（适度运动）
        if (steps >= 5000) return 1.0;
        if (steps >= 3000) return 0.8;
        if (steps >= 2000) return 0.6;
        if (steps >= 1000) return 0.4;
        return 0.2;  // 久坐不动，稳定性差
    }

    /**
     * 确定整体健康光晕颜色
     */
    private determineOverallHealthGlow(alertLevel: AvatarState['alertLevel']): AvatarState['overallHealthGlow'] {
        switch (alertLevel) {
            case 'critical': return 'red';
            case 'warning': return 'orange';
            case 'attention': return 'yellow';
            default: return 'green';
        }
    }

    /**
     * 融合生理 mood 与对话情绪
     * 对话情绪作为加权叠加，不直接覆盖生理状态
     */
    private fuseMoodWithEmotion(
        physiologicalMood: AvatarState['mood'],
        conversationMood: UserEmotion | undefined,
        intensity: number,
    ): AvatarState['mood'] {
        // 生理危急状态优先
        if (physiologicalMood === 'tired' || physiologicalMood === 'sleepy') {
            return physiologicalMood;
        }

        // 对话情绪强度不足，不影响
        if (!conversationMood || intensity < 0.2) {
            return physiologicalMood;
        }

        const mapping = emotionService.getAvatarMapping({ primary: conversationMood, intensity, sentiment: 'neutral', confidence: 1 });
        // 高强度对话情绪（≥0.5）直接采用映射的 mood
        if (intensity >= 0.5) {
            return mapping.mood;
        }

        // 低强度时仅在生理 calm/happy 状态下融合
        if (physiologicalMood === 'calm' || physiologicalMood === 'happy') {
            return mapping.mood;
        }

        return physiologicalMood;
    }

    /**
     * 融合面部表情与对话情绪
     */
    private fuseExpressionWithEmotion(
        physiologicalExpression: AvatarState['facialExpression'],
        conversationMood: UserEmotion | undefined,
        intensity: number,
    ): AvatarState['facialExpression'] {
        // 生理痛苦表情优先
        if (physiologicalExpression === 'pained') {
            return physiologicalExpression;
        }

        if (!conversationMood || intensity < 0.2) {
            return physiologicalExpression;
        }

        const mapping = emotionService.getAvatarMapping({ primary: conversationMood, intensity, sentiment: 'neutral', confidence: 1 });
        // 对话情绪驱动的表情：仅在生理表情为 neutral/peaceful 时叠加
        if (physiologicalExpression === 'neutral' || physiologicalExpression === 'peaceful') {
            return mapping.facialExpression;
        }

        return physiologicalExpression;
    }

    /**
     * 计算精力值
     */
    private calculateEnergy(metrics: HealthMetrics): number {
        let energy = 70; // 基础值

        // 睡眠影响 (30%)
        const sleepScore = Math.min(metrics.sleepHours / this.thresholds.sleepHours.ideal, 1) * 30;
        energy = energy - 15 + sleepScore;

        // 血氧影响 (20%)
        if (metrics.bloodOxygen < this.thresholds.bloodOxygen.low) {
            energy -= (this.thresholds.bloodOxygen.low - metrics.bloodOxygen) * 3;
        }

        // 心率影响 (20%)
        if (metrics.heartRate < this.thresholds.heartRate.low) {
            energy -= 10;
        } else if (metrics.heartRate > this.thresholds.heartRate.high) {
            energy -= 15;
        }

        // 血压影响 (高血压降低精力)
        if (metrics.bloodPressure) {
            if (metrics.bloodPressure.systolic >= this.thresholds.bloodPressure.systolicCritical ||
                metrics.bloodPressure.diastolic >= this.thresholds.bloodPressure.diastolicHigh + 10) {
                energy -= 20;
            } else if (metrics.bloodPressure.systolic >= this.thresholds.bloodPressure.systolicHigh ||
                       metrics.bloodPressure.diastolic >= this.thresholds.bloodPressure.diastolicHigh) {
                energy -= 10;
            }
        }

        // 运动影响 (10%)
        const stepsScore = Math.min(metrics.steps / this.thresholds.steps.ideal, 1) * 10;
        energy += stepsScore;

        return Math.max(0, Math.min(100, energy));
    }

    /**
     * 确定心情
     */
    private determineMood(metrics: HealthMetrics, energy: number): AvatarState['mood'] {
        if (energy < 30) return 'tired';
        if (metrics.sleepHours < 5) return 'sleepy';
        if (metrics.bloodOxygen < this.thresholds.bloodOxygen.low) return 'worried';
        // 高血压导致担忧
        if (metrics.bloodPressure &&
            (metrics.bloodPressure.systolic >= this.thresholds.bloodPressure.systolicHigh ||
             metrics.bloodPressure.diastolic >= this.thresholds.bloodPressure.diastolicHigh)) {
            return 'worried';
        }
        if (energy > 70 && metrics.steps > this.thresholds.steps.min) return 'happy';
        return 'calm';
    }

    /**
     * 确定肤色
     */
    private determineSkinTone(metrics: HealthMetrics): AvatarState['skinTone'] {
        if (metrics.bloodOxygen < this.thresholds.bloodOxygen.critical) return 'pale';
        if (metrics.heartRate > this.thresholds.heartRate.critical) return 'flushed';
        // 高血压也可表现为面色潮红
        if (metrics.bloodPressure &&
            (metrics.bloodPressure.systolic >= this.thresholds.bloodPressure.systolicHigh ||
             metrics.bloodPressure.diastolic >= this.thresholds.bloodPressure.diastolicHigh)) {
            return 'flushed';
        }
        return 'healthy';
    }

    /**
     * 确定姿态
     */
    private determinePosture(energy: number): AvatarState['posture'] {
        if (energy < 30) return 'slouched';
        if (energy > 70) return 'upright';
        return 'relaxed';
    }

    /**
     * 确定眼睛状态
     * 亚健康/疲倦时：睡眠不足、精力低 → 昏昏欲睡、睁不开眼
     */
    private determineEyeState(metrics: HealthMetrics, energy: number): AvatarState['eyeState'] {
        if (metrics.sleepHours < 4) return 'closed';
        // 睡眠 < 6h 或精力 < 55 → 疲倦昏沉、眼皮沉重
        if (metrics.sleepHours < 6 || energy < 55) return 'droopy';
        if (energy > 80) return 'wide';
        return 'normal';
    }

    /**
     * 确定动画
     */
    private determineAnimation(metrics: HealthMetrics): AvatarState['animation'] {
        if (metrics.heartRate > this.thresholds.heartRate.high) return 'breathing_fast';
        if (metrics.heartRate < this.thresholds.heartRate.low) return 'breathing_slow';
        return 'idle';
    }

    /**
     * 确定呼吸频率（基于心率、血氧）
     * 医学依据：心率与呼吸频率相关；低血氧会代偿性加快呼吸
     */
    private determineBreathingRate(metrics: HealthMetrics): AvatarState['breathingRate'] {
        // 低血氧 < 90% 会触发急促呼吸
        if (metrics.bloodOxygen < this.thresholds.bloodOxygen.critical) return 'rapid';
        
        // 心率过快 > 100 或血氧偏低 < 95% 会呼吸加快
        if (metrics.heartRate > this.thresholds.heartRate.high || 
            metrics.bloodOxygen < this.thresholds.bloodOxygen.low) return 'fast';
        
        // 心率过慢 < 50 呼吸变慢
        if (metrics.heartRate < this.thresholds.heartRate.low) return 'slow';
        
        return 'normal';
    }

    /**
     * 确定出汗程度
     * 医学依据：高血压危象、心率过快、精神紧张时出汗增加
     */
    private determineSweating(metrics: HealthMetrics): number {
        let sweating = 0;

        // 心率过快出汗
        if (metrics.heartRate > this.thresholds.heartRate.critical) {
            sweating += 0.6;
        } else if (metrics.heartRate > this.thresholds.heartRate.high) {
            sweating += 0.3;
        }

        // 高血压危象出汗（收缩压 ≥ 160 或舒张压 ≥ 100）
        if (metrics.bloodPressure) {
            if (metrics.bloodPressure.systolic >= this.thresholds.bloodPressure.systolicCritical) {
                sweating += 0.4;
            }
            if (metrics.bloodPressure.diastolic >= this.thresholds.bloodPressure.diastolicHigh + 10) {
                sweating += 0.3;
            }
        }

        return Math.min(1, sweating);
    }

    /**
     * 确定颤抖程度
     * 医学依据：严重低血氧、极度疲劳、高血压危象可能颤抖
     */
    private determineTremor(metrics: HealthMetrics, energy: number): number {
        let tremor = 0;

        // 严重低血氧 < 90%
        if (metrics.bloodOxygen < this.thresholds.bloodOxygen.critical) {
            tremor += 0.5;
        }

        // 极度疲劳（精力 < 20）
        if (energy < 20) {
            tremor += 0.3;
        }

        // 心率严重异常
        if (metrics.heartRate > this.thresholds.heartRate.critical || metrics.heartRate < 45) {
            tremor += 0.4;
        }

        return Math.min(1, tremor);
    }

    /**
     * 确定面部表情
     * 医学依据：疼痛、不适、呼吸困难时表情变化
     */
    private determineFacialExpression(
        metrics: HealthMetrics,
        alertLevel: AvatarState['alertLevel']
    ): AvatarState['facialExpression'] {
        // 危急状态：痛苦表情
        if (alertLevel === 'critical') {
            return 'pained';
        }

        // 严重不适：呼吸困难、头痛（高血压）
        if (metrics.bloodOxygen < this.thresholds.bloodOxygen.low ||
            (metrics.bloodPressure && 
             metrics.bloodPressure.systolic >= this.thresholds.bloodPressure.systolicHigh)) {
            return 'distressed';
        }

        // 健康状态：安详
        if (alertLevel === 'normal' && metrics.sleepHours >= 7) {
            return 'peaceful';
        }

        return 'neutral';
    }

    /**
     * 确定嘴唇颜色
     * 医学依据：血氧饱和度直接影响嘴唇颜色
     * 正常 >95% 红润；90-95% 偏淡；<90% 紫绀（cyanotic）
     */
    private determineLipColor(metrics: HealthMetrics): AvatarState['lipColor'] {
        if (metrics.bloodOxygen < this.thresholds.bloodOxygen.critical) {
            return 'cyanotic';  // 紫绀
        }
        if (metrics.bloodOxygen < this.thresholds.bloodOxygen.low) {
            return 'pale';  // 苍白
        }
        if (metrics.bloodOxygen >= 98) {
            return 'rosy';  // 红润
        }
        return 'normal';
    }

    /**
     * 确定头部下垂程度
     * 医学依据：疲劳、睡眠不足、低血压时头部难以维持直立
     */
    private determineHeadTilt(metrics: HealthMetrics, energy: number): number {
        let tilt = 0;

        // 睡眠不足 < 5h
        if (metrics.sleepHours < 5) {
            tilt += 0.3;
        }

        // 精力极低 < 30
        if (energy < 30) {
            tilt += 0.4;
        }

        // 低血压（收缩压 < 110，老年人临界值）
        if (metrics.bloodPressure && metrics.bloodPressure.systolic < 110) {
            tilt += 0.2;
        }

        return Math.min(1, tilt);
    }

    /**
     * 确定肩膀下沉程度
     * 医学依据：精力、姿态反映肌肉张力
     */
    private determineShoulderSlump(energy: number): number {
        if (energy < 30) return 0.8;
        if (energy < 50) return 0.5;
        if (energy < 70) return 0.2;
        return 0;
    }

    /**
     * 确定警报级别
     */
    private determineAlertLevel(metrics: HealthMetrics): AvatarState['alertLevel'] {
        // 严重警报
        if (
            metrics.bloodOxygen < this.thresholds.bloodOxygen.critical ||
            metrics.heartRate > this.thresholds.heartRate.critical ||
            (metrics.bloodPressure && (
                metrics.bloodPressure.systolic >= this.thresholds.bloodPressure.systolicCritical ||
                metrics.bloodPressure.diastolic >= this.thresholds.bloodPressure.diastolicHigh + 10
            ))
        ) {
            return 'critical';
        }

        // 警告（含高血压、血氧偏低、心率异常、睡眠不足）
        if (
            metrics.bloodOxygen < this.thresholds.bloodOxygen.low ||
            metrics.heartRate > this.thresholds.heartRate.high ||
            metrics.heartRate < this.thresholds.heartRate.low ||
            metrics.sleepHours < 5 ||
            (metrics.bloodPressure &&
                (metrics.bloodPressure.systolic >= this.thresholds.bloodPressure.systolicHigh ||
                 metrics.bloodPressure.diastolic >= this.thresholds.bloodPressure.diastolicHigh))
        ) {
            return 'warning';
        }

        // 关注
        if (metrics.steps < this.thresholds.steps.min) {
            return 'attention';
        }

        return 'normal';
    }

    /**
     * 生成状态消息
     */
    private generateStateMessage(
        metrics: HealthMetrics,
        mood: AvatarState['mood'],
        alertLevel: AvatarState['alertLevel']
    ): string {
        if (alertLevel === 'critical') {
            if (metrics.bloodOxygen < this.thresholds.bloodOxygen.critical) {
                return '血氧偏低，请深呼吸并休息';
            }
            if (metrics.heartRate > this.thresholds.heartRate.critical) {
                return '心跳过快，请坐下休息';
            }
            if (metrics.bloodPressure &&
                (metrics.bloodPressure.systolic >= this.thresholds.bloodPressure.systolicCritical ||
                 metrics.bloodPressure.diastolic >= this.thresholds.bloodPressure.diastolicHigh + 10)) {
                return '血压偏高，请静坐休息并监测';
            }
        }

        if (alertLevel === 'warning') {
            if (metrics.sleepHours < 5) {
                return '昨晚睡眠不足，今天要早点休息哦';
            }
            if (metrics.bloodPressure &&
                (metrics.bloodPressure.systolic >= this.thresholds.bloodPressure.systolicHigh ||
                 metrics.bloodPressure.diastolic >= this.thresholds.bloodPressure.diastolicHigh)) {
                return '血压偏高，建议低盐饮食、规律服药';
            }
        }

        const messages: Record<AvatarState['mood'], string> = {
            happy: '今天状态不错！继续保持~',
            calm: '一切正常，我在陪着您',
            tired: '看起来有点累，要不要休息一下？',
            worried: '我有点担心您，要不要测量一下血压？',
            sleepy: '眼睛都睁不开啦，去躺一会吧',
        };

        return messages[mood];
    }

    /**
     * 检查并发出警报
     */
    private checkAlerts(): void {
        if (!this.currentMetrics) return;

        const metrics = this.currentMetrics;

        // 血氧警报
        if (metrics.bloodOxygen < this.thresholds.bloodOxygen.critical) {
            this.addAlert('critical', 'bloodOxygen', metrics.bloodOxygen, this.thresholds.bloodOxygen.critical, '血氧水平严重偏低！');
        } else if (metrics.bloodOxygen < this.thresholds.bloodOxygen.low) {
            this.addAlert('warning', 'bloodOxygen', metrics.bloodOxygen, this.thresholds.bloodOxygen.low, '血氧水平偏低');
        }

        // 心率警报
        if (metrics.heartRate > this.thresholds.heartRate.critical) {
            this.addAlert('critical', 'heartRate', metrics.heartRate, this.thresholds.heartRate.critical, '心率过快！');
        }

        // 血压警报
        if (metrics.bloodPressure) {
            if (metrics.bloodPressure.systolic >= this.thresholds.bloodPressure.systolicCritical) {
                this.addAlert('critical', 'bloodPressure', metrics.bloodPressure.systolic, this.thresholds.bloodPressure.systolicCritical, '收缩压过高！');
            } else if (metrics.bloodPressure.systolic >= this.thresholds.bloodPressure.systolicHigh) {
                this.addAlert('warning', 'bloodPressure', metrics.bloodPressure.systolic, this.thresholds.bloodPressure.systolicHigh, '收缩压偏高');
            }
            if (metrics.bloodPressure.diastolic >= this.thresholds.bloodPressure.diastolicHigh + 10) {
                this.addAlert('critical', 'bloodPressure', metrics.bloodPressure.diastolic, this.thresholds.bloodPressure.diastolicHigh, '舒张压过高！');
            } else if (metrics.bloodPressure.diastolic >= this.thresholds.bloodPressure.diastolicHigh) {
                this.addAlert('warning', 'bloodPressure', metrics.bloodPressure.diastolic, this.thresholds.bloodPressure.diastolicHigh, '舒张压偏高');
            }
        }
    }

    /**
     * 添加警报
     */
    private addAlert(
        type: HealthAlert['type'],
        metric: string,
        value: number,
        threshold: number,
        message: string
    ): void {
        this.alertHistory.unshift({
            type,
            metric,
            value,
            threshold,
            message,
            timestamp: new Date(),
        });

        // 只保留最近20条
        this.alertHistory = this.alertHistory.slice(0, 20);
    }

    /**
     * 订阅状态变化
     */
    subscribe(listener: (state: AvatarState) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    /**
     * 获取警报历史
     */
    getAlertHistory(): HealthAlert[] {
        return [...this.alertHistory];
    }

    getCurrentMetrics(): HealthMetrics {
        return {
            ...(this.currentMetrics || this.getDefaultMetrics()),
        };
    }

    /**
     * 获取默认指标（模拟数据）
     */
    private getDefaultMetrics(): HealthMetrics {
        return {
            heartRate: 72 + Math.floor(Math.random() * 10),
            bloodOxygen: 97 + Math.floor(Math.random() * 3),
            sleepHours: 7,
            steps: 3000 + Math.floor(Math.random() * 2000),
            bloodPressure: { systolic: 120, diastolic: 80 },
        };
    }

    /**
     * 开始模拟数据（用于演示）
     */
    startSimulation(): () => void {
        const interval = setInterval(() => {
            const variation = () => (Math.random() - 0.5) * 2;

            this.updateMetrics({
                heartRate: Math.floor(72 + variation() * 5),
                bloodOxygen: Math.floor(97 + variation()),
                steps: (this.currentMetrics?.steps || 3000) + Math.floor(Math.random() * 50),
            });
        }, 5000);

        return () => clearInterval(interval);
    }
}

// 单例导出
export const healthStateService = new HealthStateService();
