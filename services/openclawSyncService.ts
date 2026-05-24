import type { ElderlyProfile } from './aiService';
import type { CarePlanEvent, CarePlanItem, CarePlanState, CareTrendSummary } from './carePlanService';
import type { CognitiveAssessmentItem, ConversationLog } from './cognitiveService';
import type { FaceData } from './faceService';
import type { Medication, MedicationEvent, MedicationLog, MedicationReminder } from './medicationService';
import type { HealthAlert, HealthMetrics } from './healthStateService';
import type { MemoryAnchor, LocationEvent } from './memoryService';
import type { LocationAutomationEvent, LocationAutomationState } from './locationAutomationService';
import type { GeoPoint, SafeZone, WanderingEvent, WanderingState } from './wanderingService';
import type {
    SundowningInterventionPlan,
    SundowningPushAlert,
    SundowningRiskSnapshot,
} from './sundowningService';
import { getOpenClawBridgeBaseUrl } from '../utils/runtimeConfig';

interface SyncEnvelope<T> {
    elderId: string;
    payload: T;
}

interface HealthSyncPayload {
    metrics: HealthMetrics;
    alerts: HealthAlert[];
}

interface WanderingConfigPayload {
    homeLocation: GeoPoint | null;
    safeZones: SafeZone[];
}

interface SundowningSyncPayload {
    snapshot?: SundowningRiskSnapshot;
    alert?: SundowningPushAlert;
    intervention?: SundowningInterventionPlan | null;
}

interface CognitiveSyncPayload {
    conversations: ConversationLog[];
    assessments: CognitiveAssessmentItem[];
}

interface FaceEventPayload {
    type: 'recognized' | 'unknown' | 'family_arrived';
    timestamp: string;
    face?: FaceData | null;
    message?: string;
}

interface LocationAutomationPayload {
    state?: LocationAutomationState;
    event?: LocationAutomationEvent;
}

interface SyncEventPayload {
    elderId: string;
    type: string;
    severity?: 'info' | 'warn' | 'critical';
    payload: Record<string, unknown>;
}

const DEFAULT_ELDER_ID = 'elder_demo';
const DEFAULT_THROTTLE_MS = 15000;

export type OpenClawSyncServiceOptions = {
    baseUrl?: string;
    token?: string;
    enabled?: boolean;
    elderId?: string;
};

export class OpenClawSyncService {
    private baseUrl: string;
    private token: string;
    private enabled: boolean;
    private elderId: string;
    private lastPayloadByKey = new Map<string, { ts: number; signature: string }>();
    private bridgeBackoffUntil = 0;
    private consecutiveFailures = 0;
    private lastFailureLogAt = 0;

    constructor(options?: OpenClawSyncServiceOptions) {
        this.baseUrl = (options?.baseUrl ?? getOpenClawBridgeBaseUrl()).replace(/\/$/, '');
        this.token = options?.token ?? import.meta.env.VITE_OPENCLAW_BRIDGE_TOKEN ?? '';
        this.elderId = options?.elderId ?? import.meta.env.VITE_OPENCLAW_ELDER_ID ?? DEFAULT_ELDER_ID;
        this.enabled = options?.enabled ?? (import.meta.env.VITE_OPENCLAW_SYNC_ENABLED === 'true' && !!this.baseUrl);
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    getElderId(): string {
        return this.elderId;
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }

    /**
     * 用于“模拟场景按钮”点击时，把整包场景数据/信号发送给 Bridge，
     * 由 Bridge webhook 唤醒 OpenClaw 进行分析与动作执行。
     */
    emitScenarioSignal(type: string, payload: Record<string, unknown>, severity: SyncEventPayload['severity'] = 'warn'): void {
        this.postEvent(type, payload, severity);
    }

    syncProfile(profile: ElderlyProfile | null | undefined): void {
        if (!profile) return;
        this.postState('/api/state/profile', profile);
    }

    syncMemoryAnchors(anchors: MemoryAnchor[]): void {
        this.postState('/api/state/memory-anchors', anchors);
    }

    syncMemoryEvent(event: LocationEvent): void {
        this.postEvent('memory.anchor_triggered', {
            anchorId: event.anchor.id,
            anchorName: event.anchor.name,
            category: event.anchor.category,
            distance: event.distance,
            timestamp: event.timestamp.toISOString(),
        });
    }

    syncMedications(medications: Medication[]): void {
        this.postState('/api/state/medications', medications);
    }

    syncMedicationLogs(logs: MedicationLog[]): void {
        this.postState('/api/state/medication-logs', logs);
    }

    syncMedicationEvent(event: MedicationEvent, activeReminder: MedicationReminder | null): void {
        this.postEvent(`medication.${event.type}`, {
            medicationId: event.medication.id,
            medicationName: event.medication.name,
            scheduledTime: event.scheduledTime,
            timestamp: event.timestamp.toISOString(),
            reminder: activeReminder
                ? {
                    medicationId: activeReminder.medication.id,
                    scheduledTime: activeReminder.scheduledTime,
                    isActive: activeReminder.isActive,
                    snoozeCount: activeReminder.snoozeCount,
                }
                : null,
        }, event.type === 'taken' ? 'info' : event.type === 'snooze' ? 'warn' : 'critical');
    }

    syncHealthMetrics(metrics: HealthMetrics, alerts: HealthAlert[]): void {
        this.postState('/api/state/health', { metrics, alerts }, {
            dedupeKey: 'health',
            throttleMs: 20000,
        });
    }

    syncCognitiveHistory(conversations: ConversationLog[], assessments: CognitiveAssessmentItem[] = []): void {
        const payload: CognitiveSyncPayload = { conversations, assessments };
        this.postState('/api/state/cognitive', payload);
    }

    syncConversation(log: ConversationLog): void {
        this.postEvent('cognitive.conversation', {
            id: log.id,
            userMessage: log.userMessage,
            aiResponse: log.aiResponse,
            sentiment: log.sentiment,
            topics: log.topics,
            timestamp: log.timestamp instanceof Date ? log.timestamp.toISOString() : new Date(log.timestamp).toISOString(),
        });
    }

    syncCognitiveAssessment(item: CognitiveAssessmentItem): void {
        this.postEvent('cognitive.assessment', {
            id: item.id,
            category: item.category,
            prompt: item.prompt,
            response: item.response,
            score: item.score,
            maxScore: item.maxScore,
            notes: item.notes,
            timestamp: item.timestamp instanceof Date ? item.timestamp.toISOString() : new Date(item.timestamp).toISOString(),
        }, item.score <= Math.max(1, item.maxScore / 2) ? 'warn' : 'info');
    }

    syncCarePlanState(items: CarePlanItem[], events: CarePlanEvent[], trend?: CareTrendSummary): void {
        const payload: CarePlanState = {
            items,
            events,
            trend,
        };
        this.postState('/api/state/care-plan', payload, {
            dedupeKey: 'care-plan',
            throttleMs: 10000,
        });
    }

    syncCarePlanEvent(event: CarePlanEvent): void {
        this.postEvent(`care.${event.type}`, {
            id: event.id,
            itemId: event.itemId,
            item: event.item,
            note: event.note,
            sourceText: event.sourceText,
            timestamp: new Date(event.timestamp).toISOString(),
        }, event.type === 'reminder_triggered' ? 'warn' : 'info');
    }

    syncFaceEvent(payload: FaceEventPayload): void {
        this.postEvent(`face.${payload.type}`, this.serialize(payload) as unknown as Record<string, unknown>, payload.type === 'unknown' ? 'warn' : 'info');
    }

    syncLocationAutomationState(state: LocationAutomationState): void {
        const payload: LocationAutomationPayload = { state };
        this.postState('/api/state/location-automation', payload, {
            dedupeKey: 'location-automation',
            throttleMs: DEFAULT_THROTTLE_MS,
        });
    }

    syncLocationAutomationEvent(event: LocationAutomationEvent): void {
        const payload: LocationAutomationPayload = { event };
        this.postState('/api/state/location-automation', payload);
        this.postEvent(`location.${event.type}`, {
            id: event.id,
            locationLabel: event.locationLabel,
            summary: event.summary,
            distanceMeters: event.distanceMeters,
            timestamp: new Date(event.timestamp).toISOString(),
        }, event.type === 'unfamiliar_stay' ? 'warn' : 'info');
    }

    syncWanderingConfig(homeLocation: GeoPoint | null, safeZones: SafeZone[]): void {
        const payload: WanderingConfigPayload = { homeLocation, safeZones };
        this.postState('/api/state/wandering-config', payload);
    }

    syncWanderingState(state: WanderingState): void {
        this.postState('/api/state/wandering', state, {
            dedupeKey: 'wandering-state',
            throttleMs: DEFAULT_THROTTLE_MS,
        });
    }

    syncWanderingEvent(event: WanderingEvent): void {
        this.postEvent(`wandering.${event.type}`, {
            timestamp: event.timestamp.toISOString(),
            state: this.serialize(event.state),
        }, event.type === 'wandering_end' || event.type === 'returned_safe' ? 'info' : 'critical');
    }

    syncSundowningSnapshot(snapshot: SundowningRiskSnapshot): void {
        const payload: SundowningSyncPayload = { snapshot };
        this.postState('/api/state/sundowning', payload, {
            dedupeKey: 'sundowning-snapshot',
            throttleMs: 20000,
        });
    }

    syncSundowningAlert(alert: SundowningPushAlert): void {
        const payload: SundowningSyncPayload = { alert };
        this.postState('/api/state/sundowning', payload);
        this.postEvent('sundowning.alert', {
            id: alert.id,
            level: alert.level,
            title: alert.title,
            message: alert.message,
            riskScore: alert.riskScore,
            timestamp: new Date(alert.timestamp).toISOString(),
        }, alert.level === 'high' ? 'critical' : 'warn');
    }

    syncSundowningIntervention(plan: SundowningInterventionPlan | null): void {
        const payload: SundowningSyncPayload = { intervention: plan };
        this.postState('/api/state/sundowning', payload);
        if (!plan) return;
        this.postEvent('sundowning.intervention', {
            id: plan.id,
            type: plan.type,
            title: plan.title,
            status: plan.status,
            source: plan.source,
            startedAt: new Date(plan.startedAt).toISOString(),
            endedAt: plan.endedAt ? new Date(plan.endedAt).toISOString() : null,
        }, plan.status === 'running' ? 'warn' : 'info');
    }

    private postState<T>(path: string, payload: T, opts?: { dedupeKey?: string; throttleMs?: number }): void {
        this.fireAndForget(path, {
            elderId: this.elderId,
            payload: this.serialize(payload),
        } satisfies SyncEnvelope<unknown>, opts);
    }

    private postEvent(type: string, payload: Record<string, unknown>, severity: SyncEventPayload['severity'] = 'info'): void {
        this.fireAndForget('/api/events', {
            elderId: this.elderId,
            type,
            severity,
            payload: this.serialize(payload),
        } satisfies SyncEventPayload);
    }

    private fireAndForget(path: string, body: unknown, opts?: { dedupeKey?: string; throttleMs?: number }): void {
        if (!this.enabled || !this.baseUrl) return;
        if (Date.now() < this.bridgeBackoffUntil) return;
        if (opts?.dedupeKey && this.shouldSkip(opts.dedupeKey, body, opts.throttleMs ?? DEFAULT_THROTTLE_MS)) {
            return;
        }

        fetch(`${this.baseUrl}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(this.token ? { 'x-emobit-bridge-token': this.token } : {}),
            },
            body: JSON.stringify(body),
        }).then(() => {
            this.consecutiveFailures = 0;
            this.bridgeBackoffUntil = 0;
        }).catch((error) => {
            this.consecutiveFailures += 1;
            const backoffMs = Math.min(30000, 2000 * (2 ** (this.consecutiveFailures - 1)));
            this.bridgeBackoffUntil = Date.now() + backoffMs;
            if (Date.now() - this.lastFailureLogAt >= 5000) {
                this.lastFailureLogAt = Date.now();
                console.warn(`[OpenClawSync] Failed to sync ${path}; backing off for ${backoffMs}ms:`, error);
            }
        });
    }

    private shouldSkip(key: string, body: unknown, throttleMs: number): boolean {
        const now = Date.now();
        const signature = JSON.stringify(body);
        const previous = this.lastPayloadByKey.get(key);
        if (previous && previous.signature === signature && now - previous.ts < throttleMs) {
            return true;
        }
        this.lastPayloadByKey.set(key, { ts: now, signature });
        return false;
    }

    private serialize<T>(value: T): T {
        return JSON.parse(JSON.stringify(value)) as T;
    }
}

export const openclawSyncService = new OpenClawSyncService();
