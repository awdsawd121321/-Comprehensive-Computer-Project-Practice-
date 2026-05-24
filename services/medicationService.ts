/**
 * 服药管理服务
 * 管理老人的用药提醒、记录和统计
 */

import { VoiceService } from './api';
import { openclawSyncService } from './openclawSyncService';

// 药物信息
export interface Medication {
    id: string;
    name: string;              // 药名
    dosage: string;            // 剂量
    frequency: string;         // 频率: 每日1次、每日2次等
    times: string[];           // 服用时间 ['08:00', '20:00']
    instructions: string;      // 服用说明: 饭后服用
    purpose: string;           // 用途: 控制血压
    imageUrl?: string;         // 药物图片
}

// 服药记录
export interface MedicationLog {
    id: string;
    medicationId: string;
    medicationName: string;
    scheduledTime: string;     // 计划服药时间
    actualTime: string | null; // 实际服药时间
    status: 'pending' | 'taken' | 'missed' | 'delayed';
    date: string;              // 日期 YYYY-MM-DD
}

// 提醒状态
export interface MedicationReminder {
    medication: Medication;
    scheduledTime: string;
    isActive: boolean;
    snoozeCount: number;       // 延后次数
}

// 服药事件
export interface MedicationEvent {
    type: 'reminder' | 'taken' | 'missed' | 'snooze' | 'box_open' | 'pillbox_connected';
    medication: Medication;
    scheduledTime: string;
    timestamp: Date;
}

type MedicationCallback = (event: MedicationEvent) => void;

export class MedicationService {
    private medications: Medication[] = [];
    private logs: MedicationLog[] = [];
    private subscribers: MedicationCallback[] = [];
    private activeReminder: MedicationReminder | null = null;
    private checkInterval: any = null;
    private lastCheckedMinute: string = '';

    constructor() {
        this.loadMedications();
        this.loadLogs();
        openclawSyncService.syncMedications(this.medications);
        openclawSyncService.syncMedicationLogs(this.logs);
    }

    /**
     * 订阅服药事件
     */
    subscribe(callback: MedicationCallback): () => void {
        this.subscribers.push(callback);
        return () => {
            this.subscribers = this.subscribers.filter(cb => cb !== callback);
        };
    }

    /**
     * 通知订阅者
     */
    private notify(event: MedicationEvent): void {
        this.subscribers.forEach(cb => cb(event));
        openclawSyncService.syncMedicationEvent(event, this.activeReminder);
    }

    /**
     * 加载药物列表
     */
    private loadMedications(): void {
        try {
            const saved = localStorage.getItem('emobit_medications');
            if (saved) {
                this.medications = JSON.parse(saved);
            } else {
                this.medications = this.getDefaultMedications();
            }
        } catch (e) {
            console.warn('[Medication] 加载药物失败:', e);
            this.medications = this.getDefaultMedications();
        }
    }

    /**
     * 保存药物列表到本地
     */
    private saveMedications(): void {
        try {
            localStorage.setItem('emobit_medications', JSON.stringify(this.medications));
        } catch (e) {
            console.warn('[Medication] 保存药物失败:', e);
        }
        openclawSyncService.syncMedications(this.medications);
    }

    /**
     * 添加药物（子女端）
     * @param med 除 id 外的药物信息，id 由服务生成
     */
    addMedication(med: Omit<Medication, 'id'>): Medication {
        const newMed: Medication = {
            ...med,
            id: `med_${Date.now()}`,
        };
        this.medications.push(newMed);
        this.saveMedications();
        return newMed;
    }

    /**
     * 删除药物
     */
    removeMedication(id: string): void {
        this.medications = this.medications.filter((m) => m.id !== id);
        this.saveMedications();
    }

    /**
     * 默认药物列表（以盐酸奥司他韦为主）
     */
    private getDefaultMedications(): Medication[] {
        return [
            {
                id: 'med_1',
                name: '盐酸奥司他韦',
                dosage: '75mg，1粒',
                frequency: '每日2次',
                times: ['08:00', '20:00'],
                instructions: '与食物同服，用温水送服',
                purpose: '抗流感',
                imageUrl: '/medication/盐酸奥司他韦.jpg',
            },
            {
                id: 'med_2',
                name: '二甲双胍',
                dosage: '500mg，1片',
                frequency: '每日2次',
                times: ['08:00', '18:00'],
                instructions: '饭后服用',
                purpose: '控制血糖',
                imageUrl: 'https://images.unsplash.com/photo-1585435557343-3b092031a831?w=200',
            },
            {
                id: 'med_3',
                name: '氨氯地平',
                dosage: '5mg，1片',
                frequency: '每日1次',
                times: ['08:00'],
                instructions: '早晨空腹服用',
                purpose: '控制血压',
            },
        ];
    }

    /**
     * 加载服药记录
     */
    private loadLogs(): void {
        try {
            const saved = localStorage.getItem('emobit_medication_logs');
            if (saved) {
                this.logs = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('[Medication] 加载记录失败:', e);
        }
        openclawSyncService.syncMedicationLogs(this.logs);
    }

    /**
     * 保存服药记录
     */
    private saveLogs(): void {
        // 只保留最近30天的记录
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const cutoff = thirtyDaysAgo.toISOString().split('T')[0];

        this.logs = this.logs.filter(log => log.date >= cutoff);
        localStorage.setItem('emobit_medication_logs', JSON.stringify(this.logs));
        openclawSyncService.syncMedicationLogs(this.logs);
    }

    /**
     * 开始监控服药时间
     */
    startMonitoring(): void {
        if (this.checkInterval) return;

        console.log('[Medication] 开始服药时间监控');

        // 每分钟检查一次
        this.checkInterval = setInterval(() => {
            this.checkMedicationTime();
        }, 60000);

        // 立即检查一次
        this.checkMedicationTime();
    }

    /**
     * 停止监控
     */
    stopMonitoring(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        console.log('[Medication] 停止服药时间监控');
    }

    /**
     * 检查是否到服药时间
     */
    private checkMedicationTime(): void {
        const now = new Date();
        const currentTime = now.toTimeString().slice(0, 5);  // HH:MM
        const today = now.toISOString().split('T')[0];

        // 避免同一分钟重复检查
        if (currentTime === this.lastCheckedMinute) return;
        this.lastCheckedMinute = currentTime;

        // 检查每种药物
        for (const med of this.medications) {
            for (const time of med.times) {
                if (time === currentTime) {
                    // 检查今天是否已经服用
                    const alreadyTaken = this.logs.some(
                        log => log.medicationId === med.id &&
                            log.scheduledTime === time &&
                            log.date === today &&
                            log.status === 'taken'
                    );

                    if (!alreadyTaken) {
                        this.triggerReminder(med, time);
                    }
                }
            }
        }
    }

    /**
     * 触发服药提醒
     */
    triggerReminder(medication: Medication, scheduledTime: string): void {
        console.log('[Medication] 触发提醒:', medication.name);

        this.activeReminder = {
            medication,
            scheduledTime,
            isActive: true,
            snoozeCount: 0,
        };

        // 语音提醒
        const message = `张爷爷，现在是${scheduledTime}，该吃${medication.name}了。${medication.dosage}，${medication.instructions}。`;
        VoiceService.speak(message).catch(console.error);

        // 通知订阅者
        this.notify({
            type: 'reminder',
            medication,
            scheduledTime,
            timestamp: new Date(),
        });
    }

    /**
     * 确认服药
     */
    confirmTaken(medicationId?: string): void {
        const reminder = this.activeReminder;
        if (!reminder) return;

        const now = new Date();
        const today = now.toISOString().split('T')[0];

        // 创建服药记录
        const log: MedicationLog = {
            id: `log_${Date.now()}`,
            medicationId: reminder.medication.id,
            medicationName: reminder.medication.name,
            scheduledTime: reminder.scheduledTime,
            actualTime: now.toTimeString().slice(0, 5),
            status: 'taken',
            date: today,
        };

        this.logs.push(log);
        this.saveLogs();

        // 语音确认
        VoiceService.speak('好的，已记录您服药了。记得多喝水哦~').catch(console.error);

        // 通知订阅者
        this.notify({
            type: 'taken',
            medication: reminder.medication,
            scheduledTime: reminder.scheduledTime,
            timestamp: now,
        });

        // 清除当前提醒
        this.activeReminder = null;
    }

    /**
     * 延后提醒
     */
    snoozeReminder(minutes: number = 10): void {
        if (!this.activeReminder) return;

        this.activeReminder.snoozeCount++;
        this.activeReminder.isActive = false;

        VoiceService.speak(`好的，${minutes}分钟后再提醒您。`).catch(console.error);

        this.notify({
            type: 'snooze',
            medication: this.activeReminder.medication,
            scheduledTime: this.activeReminder.scheduledTime,
            timestamp: new Date(),
        });

        // 延后提醒
        setTimeout(() => {
            if (this.activeReminder) {
                this.activeReminder.isActive = true;
                this.triggerReminder(
                    this.activeReminder.medication,
                    this.activeReminder.scheduledTime
                );
            }
        }, minutes * 60 * 1000);
    }

    /**
     * 获取当前活跃提醒
     */
    getActiveReminder(): MedicationReminder | null {
        return this.activeReminder;
    }

    /**
     * 获取药物列表
     */
    getMedications(): Medication[] {
        return [...this.medications];
    }

    /**
     * 获取今日服药记录
     */
    getTodayLogs(): MedicationLog[] {
        const today = new Date().toISOString().split('T')[0];
        return this.logs.filter(log => log.date === today);
    }

    /**
     * 获取服药统计
     */
    getStatistics(days: number = 7): {
        totalScheduled: number;
        totalTaken: number;
        adherenceRate: number;
        logs: MedicationLog[];
    } {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffDate = cutoff.toISOString().split('T')[0];

        const recentLogs = this.logs.filter(log => log.date >= cutoffDate);
        const totalScheduled = recentLogs.length;
        const totalTaken = recentLogs.filter(log => log.status === 'taken').length;

        return {
            totalScheduled,
            totalTaken,
            adherenceRate: totalScheduled > 0 ? Math.round((totalTaken / totalScheduled) * 100) : 100,
            logs: recentLogs,
        };
    }

    /**
     * 获取下次服药时间
     */
    getNextMedicationTime(): { medication: Medication; time: string } | null {
        const now = new Date();
        const currentTime = now.toTimeString().slice(0, 5);

        let nextMed: { medication: Medication; time: string } | null = null;
        let nextTimeDiff = Infinity;

        for (const med of this.medications) {
            for (const time of med.times) {
                if (time > currentTime) {
                    const diff = this.getTimeDiff(currentTime, time);
                    if (diff < nextTimeDiff) {
                        nextTimeDiff = diff;
                        nextMed = { medication: med, time };
                    }
                }
            }
        }

        return nextMed;
    }

    /**
     * 计算时间差（分钟）
     */
    private getTimeDiff(time1: string, time2: string): number {
        const [h1, m1] = time1.split(':').map(Number);
        const [h2, m2] = time2.split(':').map(Number);
        return (h2 * 60 + m2) - (h1 * 60 + m1);
    }

    /**
     * 连接智能药盒
     */
    connectSmartPillbox(pillboxId: string): void {
        console.log('[Medication] 连接智能药盒:', pillboxId);
        // 模拟药盒连接
        setTimeout(() => {
            console.log('[Medication] 智能药盒已连接');
            this.notify({
                type: 'pillbox_connected',
                medication: this.medications[0], // 示例
                scheduledTime: '',
                timestamp: new Date()
            } as any);
        }, 1000);
    }

    /**
     * 处理智能药盒事件
     */
    handlePillboxEvent(event: { type: 'open' | 'close' | 'taken', medicationId: string }): void {
        console.log('[Medication] 收到药盒事件:', event);
        if (event.type === 'taken') {
            this.confirmTaken(event.medicationId);
        }
    }

    /**
     * 模拟服药提醒（演示用）
     */
    simulateReminder(): void {
        const med = this.medications[0];
        if (med) {
            this.triggerReminder(med, new Date().toTimeString().slice(0, 5));
        }
    }

    /**
     * 模拟打开药盒
     */
    simulateBoxOpen(): void {
        console.log('[Medication] 模拟打开药盒');
        // 语音反馈
        VoiceService.speak("您打开了药盒，是准备服药吗？").catch(console.error);

        this.notify({
            type: 'box_open',
            medication: this.medications[0],
            scheduledTime: new Date().toTimeString().slice(0, 5),
            timestamp: new Date()
        });
    }

    /**
     * 模拟取药
     */
    simulatePillTaken(medId?: string): void {
        const med = medId ? this.medications.find(m => m.id === medId) : this.medications[0];
        if (med) {
            console.log('[Medication] 模拟取走药物:', med.name);
            this.confirmTaken(med.id);
        }
    }
}

// 单例导出
export const medicationService = new MedicationService();
