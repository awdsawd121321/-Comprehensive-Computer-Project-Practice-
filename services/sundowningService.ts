/**
 * 黄昏守护服务（Sundowning）
 * - 结合时间窗口 + 行为信号计算风险指数
 * - 触发主动干预（语音安抚 / 音乐 / 呼吸 / 相册回忆）
 * - 向 Dashboard 与 App 推送风险快照与告警
 */

import { openclawSyncService } from './openclawSyncService';

export type SundowningRiskLevel = 'low' | 'medium' | 'high';

export type SundowningInterventionType =
    | 'family_voice_story'
    | 'personal_music'
    | 'breathing_exercise'
    | 'family_album_story';

export interface SundowningBehaviorSignalInput {
    confusionScore?: number;       // 困惑程度 0-100
    repeatedQuestions?: number;    // 重复提问次数（本次增量）
    stepAnomalyScore?: number;     // 步态/步数异常 0-100
    agitationScore?: number;       // 焦虑/激越程度 0-100
    source?: 'voice' | 'motion' | 'manual' | 'simulation' | 'system';
}

interface SundowningBehaviorSignal {
    timestamp: number;
    confusionScore: number;
    repeatedQuestions: number;
    stepAnomalyScore: number;
    agitationScore: number;
    source: 'voice' | 'motion' | 'manual' | 'simulation' | 'system';
}

export interface SundowningRiskSnapshot {
    timestamp: number;
    riskScore: number;
    riskLevel: SundowningRiskLevel;
    trend: 'rising' | 'stable' | 'falling';
    timeWindowWeight: number;
    behaviorSummary: {
        confusionScore: number;
        repeatedQuestions: number;
        stepAnomalyScore: number;
        agitationScore: number;
    };
    keyFactors: string[];
    recommendedInterventions: SundowningInterventionType[];
}

export interface SundowningInterventionPlan {
    id: string;
    type: SundowningInterventionType;
    title: string;
    description: string;
    script: string;
    status: 'running' | 'completed';
    startedAt: number;
    endedAt?: number;
    source: 'auto' | 'manual';
}

export interface SundowningPushAlert {
    id: string;
    timestamp: number;
    level: 'medium' | 'high';
    title: string;
    message: string;
    riskScore: number;
}

type SnapshotListener = (snapshot: SundowningRiskSnapshot) => void;
type AlertListener = (alert: SundowningPushAlert) => void;
type InterventionListener = (plan: SundowningInterventionPlan | null) => void;

const HIGH_RISK_START_HOUR = 16; // 16:00
const HIGH_RISK_END_HOUR = 19;   // 19:00
const SIGNAL_WINDOW_MS = 2 * 60 * 60 * 1000; // 最近 2 小时
const MAX_SIGNALS_FOR_RISK = 30; // 风险计算最多使用最近 30 条信号，避免高频采样“淹没”新状态
const MAX_SIGNAL_COUNT = 360;
const MAX_SNAPSHOT_COUNT = 144;
const MAX_ALERT_COUNT = 60;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export type SundowningServiceOptions = {
    /**
     * 默认开启，用于生产/演示：即便没有新行为，也会每分钟更新一次风险快照。
     * 单元测试中可关闭，避免常驻定时器造成不确定性。
     */
    enableHeartbeat?: boolean;
};

export class SundowningService {
    private signals: SundowningBehaviorSignal[] = [];
    private snapshots: SundowningRiskSnapshot[] = [];
    private alerts: SundowningPushAlert[] = [];
    private activeIntervention: SundowningInterventionPlan | null = null;
    private interventionCursor = 0;
    private lastAlertAt = 0;

    private snapshotListeners: SnapshotListener[] = [];
    private alertListeners: AlertListener[] = [];
    private interventionListeners: InterventionListener[] = [];

    private simulationTimer: ReturnType<typeof setInterval> | null = null;
    private recoveryTimer: ReturnType<typeof setInterval> | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private interventionAutoCompleteTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(options?: SundowningServiceOptions) {
        // 初次生成一条快照，Dashboard 初次渲染就有数据
        this.evaluateRisk(new Date());

        // 即便没有新行为，也定时依据时段更新风险
        const enableHeartbeat = options?.enableHeartbeat ?? true;
        if (enableHeartbeat) {
            this.heartbeatTimer = setInterval(() => {
                this.evaluateRisk(new Date());
            }, 60 * 1000);
        }
    }

    recordBehavior(input: SundowningBehaviorSignalInput): SundowningRiskSnapshot {
        const signal: SundowningBehaviorSignal = {
            timestamp: Date.now(),
            confusionScore: clamp(input.confusionScore ?? 0, 0, 100),
            repeatedQuestions: clamp(Math.round(input.repeatedQuestions ?? 0), 0, 10),
            stepAnomalyScore: clamp(input.stepAnomalyScore ?? 0, 0, 100),
            agitationScore: clamp(input.agitationScore ?? 0, 0, 100),
            source: input.source ?? 'system',
        };

        this.signals.push(signal);
        if (this.signals.length > MAX_SIGNAL_COUNT) {
            this.signals = this.signals.slice(-MAX_SIGNAL_COUNT);
        }

        return this.evaluateRisk(new Date());
    }

    evaluateRisk(now: Date = new Date()): SundowningRiskSnapshot {
        const recent = this.getRecentSignals(now);
        const summary = this.summarizeSignals(recent);
        const timeWindowWeight = this.getTimeWindowWeight(now);

        // 风险评分模型（0-100）
        // 时间窗口 + 行为四类特征（困惑、重复提问、步态异常、焦虑）
        const repeatedQuestionScore = clamp(summary.repeatedQuestions * 8, 0, 24);
        const rawRiskScore = clamp(
            Math.round(
                8 +
                timeWindowWeight +
                summary.confusionScore * 0.26 +
                summary.agitationScore * 0.24 +
                summary.stepAnomalyScore * 0.18 +
                repeatedQuestionScore
            ),
            0,
            100
        );
        const prev = this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
        // 指数平滑：降低每次刷新的跳变感，保留实时趋势
        const riskScore = prev
            ? clamp(Math.round(prev.riskScore * 0.72 + rawRiskScore * 0.28), 0, 100)
            : rawRiskScore;

        const riskLevel: SundowningRiskLevel =
            riskScore >= 72 ? 'high' :
            riskScore >= 45 ? 'medium' : 'low';

        const trend = !prev
            ? 'stable'
            : riskScore - prev.riskScore >= 5
                ? 'rising'
                : prev.riskScore - riskScore >= 5
                    ? 'falling'
                    : 'stable';

        const keyFactors: string[] = [];
        if (timeWindowWeight >= 20) keyFactors.push('处于黄昏高危时段(16:00-19:00)');
        if (summary.confusionScore >= 55) keyFactors.push('困惑/定向障碍信号升高');
        if (summary.repeatedQuestions >= 2) keyFactors.push('重复提问次数增加');
        if (summary.stepAnomalyScore >= 50) keyFactors.push('步态或步数模式异常');
        if (summary.agitationScore >= 50) keyFactors.push('焦虑激越趋势上升');
        if (keyFactors.length === 0) keyFactors.push('目前信号平稳');

        const recommendedInterventions = this.selectRecommendedInterventions(
            riskLevel,
            summary,
            timeWindowWeight
        );

        const snapshot: SundowningRiskSnapshot = {
            timestamp: now.getTime(),
            riskScore,
            riskLevel,
            trend,
            timeWindowWeight,
            behaviorSummary: {
                confusionScore: summary.confusionScore,
                repeatedQuestions: summary.repeatedQuestions,
                stepAnomalyScore: summary.stepAnomalyScore,
                agitationScore: summary.agitationScore,
            },
            keyFactors,
            recommendedInterventions,
        };

        this.snapshots.push(snapshot);
        if (this.snapshots.length > MAX_SNAPSHOT_COUNT) {
            this.snapshots = this.snapshots.slice(-MAX_SNAPSHOT_COUNT);
        }

        this.emitSnapshot(snapshot);
        this.maybeEmitAlert(snapshot, prev);

        // 高风险自动触发主动干预
        if (snapshot.riskLevel === 'high' && (!this.activeIntervention || this.activeIntervention.status !== 'running')) {
            this.triggerIntervention(undefined, 'auto');
        }

        return snapshot;
    }

    triggerIntervention(
        preferredType?: SundowningInterventionType,
        source: 'auto' | 'manual' = 'manual'
    ): SundowningInterventionPlan | null {
        if (this.interventionAutoCompleteTimer) {
            clearTimeout(this.interventionAutoCompleteTimer);
            this.interventionAutoCompleteTimer = null;
        }

        const current = this.getCurrentSnapshot();
        const candidates = preferredType
            ? [preferredType]
            : current.recommendedInterventions.length > 0
                ? current.recommendedInterventions
                : ['family_voice_story', 'breathing_exercise'];

        if (candidates.length === 0) return null;

        const selected = candidates[this.interventionCursor % candidates.length];
        this.interventionCursor += 1;

        const template = this.getInterventionTemplate(selected);
        const plan: SundowningInterventionPlan = {
            id: `sundown_plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: selected,
            title: template.title,
            description: template.description,
            script: template.script,
            status: 'running',
            startedAt: Date.now(),
            source,
        };

        this.activeIntervention = plan;
        this.emitIntervention(plan);

        // 立即反馈到「实时推送」，让家属端点击后可见
        const alert: SundowningPushAlert = {
            id: `sundown_alert_intervention_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            timestamp: Date.now(),
            level: current.riskLevel === 'high' ? 'high' : 'medium',
            title: source === 'manual' ? '已执行主动干预' : '系统已自动干预',
            message: `已启动「${plan.title}」：${plan.description}`,
            riskScore: current.riskScore,
        };
        this.alerts.unshift(alert);
        if (this.alerts.length > MAX_ALERT_COUNT) {
            this.alerts = this.alerts.slice(0, MAX_ALERT_COUNT);
        }
        this.emitAlert(alert);

        // 若老人端页面未挂载导致无法回调 complete，这里兜底自动完成
        this.interventionAutoCompleteTimer = setTimeout(() => {
            if (this.activeIntervention?.id === plan.id && this.activeIntervention.status === 'running') {
                this.completeActiveIntervention('done');
            }
        }, 18000);

        return plan;
    }

    completeActiveIntervention(outcome: 'calmed' | 'done' = 'done'): void {
        if (!this.activeIntervention) return;
        if (this.interventionAutoCompleteTimer) {
            clearTimeout(this.interventionAutoCompleteTimer);
            this.interventionAutoCompleteTimer = null;
        }
        this.activeIntervention = {
            ...this.activeIntervention,
            status: 'completed',
            endedAt: Date.now(),
        };
        this.emitIntervention(this.activeIntervention);

        if (outcome === 'calmed') {
            // 干预完成后，注入一条“已缓解”信号帮助风险下行
            this.recordBehavior({
                confusionScore: 15,
                repeatedQuestions: 0,
                stepAnomalyScore: 20,
                agitationScore: 18,
                source: 'system',
            });
        }
    }

    startSimulation(): void {
        if (this.recoveryTimer) {
            clearInterval(this.recoveryTimer);
            this.recoveryTimer = null;
        }
        if (this.simulationTimer) return;

        const pushSignal = () => {
            const rand = (n: number) => Math.floor(Math.random() * n);
            this.recordBehavior({
                confusionScore: 60 + rand(35),
                repeatedQuestions: rand(3),
                stepAnomalyScore: 45 + rand(45),
                agitationScore: 55 + rand(35),
                source: 'simulation',
            });
        };

        pushSignal();
        this.simulationTimer = setInterval(pushSignal, 3000);
    }

    stopSimulation(): void {
        if (this.simulationTimer) {
            clearInterval(this.simulationTimer);
            this.simulationTimer = null;
        }

        if (this.recoveryTimer) {
            clearInterval(this.recoveryTimer);
            this.recoveryTimer = null;
        }

        // 停止模拟后，移除“模拟噪声”，避免高风险信号长期拖住指数不下行
        this.signals = this.signals.filter(s => s.source !== 'simulation');

        // 先打一条当前恢复信号，立即开始下行
        this.recordBehavior({
            confusionScore: 36,
            repeatedQuestions: 0,
            stepAnomalyScore: 40,
            agitationScore: 34,
            source: 'system',
        });

        // 分阶段恢复：生成可见的下降趋势曲线（约 15 秒）
        const recoveryStages: Array<Pick<SundowningBehaviorSignalInput, 'confusionScore' | 'repeatedQuestions' | 'stepAnomalyScore' | 'agitationScore'>> = [
            { confusionScore: 30, repeatedQuestions: 0, stepAnomalyScore: 34, agitationScore: 30 },
            { confusionScore: 24, repeatedQuestions: 0, stepAnomalyScore: 28, agitationScore: 25 },
            { confusionScore: 19, repeatedQuestions: 0, stepAnomalyScore: 22, agitationScore: 21 },
            { confusionScore: 15, repeatedQuestions: 0, stepAnomalyScore: 19, agitationScore: 18 },
            { confusionScore: 12, repeatedQuestions: 0, stepAnomalyScore: 16, agitationScore: 15 },
        ];

        let idx = 0;
        this.recoveryTimer = setInterval(() => {
            const stage = recoveryStages[idx];
            if (!stage) {
                if (this.recoveryTimer) {
                    clearInterval(this.recoveryTimer);
                    this.recoveryTimer = null;
                }
                return;
            }

            this.recordBehavior({
                ...stage,
                source: 'system',
            });
            idx += 1;
        }, 3000);
    }

    subscribe(listener: SnapshotListener): () => void {
        this.snapshotListeners.push(listener);
        listener(this.getCurrentSnapshot());
        return () => {
            this.snapshotListeners = this.snapshotListeners.filter(l => l !== listener);
        };
    }

    subscribeAlerts(listener: AlertListener): () => void {
        this.alertListeners.push(listener);
        return () => {
            this.alertListeners = this.alertListeners.filter(l => l !== listener);
        };
    }

    subscribeInterventions(listener: InterventionListener): () => void {
        this.interventionListeners.push(listener);
        listener(this.activeIntervention);
        return () => {
            this.interventionListeners = this.interventionListeners.filter(l => l !== listener);
        };
    }

    getCurrentSnapshot(): SundowningRiskSnapshot {
        return this.snapshots[this.snapshots.length - 1] ?? {
            timestamp: Date.now(),
            riskScore: 15,
            riskLevel: 'low',
            trend: 'stable',
            timeWindowWeight: 0,
            behaviorSummary: {
                confusionScore: 0,
                repeatedQuestions: 0,
                stepAnomalyScore: 0,
                agitationScore: 0,
            },
            keyFactors: ['尚无数据'],
            recommendedInterventions: ['family_voice_story'],
        };
    }

    getRiskHistory(limit = 24): SundowningRiskSnapshot[] {
        return this.snapshots.slice(-limit);
    }

    getAlerts(limit = 8): SundowningPushAlert[] {
        return this.alerts.slice(0, limit);
    }

    getActiveIntervention(): SundowningInterventionPlan | null {
        return this.activeIntervention;
    }

    private emitSnapshot(snapshot: SundowningRiskSnapshot): void {
        openclawSyncService.syncSundowningSnapshot(snapshot);
        this.snapshotListeners.forEach(listener => listener(snapshot));
    }

    private emitAlert(alert: SundowningPushAlert): void {
        openclawSyncService.syncSundowningAlert(alert);
        this.alertListeners.forEach(listener => listener(alert));
    }

    private emitIntervention(plan: SundowningInterventionPlan | null): void {
        openclawSyncService.syncSundowningIntervention(plan);
        this.interventionListeners.forEach(listener => listener(plan));
    }

    private maybeEmitAlert(snapshot: SundowningRiskSnapshot, prev: SundowningRiskSnapshot | null): void {
        const now = Date.now();
        const levelChanged = !prev || prev.riskLevel !== snapshot.riskLevel;
        const scoreJumped = !!prev && snapshot.riskScore - prev.riskScore >= 8;

        const shouldAlertHigh =
            snapshot.riskLevel === 'high' &&
            (levelChanged || scoreJumped || now - this.lastAlertAt > 3 * 60 * 1000);

        const shouldAlertMedium =
            snapshot.riskLevel === 'medium' &&
            levelChanged &&
            now - this.lastAlertAt > 8 * 60 * 1000;

        if (!shouldAlertHigh && !shouldAlertMedium) return;

        const alert: SundowningPushAlert = {
            id: `sundown_alert_${now}_${Math.random().toString(36).slice(2, 7)}`,
            timestamp: now,
            level: snapshot.riskLevel === 'high' ? 'high' : 'medium',
            title: snapshot.riskLevel === 'high' ? '黄昏高风险预警' : '黄昏风险上升提醒',
            message: `${snapshot.keyFactors.slice(0, 2).join('，')}。当前风险指数 ${snapshot.riskScore}。`,
            riskScore: snapshot.riskScore,
        };

        this.lastAlertAt = now;
        this.alerts.unshift(alert);
        if (this.alerts.length > MAX_ALERT_COUNT) {
            this.alerts = this.alerts.slice(0, MAX_ALERT_COUNT);
        }
        this.emitAlert(alert);
    }

    private getRecentSignals(now: Date): SundowningBehaviorSignal[] {
        const threshold = now.getTime() - SIGNAL_WINDOW_MS;
        const recent = this.signals.filter(s => s.timestamp >= threshold);
        return recent.slice(-MAX_SIGNALS_FOR_RISK);
    }

    private summarizeSignals(signals: SundowningBehaviorSignal[]): {
        confusionScore: number;
        repeatedQuestions: number;
        stepAnomalyScore: number;
        agitationScore: number;
    } {
        if (signals.length === 0) {
            return {
                confusionScore: 12,
                repeatedQuestions: 0,
                stepAnomalyScore: 18,
                agitationScore: 10,
            };
        }

        const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
        const confusionScore = avg(signals.map(s => s.confusionScore));
        const stepAnomalyScore = avg(signals.map(s => s.stepAnomalyScore));
        const agitationScore = avg(signals.map(s => s.agitationScore));
        const repeatedQuestions = clamp(
            signals.reduce((sum, s) => sum + s.repeatedQuestions, 0),
            0,
            6
        );

        return {
            confusionScore: Math.round(confusionScore),
            repeatedQuestions,
            stepAnomalyScore: Math.round(stepAnomalyScore),
            agitationScore: Math.round(agitationScore),
        };
    }

    private getTimeWindowWeight(now: Date): number {
        const h = now.getHours() + now.getMinutes() / 60;
        if (h >= HIGH_RISK_START_HOUR && h < HIGH_RISK_END_HOUR) {
            // 峰值在 17:30
            const center = 17.5;
            const distance = Math.abs(h - center);
            const closeness = 1 - Math.min(1, distance / 1.5);
            return Math.round(20 + closeness * 20); // 20~40
        }
        if ((h >= 15 && h < 16) || (h >= 19 && h < 20)) {
            return 8; // 邻近时段
        }
        return 0;
    }

    private selectRecommendedInterventions(
        riskLevel: SundowningRiskLevel,
        summary: { confusionScore: number; repeatedQuestions: number; stepAnomalyScore: number; agitationScore: number },
        timeWeight: number
    ): SundowningInterventionType[] {
        const picks: SundowningInterventionType[] = [];
        if (summary.repeatedQuestions >= 2) picks.push('family_voice_story');
        if (summary.agitationScore >= 55) picks.push('breathing_exercise');
        if (summary.confusionScore >= 55) picks.push('family_album_story');
        if (timeWeight >= 18) picks.push('personal_music');

        if (riskLevel === 'high') {
            return Array.from(new Set([
                ...picks,
                'family_voice_story',
                'personal_music',
                'breathing_exercise',
                'family_album_story',
            ]));
        }

        if (riskLevel === 'medium') {
            const fallback: SundowningInterventionType[] = ['family_voice_story', 'breathing_exercise'];
            return Array.from(new Set([...(picks.length > 0 ? picks : fallback)])).slice(0, 3);
        }

        return ['family_voice_story'];
    }

    private getInterventionTemplate(type: SundowningInterventionType): {
        title: string;
        description: string;
        script: string;
    } {
        switch (type) {
            case 'family_voice_story':
                return {
                    title: '家属安抚语音',
                    description: '播放家属口吻的安抚叙述，降低焦虑与困惑。',
                    script: '爷爷，我是小明，我在这儿陪着您。我们先坐下来喝口温水，慢慢聊，不着急。',
                };
            case 'personal_music':
                return {
                    title: '个性化音乐安抚',
                    description: '播放熟悉音乐，稳定情绪与节律。',
                    script: '我给您放一段您年轻时喜欢的旋律，我们跟着节奏慢慢放松一下。',
                };
            case 'breathing_exercise':
                return {
                    title: '呼吸放松训练',
                    description: '引导吸气-停顿-呼气，缓解激越与紧张。',
                    script: '我们一起做三轮呼吸练习：吸气四秒，停两秒，再慢慢呼气六秒。我会一直陪着您。',
                };
            case 'family_album_story':
                return {
                    title: '家庭相册回忆',
                    description: '展示家人照片并讲述温暖故事，强化定向与安全感。',
                    script: '我们看看家人的照片吧。这是您和家人一起吃饭的那天，大家都很想您、也都在关心您。',
                };
            default:
                return {
                    title: '陪伴安抚',
                    description: '保持陪伴对话，降低焦虑。',
                    script: '我在这里，您是安全的，我们慢慢来。',
                };
        }
    }
}

export const sundowningService = new SundowningService();
