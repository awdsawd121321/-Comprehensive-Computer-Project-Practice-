import { openclawSyncService } from './openclawSyncService';
import type { GeoPoint } from './wanderingService';

export type LocationAutomationEventType = 'left_home' | 'arrived_home' | 'unfamiliar_stay' | 'arrived_destination';

export interface LocationAutomationState {
    currentStatus: 'home' | 'away';
    currentLabel: string;
    lastDistanceMeters: number;
    unfamiliarStay: boolean;
    lastKnownLocation: GeoPoint | null;
    lastEventType?: LocationAutomationEventType | null;
}

export interface LocationAutomationEvent {
    id: string;
    type: LocationAutomationEventType;
    timestamp: string;
    locationLabel: string;
    distanceMeters: number;
    summary: string;
}

type Listener = (state: LocationAutomationState, event?: LocationAutomationEvent) => void;

const STATE_KEY = 'emobit_location_automation_state';
const EVENTS_KEY = 'emobit_location_automation_events';
const DEFAULT_HOME = { latitude: 31.2192, longitude: 121.4385, timestamp: Date.now() };

class LocationAutomationService {
    private state: LocationAutomationState;
    private events: LocationAutomationEvent[] = [];
    private listeners: Listener[] = [];

    constructor() {
        this.state = this.loadState();
        this.events = this.loadEvents();
        openclawSyncService.syncLocationAutomationState(this.state);
    }

    subscribe(listener: Listener): () => void {
        this.listeners.push(listener);
        listener(this.getState());
        return () => {
            this.listeners = this.listeners.filter((item) => item !== listener);
        };
    }

    getState(): LocationAutomationState {
        return { ...this.state, lastKnownLocation: this.state.lastKnownLocation ? { ...this.state.lastKnownLocation } : null };
    }

    getEvents(limit = 8): LocationAutomationEvent[] {
        return this.events.slice(0, limit).map((item) => ({ ...item }));
    }

    ingestPoint(point: GeoPoint, opts?: { label?: string; familiar?: boolean }): void {
        const distanceMeters = this.distance(point, DEFAULT_HOME);
        const atHome = distanceMeters <= 120;
        const currentLabel = opts?.label || (atHome ? '家中' : '外出地点');
        const previousStatus = this.state.currentStatus;

        this.state = {
            currentStatus: atHome ? 'home' : 'away',
            currentLabel,
            lastDistanceMeters: Math.round(distanceMeters),
            unfamiliarStay: !atHome && opts?.familiar === false,
            lastKnownLocation: point,
            lastEventType: this.state.lastEventType || null,
        };
        this.persist();

        if (previousStatus === 'home' && !atHome) {
            this.pushEvent('left_home', currentLabel, distanceMeters, `老人已离家，当前位于${currentLabel}。`);
        } else if (previousStatus === 'away' && atHome) {
            this.pushEvent('arrived_home', currentLabel, distanceMeters, '老人已安全到家。');
        } else if (!atHome && opts?.familiar === false) {
            this.pushEvent('unfamiliar_stay', currentLabel, distanceMeters, `老人已在陌生地点${currentLabel}停留，请家属关注。`);
        } else if (!atHome && opts?.label) {
            this.pushEvent('arrived_destination', currentLabel, distanceMeters, `老人已到达${currentLabel}。`);
        } else {
            this.notify();
        }
    }

    simulateLeaveHome(): void {
        this.ingestPoint({
            latitude: DEFAULT_HOME.latitude + 0.0021,
            longitude: DEFAULT_HOME.longitude + 0.0018,
            timestamp: Date.now(),
        }, { label: '延安西路路口', familiar: true });
    }

    simulateArrivalHome(): void {
        this.ingestPoint({
            latitude: DEFAULT_HOME.latitude + 0.0001,
            longitude: DEFAULT_HOME.longitude + 0.00008,
            timestamp: Date.now(),
        }, { label: '家中', familiar: true });
    }

    simulateUnfamiliarStay(label = '南京西路地铁站'): void {
        this.ingestPoint({
            latitude: DEFAULT_HOME.latitude + 0.0108,
            longitude: DEFAULT_HOME.longitude + 0.0095,
            timestamp: Date.now(),
        }, { label, familiar: false });
    }

    private pushEvent(type: LocationAutomationEventType, locationLabel: string, distanceMeters: number, summary: string): void {
        const event: LocationAutomationEvent = {
            id: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type,
            timestamp: new Date().toISOString(),
            locationLabel,
            distanceMeters: Math.round(distanceMeters),
            summary,
        };
        this.state.lastEventType = type;
        this.events = [event, ...this.events].slice(0, 60);
        this.persist();
        openclawSyncService.syncLocationAutomationEvent(event);
        this.notify(event);
    }

    private notify(event?: LocationAutomationEvent): void {
        const snapshot = this.getState();
        this.listeners.forEach((listener) => listener(snapshot, event));
    }

    private persist(): void {
        localStorage.setItem(STATE_KEY, JSON.stringify(this.state));
        localStorage.setItem(EVENTS_KEY, JSON.stringify(this.events));
        openclawSyncService.syncLocationAutomationState(this.state);
    }

    private loadState(): LocationAutomationState {
        try {
            const raw = localStorage.getItem(STATE_KEY);
            if (raw) return JSON.parse(raw);
        } catch {
            // ignore
        }
        return {
            currentStatus: 'home',
            currentLabel: '家中',
            lastDistanceMeters: 0,
            unfamiliarStay: false,
            lastKnownLocation: DEFAULT_HOME,
            lastEventType: null,
        };
    }

    private loadEvents(): LocationAutomationEvent[] {
        try {
            const raw = localStorage.getItem(EVENTS_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    private distance(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
        const r = 6371000;
        const lat1 = a.latitude * Math.PI / 180;
        const lat2 = b.latitude * Math.PI / 180;
        const deltaLat = (b.latitude - a.latitude) * Math.PI / 180;
        const deltaLng = (b.longitude - a.longitude) * Math.PI / 180;
        const x = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
        return r * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
    }
}

export const locationAutomationService = new LocationAutomationService();
