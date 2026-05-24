const MAX_EVENTS = 500;
const MAX_OUTBOUND_EVENTS = 200;
const MAX_RECENT_ITEMS = 120;
const MAX_UI_COMMANDS = 120;

export {
    MAX_EVENTS,
    MAX_OUTBOUND_EVENTS,
    MAX_RECENT_ITEMS,
    MAX_UI_COMMANDS,
};

export function defaultElderState(now = new Date().toISOString()) {
    return {
        version: 1,
        updatedAt: now,
        profile: null,
        guardianContacts: [],
        memoryAnchors: [],
        memoryEvents: [],
        wanderingConfig: {
            homeLocation: null,
            safeZones: [],
        },
        wandering: {
            state: null,
            events: [],
        },
        medications: [],
        medicationLogs: [],
        medicationEvents: [],
        activeReminder: null,
        health: {
            metrics: null,
            alerts: [],
        },
        cognitive: {
            conversations: [],
            assessments: [],
            reports: [],
        },
        carePlan: {
            items: [],
            events: [],
            trend: null,
        },
        locationAutomation: {
            state: null,
            events: [],
        },
        faces: [],
        faceEvents: [],
        timeAlbum: [],
        sundowning: {
            snapshot: null,
            alerts: [],
            interventions: [],
        },
        events: [],
        outbound: [],
        outboundEvents: [],
        uiCommands: [],
    };
}

export function ensureElderShape(input) {
    const elder = isObject(input) ? input : {};
    const defaults = defaultElderState();

    for (const [key, value] of Object.entries(defaults)) {
        if (!(key in elder) || elder[key] == null) {
            elder[key] = cloneValue(value);
        }
    }

    if (!elder.updatedAt || Number.isNaN(new Date(elder.updatedAt).getTime())) {
        elder.updatedAt = new Date().toISOString();
    }

    ensureArrayField(elder, 'guardianContacts');
    ensureArrayField(elder, 'memoryAnchors');
    ensureArrayField(elder, 'memoryEvents');
    ensureArrayField(elder, 'medications');
    ensureArrayField(elder, 'medicationLogs');
    ensureArrayField(elder, 'medicationEvents');
    ensureArrayField(elder, 'faces');
    ensureArrayField(elder, 'faceEvents');
    ensureArrayField(elder, 'timeAlbum');
    ensureArrayField(elder, 'events');
    ensureArrayField(elder, 'uiCommands');
    ensureArrayField(elder, 'outbound');
    ensureArrayField(elder, 'outboundEvents');

    if (!isObject(elder.health)) {
        elder.health = cloneValue(defaults.health);
    } else {
        if (!('metrics' in elder.health)) elder.health.metrics = null;
        ensureArrayField(elder.health, 'alerts');
    }

    if (!isObject(elder.cognitive)) {
        elder.cognitive = cloneValue(defaults.cognitive);
    } else {
        ensureArrayField(elder.cognitive, 'conversations');
        ensureArrayField(elder.cognitive, 'assessments');
        ensureArrayField(elder.cognitive, 'reports');
    }

    if (!isObject(elder.carePlan)) {
        elder.carePlan = cloneValue(defaults.carePlan);
    } else {
        ensureArrayField(elder.carePlan, 'items');
        ensureArrayField(elder.carePlan, 'events');
        if (!('trend' in elder.carePlan)) elder.carePlan.trend = null;
    }

    if (!isObject(elder.wanderingConfig)) {
        elder.wanderingConfig = cloneValue(defaults.wanderingConfig);
    } else {
        if (!('homeLocation' in elder.wanderingConfig)) elder.wanderingConfig.homeLocation = null;
        ensureArrayField(elder.wanderingConfig, 'safeZones');
    }

    if (!isObject(elder.wandering)) {
        elder.wandering = cloneValue(defaults.wandering);
    } else {
        if (!('state' in elder.wandering)) elder.wandering.state = null;
        ensureArrayField(elder.wandering, 'events');
    }

    if (!isObject(elder.locationAutomation)) {
        elder.locationAutomation = cloneValue(defaults.locationAutomation);
    } else {
        if (!('state' in elder.locationAutomation)) elder.locationAutomation.state = null;
        ensureArrayField(elder.locationAutomation, 'events');
    }

    if (!isObject(elder.sundowning)) {
        elder.sundowning = cloneValue(defaults.sundowning);
    } else {
        if (!('snapshot' in elder.sundowning)) elder.sundowning.snapshot = null;
        ensureArrayField(elder.sundowning, 'alerts');
        ensureArrayField(elder.sundowning, 'interventions');
    }

    syncOutboundCollections(elder);
    elder.uiCommands = elder.uiCommands.map((command) => normalizeUiCommand(command));
    return elder;
}

export function applyStateUpdate(elder, key, payload) {
    const normalizedKey = normalizeStateKey(key);
    switch (normalizedKey) {
        case 'profile':
            elder.profile = serialize(resolvePayloadValue(payload));
            return;
        case 'guardiancontacts':
            elder.guardianContacts = toLimitedArray(resolvePayloadValue(payload), MAX_RECENT_ITEMS);
            return;
        case 'memoryanchors':
            elder.memoryAnchors = toLimitedArray(resolvePayloadValue(payload), MAX_RECENT_ITEMS);
            return;
        case 'memoryevents':
            elder.memoryEvents = toLimitedArray(resolvePayloadValue(payload), MAX_EVENTS);
            return;
        case 'medications':
            elder.medications = toLimitedArray(resolvePayloadValue(payload), MAX_RECENT_ITEMS);
            return;
        case 'medicationlogs':
            elder.medicationLogs = toLimitedArray(resolvePayloadValue(payload), MAX_EVENTS);
            return;
        case 'medicationevents':
            elder.medicationEvents = toLimitedArray(resolvePayloadValue(payload), MAX_EVENTS);
            return;
        case 'activereminder':
            elder.activeReminder = serialize(resolvePayloadValue(payload));
            return;
        case 'health':
            applyHealthUpdate(elder, resolvePayloadValue(payload));
            return;
        case 'cognitive':
            applyCognitiveUpdate(elder, resolvePayloadValue(payload));
            return;
        case 'careplan':
            applyCarePlanUpdate(elder, resolvePayloadValue(payload));
            return;
        case 'locationautomation':
            applyLocationAutomationUpdate(elder, resolvePayloadValue(payload));
            return;
        case 'wanderingconfig':
            elder.wanderingConfig = {
                homeLocation: resolvePayloadValue(payload)?.homeLocation || null,
                safeZones: toLimitedArray(resolvePayloadValue(payload)?.safeZones || [], 20),
            };
            return;
        case 'wandering':
            applyWanderingUpdate(elder, resolvePayloadValue(payload));
            return;
        case 'sundowning':
            applySundowningUpdate(elder, resolvePayloadValue(payload));
            return;
        case 'faces':
            elder.faces = applyCollectionUpdate(
                elder.faces,
                payload,
                MAX_RECENT_ITEMS,
            );
            return;
        case 'timealbum':
            elder.timeAlbum = applyCollectionUpdate(
                elder.timeAlbum,
                payload,
                MAX_RECENT_ITEMS,
            );
            return;
        case 'uicommands':
            elder.uiCommands = applyCollectionUpdate(
                elder.uiCommands,
                payload,
                MAX_UI_COMMANDS,
                normalizeUiCommand,
            );
            return;
        case 'outbound':
        case 'outboundevents': {
            const nextOutbound = applyCollectionUpdate(
                elder.outboundEvents,
                payload,
                MAX_OUTBOUND_EVENTS,
                normalizeOutboundEvent,
            );
            elder.outboundEvents = nextOutbound;
            elder.outbound = cloneValue(nextOutbound);
            return;
        }
        case 'events':
            elder.events = applyCollectionUpdate(
                elder.events,
                payload,
                MAX_EVENTS,
                normalizeEvent,
            );
            return;
        default:
            throw new Error(`Unsupported state section: ${key}`);
    }
}

export function ingestEvent(elder, input) {
    const event = normalizeEvent(input);
    elder.events = prependLimited(elder.events, event, MAX_EVENTS);

    if (event.type.startsWith('medication.')) {
        elder.medicationEvents = prependLimited(elder.medicationEvents, event, MAX_EVENTS);
        if (event.type === 'medication.reminder' || event.type === 'medication.snooze') {
            elder.activeReminder = event.payload?.reminder || null;
        }
        if (event.type === 'medication.taken') {
            elder.activeReminder = null;
        }
    }

    if (event.type.startsWith('wandering.')) {
        elder.wandering.events = prependLimited(elder.wandering.events, event, MAX_EVENTS);
        if (event.payload?.state) {
            elder.wandering.state = serialize(event.payload.state);
        }
    }

    if (event.type === 'cognitive.conversation') {
        elder.cognitive.conversations = prependLimited(elder.cognitive.conversations, event.payload, MAX_EVENTS);
    }

    if (event.type === 'cognitive.assessment') {
        elder.cognitive.assessments = prependLimited(elder.cognitive.assessments, event.payload, MAX_EVENTS);
    }

    if (event.type === 'cognitive.report') {
        elder.cognitive.reports = prependLimited(elder.cognitive.reports, event.payload, MAX_EVENTS);
    }

    if (event.type.startsWith('care.')) {
        elder.carePlan.events = prependLimited(
            elder.carePlan.events,
            event.payload ? { ...event.payload, eventType: event.type } : event,
            MAX_EVENTS,
        );
    }

    if (event.type.startsWith('face.')) {
        elder.faceEvents = prependLimited(
            elder.faceEvents,
            event.payload ? { ...event.payload, eventType: event.type } : event,
            MAX_EVENTS,
        );
    }

    if (event.type.startsWith('location.')) {
        elder.locationAutomation.events = prependLimited(
            elder.locationAutomation.events,
            event.payload ? { ...event.payload, eventType: event.type } : event,
            MAX_EVENTS,
        );
    }

    if (event.type === 'memory.anchor_triggered') {
        elder.memoryEvents = prependLimited(elder.memoryEvents, event, MAX_EVENTS);
    }

    if (event.type === 'sundowning.alert' && event.payload) {
        elder.sundowning.alerts = prependLimited(elder.sundowning.alerts, event.payload, 60);
    }

    if (event.type === 'sundowning.intervention' && event.payload) {
        elder.sundowning.interventions = prependLimited(elder.sundowning.interventions, event.payload, 60);
    }

    return event;
}

export function normalizeEvent(input) {
    const now = new Date().toISOString();
    const event = serialize(input || {});
    return {
        id: event.id || `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: String(event.type || 'unknown'),
        severity: normalizeSeverity(event.severity),
        timestamp: event.timestamp || now,
        payload: serialize(event.payload || {}),
        source: event.source || 'data-backend',
    };
}

export function normalizeUiCommand(input) {
    const now = Date.now();
    const command = serialize(input || {});
    const timestamp = typeof command.timestamp === 'number'
        ? command.timestamp
        : command.timestamp
            ? new Date(command.timestamp).getTime()
            : now;
    return {
        id: command.id || `ui_${now}_${Math.random().toString(36).slice(2, 8)}`,
        type: command.type || 'unknown',
        timestamp: Number.isFinite(timestamp) ? timestamp : now,
        payload: serialize(command.payload || {}),
    };
}

export function normalizeOutboundEvent(input) {
    const outbound = serialize(input || {});
    return {
        timestamp: outbound.timestamp || new Date().toISOString(),
        audience: outbound.audience || 'unknown',
        channel: outbound.channel || 'unknown',
        targets: Array.isArray(outbound.targets) ? outbound.targets.map((item) => String(item)) : [],
        message: String(outbound.message || ''),
        purpose: String(outbound.purpose || 'general'),
        metadata: serialize(outbound.metadata || {}),
        results: Array.isArray(outbound.results) ? outbound.results.map((item) => serialize(item)) : [],
    };
}

function applyHealthUpdate(elder, payload) {
    elder.health = {
        metrics: payload?.metrics ? serialize(payload.metrics) : null,
        alerts: toLimitedArray(payload?.alerts || [], 40),
    };
}

function applyCognitiveUpdate(elder, payload) {
    const source = Array.isArray(payload)
        ? { conversations: payload }
        : isObject(payload)
            ? payload
            : {};
    elder.cognitive = {
        conversations: toLimitedArray(source.conversations || [], MAX_EVENTS),
        assessments: toLimitedArray(source.assessments || [], MAX_EVENTS),
        reports: toLimitedArray(source.reports || [], MAX_EVENTS),
    };
}

function applyCarePlanUpdate(elder, payload) {
    const source = isObject(payload) ? payload : {};
    elder.carePlan = {
        items: toLimitedArray(source.items || [], MAX_RECENT_ITEMS),
        events: toLimitedArray(source.events || [], MAX_EVENTS),
        trend: source.trend ? serialize(source.trend) : null,
    };
}

function applyLocationAutomationUpdate(elder, payload) {
    const source = isObject(payload) ? payload : {};
    if ('state' in source) {
        elder.locationAutomation.state = serialize(source.state);
    } else if (!('event' in source) && !('events' in source)) {
        elder.locationAutomation.state = serialize(source);
    }

    if ('event' in source) {
        elder.locationAutomation.events = prependLimited(elder.locationAutomation.events, source.event, MAX_EVENTS);
    }

    if (Array.isArray(source.events)) {
        elder.locationAutomation.events = toLimitedArray(source.events, MAX_EVENTS);
    }
}

function applyWanderingUpdate(elder, payload) {
    const source = isObject(payload) ? payload : {};
    if ('state' in source) {
        elder.wandering.state = serialize(source.state);
    } else if (!('events' in source)) {
        elder.wandering.state = serialize(payload);
    }

    if (Array.isArray(source.events)) {
        elder.wandering.events = toLimitedArray(source.events, MAX_EVENTS);
    }
}

function applySundowningUpdate(elder, payload) {
    const source = isObject(payload) ? payload : {};
    if ('snapshot' in source) {
        elder.sundowning.snapshot = serialize(source.snapshot);
    }
    if ('alert' in source) {
        elder.sundowning.alerts = prependLimited(elder.sundowning.alerts, source.alert, 60);
    }
    if ('intervention' in source) {
        elder.sundowning.interventions = prependLimited(elder.sundowning.interventions, source.intervention, 60);
    }
    if (Array.isArray(source.alerts)) {
        elder.sundowning.alerts = toLimitedArray(source.alerts, 60);
    }
    if (Array.isArray(source.interventions)) {
        elder.sundowning.interventions = toLimitedArray(source.interventions, 60);
    }
    if (!('snapshot' in source) && !('alert' in source) && !('alerts' in source) && !('intervention' in source) && !('interventions' in source)) {
        elder.sundowning.snapshot = serialize(payload);
    }
}

function applyCollectionUpdate(current, payload, limit, normalizeItem = serialize) {
    const collection = Array.isArray(current) ? [...current] : [];

    if (Array.isArray(payload)) {
        return toLimitedArray(payload.map((item) => normalizeItem(item)), limit);
    }

    if (!isObject(payload) || !payload.op) {
        throw new Error('Collection payload must be an array or an operation envelope.');
    }

    const op = String(payload.op).trim().toLowerCase();

    switch (op) {
        case 'replace':
            return toLimitedArray(
                (Array.isArray(payload.value) ? payload.value : 'value' in payload ? [payload.value] : []).map((item) => normalizeItem(item)),
                limit,
            );
        case 'append': {
            const appended = [...collection, ...toItemList(payload).map((item) => normalizeItem(item))];
            return limit > 0 ? appended.slice(-limit) : appended;
        }
        case 'prepend':
            return toLimitedArray([...toItemList(payload).map((item) => normalizeItem(item)), ...collection], limit);
        case 'upsertbyid': {
            const next = [...collection];
            for (const item of toItemList(payload)) {
                const normalized = normalizeItem(item);
                const id = normalized?.id;
                if (!id) {
                    next.unshift(normalized);
                    continue;
                }
                const index = next.findIndex((entry) => entry?.id === id);
                if (index >= 0) {
                    next[index] = normalized;
                } else {
                    next.unshift(normalized);
                }
            }
            return toLimitedArray(next, limit);
        }
        case 'removebyid': {
            const ids = new Set((payload.ids || []).map((id) => String(id)));
            if (payload.id) ids.add(String(payload.id));
            return collection.filter((item) => !ids.has(String(item?.id)));
        }
        case 'clear':
            return [];
        default:
            throw new Error(`Unsupported collection operation: ${payload.op}`);
    }
}

function toItemList(payload) {
    if (Array.isArray(payload.items)) return payload.items;
    if ('item' in payload) return [payload.item];
    if (Array.isArray(payload.value)) return payload.value;
    if ('value' in payload) return [payload.value];
    return [];
}

function syncOutboundCollections(elder) {
    const source = elder.outboundEvents.length >= elder.outbound.length
        ? elder.outboundEvents
        : elder.outbound;
    elder.outboundEvents = toLimitedArray(source.map((item) => normalizeOutboundEvent(item)), MAX_OUTBOUND_EVENTS);
    elder.outbound = cloneValue(elder.outboundEvents);
}

function resolvePayloadValue(payload) {
    if (isObject(payload) && 'value' in payload && !('op' in payload)) {
        return payload.value;
    }
    return payload;
}

function normalizeStateKey(key) {
    return String(key || '')
        .trim()
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();
}

function normalizeSeverity(value) {
    const severity = String(value || 'info').trim().toLowerCase();
    if (['info', 'warn', 'warning', 'critical', 'error'].includes(severity)) {
        return severity === 'warning' ? 'warn' : severity;
    }
    return 'info';
}

function prependLimited(list, value, limit) {
    return toLimitedArray([serialize(value), ...(Array.isArray(list) ? list : [])], limit);
}

function toLimitedArray(value, limit) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => serialize(item))
        .slice(0, limit);
}

function ensureArrayField(target, key) {
    if (!Array.isArray(target[key])) {
        target[key] = [];
    }
}

function serialize(value) {
    if (value === undefined) return null;
    return cloneValue(value);
}

function cloneValue(value) {
    if (value === undefined) return null;
    return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
