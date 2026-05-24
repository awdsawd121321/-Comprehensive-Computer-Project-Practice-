import { VoiceService } from './api';
import { openclawSyncService } from './openclawSyncService';

export type CarePlanType = 'medication' | 'hydration' | 'sleep' | 'appointment' | 'followup';
export type CarePlanRecurrence = 'daily' | 'once';
export type CarePlanActor = 'voice' | 'guardian' | 'system';
export type CarePlanEventType = 'created' | 'updated' | 'reminder_triggered' | 'completed' | 'snoozed' | 'dismissed';

export interface CarePlanItem {
    id: string;
    type: CarePlanType;
    title: string;
    time: string;
    recurrence: CarePlanRecurrence;
    enabled: boolean;
    createdBy: CarePlanActor;
    location?: string;
    dosage?: string;
    medicationName?: string;
    instructions?: string;
    sourceText?: string;
    createdAt: string;
    updatedAt: string;
    lastTriggeredAt?: string | null;
    lastCompletedAt?: string | null;
}

export interface CarePlanEvent {
    id: string;
    type: CarePlanEventType;
    itemId: string;
    item: CarePlanItem;
    timestamp: string;
    note?: string;
    sourceText?: string;
}

export interface CareTrendSummary {
    days: number;
    completionRate: number;
    triggeredCount: number;
    completedCount: number;
    missedCount: number;
}

export interface CarePlanState {
    items: CarePlanItem[];
    events: CarePlanEvent[];
    trend?: CareTrendSummary;
}

interface VoicePlanResult {
    item: CarePlanItem;
    reply: string;
}

type CarePlanListener = (state: CarePlanState) => void;

const ITEMS_KEY = 'emobit_care_plan_items';
const EVENTS_KEY = 'emobit_care_plan_events';
const MAX_EVENTS = 240;

class CarePlanService {
    private items: CarePlanItem[] = [];
    private events: CarePlanEvent[] = [];
    private listeners: CarePlanListener[] = [];
    private timer: ReturnType<typeof setInterval> | null = null;
    private lastTick = '';

    constructor() {
        this.load();
        this.syncAll();
        this.startMonitoring();
    }

    subscribe(listener: CarePlanListener): () => void {
        this.listeners.push(listener);
        listener(this.getState());
        return () => {
            this.listeners = this.listeners.filter((item) => item !== listener);
        };
    }

    getState(): CarePlanState {
        return {
            items: this.getItems(),
            events: this.getEvents(),
            trend: this.getTrend(),
        };
    }

    getItems(): CarePlanItem[] {
        return [...this.items].sort((a, b) => a.time.localeCompare(b.time));
    }

    getEvents(limit = 20): CarePlanEvent[] {
        return this.events.slice(0, limit).map((item) => ({ ...item }));
    }

    getUpcomingItems(limit = 4): CarePlanItem[] {
        const now = this.getNowTime();
        const future = this.items
            .filter((item) => item.enabled && item.time >= now)
            .sort((a, b) => a.time.localeCompare(b.time));
        const fallback = this.items
            .filter((item) => item.enabled && item.time < now)
            .sort((a, b) => a.time.localeCompare(b.time));
        return [...future, ...fallback].slice(0, limit);
    }

    getTrend(days = 7): CareTrendSummary {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const relevant = this.events.filter((event) => new Date(event.timestamp).getTime() >= cutoff.getTime());
        const triggeredCount = relevant.filter((event) => event.type === 'reminder_triggered').length;
        const completedCount = relevant.filter((event) => event.type === 'completed').length;
        const snoozedCount = relevant.filter((event) => event.type === 'snoozed').length;
        const base = Math.max(1, triggeredCount);
        const completionRate = Math.round((completedCount / base) * 100);
        return {
            days,
            completionRate,
            triggeredCount,
            completedCount,
            missedCount: Math.max(0, triggeredCount - completedCount - Math.min(snoozedCount, triggeredCount)),
        };
    }

    addItem(input: Omit<CarePlanItem, 'id' | 'createdAt' | 'updatedAt'>): CarePlanItem {
        const now = new Date().toISOString();
        const item: CarePlanItem = {
            ...input,
            id: `care_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            createdAt: now,
            updatedAt: now,
        };
        this.items = prepend(item, this.items, 60);
        this.recordEvent('created', item, { sourceText: item.sourceText });
        this.save();
        return item;
    }

    updateItem(id: string, updates: Partial<CarePlanItem>): CarePlanItem | null {
        const index = this.items.findIndex((item) => item.id === id);
        if (index < 0) return null;
        const updated: CarePlanItem = {
            ...this.items[index],
            ...updates,
            updatedAt: new Date().toISOString(),
        };
        this.items[index] = updated;
        this.recordEvent('updated', updated);
        this.save();
        return updated;
    }

    completeItem(id: string, note?: string): CarePlanItem | null {
        const item = this.items.find((entry) => entry.id === id);
        if (!item) return null;
        const updated = this.updateItem(id, {
            lastCompletedAt: new Date().toISOString(),
            lastTriggeredAt: new Date().toISOString(),
        });
        if (!updated) return null;
        this.recordEvent('completed', updated, { note });
        VoiceService.speak(this.buildCompletionVoice(updated)).catch(() => undefined);
        this.save();
        return updated;
    }

    triggerItem(id: string, note?: string): CarePlanItem | null {
        const item = this.items.find((entry) => entry.id === id && entry.enabled);
        if (!item) return null;
        const updated = this.updateItem(id, {
            lastTriggeredAt: new Date().toISOString(),
        });
        if (!updated) return null;
        this.recordEvent('reminder_triggered', updated, { note });
        VoiceService.speak(this.buildReminderVoice(updated)).catch(() => undefined);
        this.save();
        return updated;
    }

    createFromVoice(text: string): VoicePlanResult | null {
        const normalized = text.trim();
        if (!normalized) return null;
        const time = this.parseTime(normalized) || '20:00';
        const recurrence: CarePlanRecurrence = /每天|每日|每晚|每早|每周/.test(normalized) ? 'daily' : 'once';

        if (/(药|服用|吃.+片|吃.+粒)/.test(normalized)) {
            const medicationName = this.extractMedicationName(normalized) || '未命名药物';
            const dosage = this.extractDosage(normalized) || '按医嘱服用';
            const location = this.extractLocation(normalized);
            const instructions = this.extractMedicationInstructions(normalized);
            const item = this.addItem({
                type: 'medication',
                title: `${medicationName} 用药提醒`,
                time,
                recurrence,
                enabled: true,
                createdBy: 'voice',
                medicationName,
                dosage,
                location,
                instructions,
                sourceText: normalized,
                lastCompletedAt: null,
                lastTriggeredAt: null,
            });
            return {
                item,
                reply: `已经记下了。${time}${location ? `在${location}` : ''}提醒您服用${medicationName}，剂量是${dosage}。`,
            };
        }

        if (/(复诊|门诊|医院|检查)/.test(normalized)) {
            const location = this.extractLocation(normalized) || this.extractHospital(normalized) || '医院';
            const item = this.addItem({
                type: 'followup',
                title: `${location} 复诊提醒`,
                time,
                recurrence,
                enabled: true,
                createdBy: 'voice',
                location,
                sourceText: normalized,
                instructions: '提前准备医保卡和病历',
                lastCompletedAt: null,
                lastTriggeredAt: null,
            });
            return {
                item,
                reply: `好的，我会在${time}提醒您去${location}复诊。`,
            };
        }

        if (/(喝水|喝点水|补水)/.test(normalized)) {
            const item = this.addItem({
                type: 'hydration',
                title: '喝水提醒',
                time,
                recurrence,
                enabled: true,
                createdBy: 'voice',
                sourceText: normalized,
                instructions: '建议喝一杯温水',
                lastCompletedAt: null,
                lastTriggeredAt: null,
            });
            return {
                item,
                reply: `已经设置好喝水提醒，我会在${time}提醒您补水。`,
            };
        }

        if (/(睡觉|休息|睡眠|午休)/.test(normalized)) {
            const item = this.addItem({
                type: 'sleep',
                title: '睡眠提醒',
                time,
                recurrence,
                enabled: true,
                createdBy: 'voice',
                sourceText: normalized,
                instructions: '睡前减少屏幕刺激，准备温水',
                lastCompletedAt: null,
                lastTriggeredAt: null,
            });
            return {
                item,
                reply: `好的，我会在${time}提醒您休息。`,
            };
        }

        if (/(提醒|日程|安排)/.test(normalized)) {
            const item = this.addItem({
                type: 'appointment',
                title: '日程提醒',
                time,
                recurrence,
                enabled: true,
                createdBy: 'voice',
                location: this.extractLocation(normalized),
                sourceText: normalized,
                lastCompletedAt: null,
                lastTriggeredAt: null,
            });
            return {
                item,
                reply: `已经为您记下日程，我会在${time}提醒您。`,
            };
        }

        return null;
    }

    simulateVoicePlan(kind: 'medication' | 'hydration' | 'sleep' | 'followup'): VoicePlanResult {
        const samples = {
            medication: '每天晚上8点在餐桌旁吃二甲双胍500mg一片，饭后服用',
            hydration: '每天下午3点提醒我喝水',
            sleep: '每天晚上9点半提醒我睡觉',
            followup: '明天上午9点去静安区中心医院复诊',
        } satisfies Record<'medication' | 'hydration' | 'sleep' | 'followup', string>;
        return this.createFromVoice(samples[kind])!;
    }

    startMonitoring(): void {
        if (this.timer) return;
        this.timer = setInterval(() => this.checkDueItems(), 30000);
        this.checkDueItems();
    }

    stopMonitoring(): void {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
    }

    private checkDueItems(): void {
        const now = this.getNowTime();
        if (this.lastTick === now) return;
        this.lastTick = now;
        this.items
            .filter((item) => item.enabled && item.time === now && !this.wasTriggeredToday(item))
            .forEach((item) => {
                this.triggerItem(item.id, 'scheduled');
            });
    }

    private wasTriggeredToday(item: CarePlanItem): boolean {
        if (!item.lastTriggeredAt) return false;
        const last = new Date(item.lastTriggeredAt);
        const now = new Date();
        return last.getFullYear() === now.getFullYear()
            && last.getMonth() === now.getMonth()
            && last.getDate() === now.getDate()
            && item.time === this.getNowTime(last);
    }

    private recordEvent(type: CarePlanEventType, item: CarePlanItem, extra?: { note?: string; sourceText?: string }): void {
        const event: CarePlanEvent = {
            id: `care_evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type,
            itemId: item.id,
            item,
            timestamp: new Date().toISOString(),
            note: extra?.note,
            sourceText: extra?.sourceText || item.sourceText,
        };
        this.events = prepend(event, this.events, MAX_EVENTS);
        openclawSyncService.syncCarePlanEvent(event);
    }

    private buildReminderVoice(item: CarePlanItem): string {
        switch (item.type) {
            case 'medication':
                return `张爷爷，现在是${item.time}，该服用${item.medicationName || item.title}了。${item.dosage || ''}${item.instructions ? `，${item.instructions}` : ''}`;
            case 'hydration':
                return `张爷爷，现在是${item.time}，记得喝点温水。`;
            case 'sleep':
                return `张爷爷，现在快到${item.time}了，建议准备休息。`;
            case 'followup':
                return `张爷爷，${item.time}要去${item.location || '医院'}复诊，我会陪您一起记着。`;
            default:
                return `张爷爷，${item.time}有一条新的提醒：${item.title}。`;
        }
    }

    private buildCompletionVoice(item: CarePlanItem): string {
        switch (item.type) {
            case 'medication':
                return '好的，已经帮您记下这次服药。';
            case 'hydration':
                return '好的，已经记下您喝过水了。';
            default:
                return `好的，${item.title}已经完成。`;
        }
    }

    private extractMedicationName(text: string): string | null {
        const direct = text.match(/(?:吃|服用)([^，。,\s]+?)(?:\d+(?:mg|g|ml)|一片|半片|两片|一粒|半粒|$)/);
        if (direct?.[1]) return direct[1];
        const generic = text.match(/([\u4e00-\u9fa5A-Za-z0-9]+)(?:片|粒|胶囊)/);
        return generic?.[1] || null;
    }

    private extractDosage(text: string): string | null {
        const match = text.match(/(\d+(?:\.\d+)?(?:mg|g|ml)[^，。,\s]*|[半一二两三四五六七八九十\d]+(?:片|粒|袋|支))/);
        return match?.[1] || null;
    }

    private extractLocation(text: string): string | undefined {
        const match = text.match(/(?:在|去)([^，。,\s]{2,20})(?:吃药|服药|复诊|提醒|检查|睡觉|喝水|$)/);
        return match?.[1];
    }

    private extractHospital(text: string): string | undefined {
        const match = text.match(/([^，。,\s]{2,24}(?:医院|门诊|卫生院))/);
        return match?.[1];
    }

    private extractMedicationInstructions(text: string): string | undefined {
        const chunks = ['饭后服用', '饭前服用', '随餐服用', '睡前服用', '空腹服用'];
        return chunks.find((chunk) => text.includes(chunk));
    }

    private parseTime(text: string): string | null {
        const match = text.match(/(早上|上午|中午|下午|晚上|凌晨)?\s*(\d{1,2})\s*点(?:\s*(\d{1,2})\s*分?)?/);
        if (!match) return null;
        let hour = Number(match[2]);
        const minute = Number(match[3] || 0);
        const prefix = match[1] || '';
        if ((prefix === '下午' || prefix === '晚上') && hour < 12) hour += 12;
        if (prefix === '凌晨' && hour === 12) hour = 0;
        if (prefix === '中午' && hour < 11) hour += 12;
        return `${String(Math.min(hour, 23)).padStart(2, '0')}:${String(Math.min(minute, 59)).padStart(2, '0')}`;
    }

    private load(): void {
        try {
            const itemText = localStorage.getItem(ITEMS_KEY);
            const eventText = localStorage.getItem(EVENTS_KEY);
            this.items = itemText ? JSON.parse(itemText) : this.buildDefaults();
            this.events = eventText ? JSON.parse(eventText) : [];
        } catch {
            this.items = this.buildDefaults();
            this.events = [];
        }
    }

    private save(): void {
        localStorage.setItem(ITEMS_KEY, JSON.stringify(this.items));
        localStorage.setItem(EVENTS_KEY, JSON.stringify(this.events));
        this.syncAll();
    }

    private syncAll(): void {
        const state = this.getState();
        openclawSyncService.syncCarePlanState(state.items, state.events, state.trend);
        this.listeners.forEach((listener) => listener(state));
    }

    private buildDefaults(): CarePlanItem[] {
        const now = new Date().toISOString();
        return [
            {
                id: 'care_default_water',
                type: 'hydration',
                title: '下午喝水提醒',
                time: '15:00',
                recurrence: 'daily',
                enabled: true,
                createdBy: 'system',
                instructions: '建议喝一杯温水',
                createdAt: now,
                updatedAt: now,
                lastCompletedAt: null,
                lastTriggeredAt: null,
            },
            {
                id: 'care_default_sleep',
                type: 'sleep',
                title: '晚间休息提醒',
                time: '21:00',
                recurrence: 'daily',
                enabled: true,
                createdBy: 'system',
                instructions: '睡前可以做两分钟呼吸放松',
                createdAt: now,
                updatedAt: now,
                lastCompletedAt: null,
                lastTriggeredAt: null,
            },
        ];
    }

    private getNowTime(date = new Date()): string {
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
}

function prepend<T>(value: T, list: T[], limit: number): T[] {
    return [value, ...list.filter((item) => ('id' in (item as object) ? (item as { id?: string }).id !== (value as { id?: string }).id : true))].slice(0, limit);
}

export const carePlanService = new CarePlanService();
