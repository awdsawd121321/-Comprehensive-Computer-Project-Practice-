import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import dotenv from 'dotenv';

import { DataClient, DataClientError } from './dataClient.mjs';

const execFile = promisify(execFileCallback);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const PORT = Number(process.env.EMOBIT_BRIDGE_PORT || 4318);
const HOST = process.env.EMOBIT_BRIDGE_HOST || '0.0.0.0';
const TOKEN = process.env.EMOBIT_BRIDGE_TOKEN || '';
const DEFAULT_ELDER_ID = process.env.EMOBIT_ELDER_ID || 'elder_demo';
const OPENCLAW_GATEWAY_URL = (process.env.OPENCLAW_GATEWAY_URL || '').replace(/\/$/, '');
const OPENCLAW_AGENT_ID = process.env.OPENCLAW_AGENT_ID || '';
const OPENCLAW_WEBHOOK_TOKEN = process.env.OPENCLAW_WEBHOOK_TOKEN || '';
const DEFAULT_GUARDIAN_CHANNEL = process.env.EMOBIT_GUARDIAN_CHANNEL || 'feishu';
const DEFAULT_GUARDIAN_TARGETS = splitCsv(process.env.EMOBIT_GUARDIAN_TARGETS || '')
    .map((target) => normalizeTarget(DEFAULT_GUARDIAN_CHANNEL, target))
    .filter(Boolean);
const DEFAULT_ELDER_CHANNEL = process.env.EMOBIT_ELDER_CHANNEL || DEFAULT_GUARDIAN_CHANNEL;
const DEFAULT_ELDER_TARGET = normalizeTarget(DEFAULT_ELDER_CHANNEL, process.env.EMOBIT_ELDER_TARGET || '');
const DEFAULT_CALL_TO = process.env.EMOBIT_GUARDIAN_CALL_TO || '';
/** 飞书/WhatsApp 等出站消息依赖本机可执行的 openclaw CLI；未安装时请配置绝对路径，例如 /opt/homebrew/bin/openclaw */
const OPENCLAW_CLI = (process.env.OPENCLAW_CLI || 'openclaw').trim();
const HAS_EXPLICIT_GUARDIAN_CHANNEL = Boolean(String(process.env.EMOBIT_GUARDIAN_CHANNEL || '').trim());
const HAS_EXPLICIT_ELDER_CHANNEL = Boolean(String(process.env.EMOBIT_ELDER_CHANNEL || '').trim());

const MAX_EVENTS = 500;
const MAX_OUTBOUND_EVENTS = 200;
const MAX_RECENT_ITEMS = 120;
const MAX_UI_COMMANDS = 120;
const recentForwardAtByKey = new Map();

// ─── Data Client ────────────────────────────────────────────────────────────
const dataClient = new DataClient({
    defaultElderId: DEFAULT_ELDER_ID,
});

const server = http.createServer(async (req, res) => {
    try {
        setCors(res);
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        if (req.method === 'GET' && url.pathname === '/healthz') {
            const backendHealth = await dataClient.healthCheck();
            return sendJson(res, 200, {
                ok: true,
                gatewayConfigured: !!OPENCLAW_GATEWAY_URL,
                dataBackendUrl: dataClient.baseUrl,
                dataBackendOk: backendHealth.ok,
            });
        }

        if (!isAuthorized(req)) {
            return sendJson(res, 401, { ok: false, error: 'Unauthorized bridge request.' });
        }

        if (req.method === 'GET' && url.pathname === '/api/state') {
            const elderId = url.searchParams.get('elderId') || DEFAULT_ELDER_ID;
            const elder = await dataClient.getElder(elderId);
            return sendJson(res, 200, { ok: true, elderId, state: elder });
        }

        // UI commands: allow frontend to poll OpenClaw decisions/actions.
        if (req.method === 'GET' && url.pathname === '/api/ui/commands') {
            const elderId = url.searchParams.get('elderId') || DEFAULT_ELDER_ID;
            const since = Number(url.searchParams.get('since') || 0);
            const elder = await dataClient.getElder(elderId);
            const commands = (elder.uiCommands || []).filter((cmd) => {
                const ts = typeof cmd?.timestamp === 'number' ? cmd.timestamp : new Date(cmd?.timestamp || 0).getTime();
                return ts > since;
            });
            return sendJson(res, 200, { ok: true, elderId, since, commands });
        }

        if (req.method === 'POST' && url.pathname === '/api/ui/commands') {
            const body = await readJson(req);
            const elderId = body.elderId || DEFAULT_ELDER_ID;
            const command = normalizeUiCommand(body.command || body);
            const elder = await dataClient.updateSection(elderId, 'uiCommands', {
                op: 'prepend',
                item: command,
            });
            return sendJson(res, 200, { ok: true, elderId, command });
        }

        if (req.method === 'POST' && url.pathname.startsWith('/api/state/')) {
            const body = await readJson(req);
            const elderId = body.elderId || DEFAULT_ELDER_ID;
            const key = url.pathname.replace('/api/state/', '');
            const elder = await dataClient.updateSection(elderId, key, body.payload);
            return sendJson(res, 200, { ok: true, elderId, section: key, state: elder });
        }

        if (req.method === 'POST' && url.pathname === '/api/events') {
            const body = await readJson(req);
            const elderId = body.elderId || DEFAULT_ELDER_ID;
            const event = normalizeEvent(body);
            const { elder } = await dataClient.appendEvent(elderId, event);

            maybeForwardEvent(event, elderId, elder).catch((error) => {
                console.warn('[EmoBitBridge] Failed to forward event to OpenClaw:', error);
            });

            return sendJson(res, 200, { ok: true, elderId, event });
        }

        if (req.method === 'GET' && url.pathname.startsWith('/api/context/')) {
            const elderId = url.searchParams.get('elderId') || DEFAULT_ELDER_ID;
            const elder = await dataClient.getElder(elderId);
            const contextType = url.pathname.replace('/api/context/', '');
            const context = buildContext(contextType, elder);
            if (!context) {
                return sendJson(res, 404, { ok: false, error: `Unknown context type: ${contextType}` });
            }
            return sendJson(res, 200, { ok: true, elderId, contextType, context });
        }

        if (req.method === 'POST' && url.pathname === '/api/outbound/notify-guardians') {
            const body = await readJson(req);
            const elderId = body.elderId || DEFAULT_ELDER_ID;
            const elder = await dataClient.getElder(elderId);
            const channel = normalizeChannel(body.channel || resolveGuardianChannel(elder), 'guardian');
            const targets = resolveGuardianTargets(elder, body.targets, channel);
            const metadata = {
                purpose: body.purpose || 'general',
                ...serialize(body.metadata || {}),
            };
            const throttle = shouldSkipGuardianNotification(elder, {
                purpose: metadata.purpose,
                metadata,
            });
            if (throttle?.skipped) {
                return sendJson(res, 200, {
                    ok: true,
                    skipped: true,
                    channel,
                    targets,
                    reason: throttle.reason,
                    cooldownMinutes: throttle.minutes,
                    dedupeKey: throttle.key,
                });
            }
            if (throttle?.key) {
                metadata.dedupeKey = throttle.key;
                metadata.cooldownMinutes = throttle.minutes;
            }
            const results = await Promise.all(targets.map((target) => sendMessage({
                channel,
                target,
                message: body.message,
            })));
            await recordOutbound(elderId, {
                audience: 'guardians',
                channel,
                targets,
                message: body.message,
                purpose: metadata.purpose,
                metadata,
                results,
            });
            return sendJson(res, 200, { ok: true, channel, targets, results });
        }

        if (req.method === 'POST' && url.pathname === '/api/outbound/notify-elder') {
            const body = await readJson(req);
            const elderId = body.elderId || DEFAULT_ELDER_ID;
            const elder = await dataClient.getElder(elderId);
            if (shouldRouteToGuardiansInstead(body.message, body.purpose, body.metadata)) {
                const guardianChannel = normalizeChannel(resolveGuardianChannel(elder), 'guardian');
                const guardianTargets = resolveGuardianTargets(elder, body.targets, guardianChannel);
                if (guardianTargets.length === 0) {
                    return sendJson(res, 400, { ok: false, error: 'Guardian-facing elder message blocked because no guardian targets are configured.' });
                }
                const metadata = {
                    ...serialize(body.metadata || {}),
                    reroutedFrom: 'notify-elder',
                };
                const throttle = shouldSkipGuardianNotification(elder, {
                    purpose: body.purpose || 'guardian_summary',
                    metadata,
                });
                if (throttle?.skipped) {
                    return sendJson(res, 200, {
                        ok: true,
                        rerouted: true,
                        skipped: true,
                        channel: guardianChannel,
                        targets: guardianTargets,
                        reason: throttle.reason,
                        cooldownMinutes: throttle.minutes,
                        dedupeKey: throttle.key,
                    });
                }
                if (throttle?.key) {
                    metadata.dedupeKey = throttle.key;
                    metadata.cooldownMinutes = throttle.minutes;
                }
                const results = await Promise.all(guardianTargets.map((target) => sendMessage({
                    channel: guardianChannel,
                    target,
                    message: body.message,
                })));
                await recordOutbound(elderId, {
                    audience: 'guardians',
                    channel: guardianChannel,
                    targets: guardianTargets,
                    message: body.message,
                    purpose: body.purpose || 'guardian_summary',
                    metadata,
                    results,
                });
                return sendJson(res, 200, {
                    ok: true,
                    rerouted: true,
                    channel: guardianChannel,
                    targets: guardianTargets,
                    results,
                });
            }
            const channel = normalizeChannel(body.channel || DEFAULT_ELDER_CHANNEL, 'elder');
            if (isUiElderChannel(channel)) {
                const result = await queueElderMessage(elderId, {
                    message: body.message,
                    purpose: body.purpose || 'general',
                    metadata: serialize(body.metadata || {}),
                });
                return sendJson(res, 200, { ok: true, channel, target: result.target, result });
            }
            const target = body.target
                ? resolveExplicitTarget(channel, body.target, resolveElderTarget(elder, channel))
                : resolveElderTarget(elder, channel);
            if (!target) {
                return sendJson(res, 400, { ok: false, error: 'No elder target configured.' });
            }
            const result = await sendMessage({
                channel,
                target,
                message: body.message,
            });
            await recordOutbound(elderId, {
                audience: 'elder',
                channel,
                targets: [target],
                message: body.message,
                purpose: body.purpose || 'general',
                metadata: serialize(body.metadata || {}),
                results: [result],
            });
            return sendJson(res, 200, { ok: true, channel, target, result });
        }

        if (req.method === 'POST' && url.pathname === '/api/outbound/voice-call') {
            const body = await readJson(req);
            const elderId = body.elderId || DEFAULT_ELDER_ID;
            const elder = await dataClient.getElder(elderId);
            const to = body.to || resolveVoiceCallTarget(elder);
            if (!to) {
                return sendJson(res, 400, { ok: false, error: 'No voice-call target configured.' });
            }
            const result = await placeVoiceCall({
                to,
                message: body.message,
                mode: body.mode || 'notify',
            });
            await recordOutbound(elderId, {
                audience: 'guardians',
                channel: 'voicecall',
                targets: [to],
                message: body.message,
                purpose: body.purpose || 'voice_call',
                metadata: serialize(body.metadata || {}),
                results: [result],
            });
            return sendJson(res, 200, { ok: true, to, result });
        }

        if (req.method === 'POST' && url.pathname === '/api/outbound/elder-action') {
            const body = await readJson(req);
            const elderId = body.elderId || DEFAULT_ELDER_ID;
            const result = await queueElderAction(elderId, {
                action: body.action,
                payload: serialize(body.payload || {}),
                purpose: body.purpose || 'family_control',
            });
            console.info(`[EmoBitBridge] Queued elder action "${body.action}" for ${elderId} (${body.purpose || 'family_control'}).`);
            return sendJson(res, 200, { ok: true, elderId, result });
        }

        sendJson(res, 404, { ok: false, error: 'Not found.' });
    } catch (error) {
        console.error('[EmoBitBridge] Request failed:', error);
        const status = error instanceof DataClientError ? error.status : 500;
        sendJson(res, status, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
});

server.listen(PORT, HOST, () => {
    console.log(`[EmoBitBridge] Listening on http://${HOST}:${PORT}`);
    console.log(`[EmoBitBridge] Data Backend: ${dataClient.baseUrl}`);
});

// ─── Outbound Recording (via Data Backend) ──────────────────────────────────

async function recordOutbound(elderId, outbound) {
    try {
        const outboundEntry = {
            ...outbound,
            timestamp: new Date().toISOString(),
        };
        await dataClient.updateSection(elderId, 'outboundEvents', {
            op: 'prepend',
            item: outboundEntry,
        });
        await dataClient.updateSection(elderId, 'uiCommands', {
            op: 'prepend',
            item: normalizeUiCommand({
                type: 'outbound.recorded',
                payload: {
                    audience: outbound.audience,
                    channel: outbound.channel,
                    targets: outbound.targets,
                    purpose: outbound.purpose,
                    message: outbound.message,
                },
            }),
        });
    } catch (error) {
        console.error('[EmoBitBridge] Failed to record outbound via Data Backend:', error);
    }
}

// ─── Elder Message / Action Queuing ─────────────────────────────────────────

async function queueElderMessage(elderId, { message, purpose = 'general', metadata = {} }) {
    if (shouldRouteToGuardiansInstead(message, purpose, metadata)) {
        return {
            channel: 'frontend',
            target: 'ui:elder-app',
            stdout: 'Skipped elderly frontend delivery because the message is guardian-facing.',
            stderr: '',
        };
    }

    const result = {
        channel: 'frontend',
        target: 'ui:elder-app',
        stdout: 'Queued for elderly frontend delivery.',
        stderr: '',
    };

    await dataClient.updateSection(elderId, 'uiCommands', {
        op: 'prepend',
        item: normalizeUiCommand({
            type: 'elder.message',
            payload: {
                message,
                purpose,
                metadata,
            },
        }),
    });

    await recordOutbound(elderId, {
        audience: 'elder',
        channel: 'frontend',
        targets: [result.target],
        message,
        purpose,
        metadata,
        results: [result],
    });

    return result;
}

async function queueElderAction(elderId, { action, payload = {}, purpose = 'family_control' }) {
    const result = {
        channel: 'frontend',
        target: 'ui:elder-app',
        stdout: 'Queued elder frontend action.',
        stderr: '',
    };

    await dataClient.updateSection(elderId, 'uiCommands', {
        op: 'prepend',
        item: normalizeUiCommand({
            type: 'elder.action',
            payload: {
                action,
                ...payload,
            },
        }),
    });

    await recordOutbound(elderId, {
        audience: 'elder',
        channel: 'frontend',
        targets: [result.target],
        message: JSON.stringify({ action, payload }),
        purpose,
        metadata: { action, ...payload },
        results: [result],
    });

    const sourceChannel = String(payload?.sourceChannel || 'unknown');
    console.info(`[EmoBitBridge] Elder action ready for frontend: ${action} <- ${sourceChannel}`);

    return result;
}

// ─── Context Builders (pure functions, unchanged) ───────────────────────────

function buildContext(type, elder) {
    switch (type) {
        case 'wandering':
            return buildWanderingContext(elder);
        case 'medication':
            return buildMedicationContext(elder);
        case 'daily-report':
            return buildDailyReportContext(elder);
        case 'sundowning':
            return buildSundowningContext(elder);
        case 'care-plan':
            return buildCarePlanContext(elder);
        case 'trends':
            return buildTrendsContext(elder);
        case 'family-control':
            return buildFamilyControlContext(elder);
        default:
            return null;
    }
}

function buildWanderingContext(elder) {
    const state = elder.wandering.state || null;
    const lastKnownLocation = state?.lastKnownLocation || null;
    const nearbyMemoryAnchors = lastKnownLocation
        ? elder.memoryAnchors
            .map((anchor) => ({
                ...anchor,
                distanceMeters: Math.round(distanceMeters(
                    { latitude: lastKnownLocation.latitude, longitude: lastKnownLocation.longitude },
                    { latitude: anchor.location.lat, longitude: anchor.location.lng },
                )),
            }))
            .sort((a, b) => a.distanceMeters - b.distanceMeters)
            .slice(0, 5)
        : [];

    return {
        profile: elder.profile,
        wanderingState: state,
        recentWanderingEvents: elder.wandering.events.slice(0, 8),
        nearbyMemoryAnchors,
        safeZones: elder.wanderingConfig.safeZones,
        homeLocation: elder.wanderingConfig.homeLocation,
        recentOutbound: filterOutboundByPurpose(elder, ['wandering']).slice(0, 6),
        escalationHints: {
            guardianNotifiedRecently: hasRecentOutbound(elder, 'wandering', ['guardians'], 15),
            voiceCallRecently: hasRecentOutbound(elder, 'wandering', ['voicecall'], 30),
        },
    };
}

function buildMedicationContext(elder) {
    const now = new Date();
    const dueItems = computeDueMedicationItems(elder, now);
    return {
        profile: elder.profile,
        medications: elder.medications,
        activeReminder: elder.activeReminder,
        dueItems,
        todayLogs: elder.medicationLogs.filter((log) => log.date === formatLocalDate(now)),
        recentMedicationEvents: elder.medicationEvents.slice(0, 10),
        recentOutbound: filterOutboundByPurpose(elder, ['medication']).slice(0, 10),
        adherence7d: computeMedicationAdherence(elder, 7),
    };
}

function buildDailyReportContext(elder) {
    const conversations = elder.cognitive.conversations.slice(0, 40);
    const positive = conversations.filter((item) => item.sentiment === 'positive').length;
    const negative = conversations.filter((item) => item.sentiment === 'negative').length;
    return {
        profile: elder.profile,
        health: elder.health,
        medication: {
            adherence7d: computeMedicationAdherence(elder, 7),
            logs7d: elder.medicationLogs.slice(0, 40),
        },
        cognitive: {
            conversationCount: conversations.length,
            positive,
            negative,
            recentConversations: conversations,
        },
        sundowning: {
            snapshot: elder.sundowning.snapshot,
            recentAlerts: elder.sundowning.alerts.slice(0, 8),
        },
        carePlan: {
            trend: elder.carePlan?.trend || null,
            upcomingItems: computeUpcomingCareItems(elder),
        },
        locationAutomation: {
            state: elder.locationAutomation.state,
            recentEvents: elder.locationAutomation.events.slice(0, 6),
        },
        recentOutbound: filterOutboundByPurpose(elder, ['daily_report']).slice(0, 4),
        reportAlreadySentToday: hasRecentOutboundSinceStartOfDay(elder, 'daily_report'),
    };
}

function buildSundowningContext(elder) {
    return {
        profile: elder.profile,
        snapshot: elder.sundowning.snapshot,
        alerts: elder.sundowning.alerts.slice(0, 10),
        interventions: elder.sundowning.interventions.slice(0, 10),
        health: elder.health,
        recentOutbound: filterOutboundByPurpose(elder, ['sundowning']).slice(0, 8),
        escalationHints: {
            guardianNotifiedRecently: hasRecentOutbound(elder, 'sundowning', ['guardians'], 15),
            voiceCallRecently: hasRecentOutbound(elder, 'sundowning', ['voicecall'], 30),
        },
    };
}

function buildCarePlanContext(elder) {
    return {
        profile: elder.profile,
        carePlan: elder.carePlan,
        upcomingItems: computeUpcomingCareItems(elder),
        recentLocationAutomation: elder.locationAutomation.events.slice(0, 6),
        recentOutbound: filterOutboundByPurpose(elder, ['care_plan', 'family_control']).slice(0, 10),
    };
}

function buildTrendsContext(elder) {
    const assessments = elder.cognitive.assessments || [];
    const lowScores = assessments.filter((item) => Number(item.score) <= Math.max(1, Number(item.maxScore || 1) / 2)).slice(0, 8);
    const recentLocation = elder.locationAutomation.events.slice(0, 8);
    const recentFace = elder.faceEvents.slice(0, 6);
    const recentAlerts = elder.sundowning.alerts.slice(0, 10);
    const peakSundowningRisk = recentAlerts.reduce((max, item) => Math.max(max, Number(item.riskScore || 0)), Number(elder.sundowning.snapshot?.riskScore || 0));
    return {
        profile: elder.profile,
        cognition: {
            conversationCount7d: elder.cognitive.conversations.slice(0, 80).length,
            assessmentCount7d: assessments.slice(0, 80).length,
            lowScoreAssessments: lowScores,
        },
        medication: {
            adherence7d: computeMedicationAdherence(elder, 7),
            recentMedicationEvents: elder.medicationEvents.slice(0, 8),
        },
        sundowning: {
            currentSnapshot: elder.sundowning.snapshot,
            peakRisk7d: peakSundowningRisk,
            recentAlerts,
        },
        carePlan: {
            trend: elder.carePlan?.trend || null,
            upcomingItems: computeUpcomingCareItems(elder),
        },
        location: {
            state: elder.locationAutomation.state,
            recentEvents: recentLocation,
        },
        faces: {
            recentEvents: recentFace,
        },
    };
}

function buildFamilyControlContext(elder) {
    const upcoming = computeUpcomingCareItems(elder);
    const mediumHighRisk = Number(elder.sundowning.snapshot?.riskScore || 0) >= 50;
    return {
        profile: elder.profile,
        actionableCards: [
            mediumHighRisk ? {
                action: 'start_breathing',
                title: '启动呼吸放松',
                reason: '黄昏风险中高，需要主动安抚。',
            } : null,
            upcoming[0] ? {
                action: 'show_care_plan',
                title: '播报今日提醒',
                reason: `下一条提醒为 ${upcoming[0].title}（${upcoming[0].time}）。`,
            } : null,
            {
                action: 'open_memory_album',
                title: '打开家庭相册',
                reason: '可用于安抚或唤起熟悉记忆。',
            },
        ].filter(Boolean),
        latestUiCommands: (elder.uiCommands || []).slice(0, 8),
        recentOutbound: filterOutboundByPurpose(elder, ['family_control']).slice(0, 8),
    };
}

// ─── Medication / Care Helpers ──────────────────────────────────────────────

function computeDueMedicationItems(elder, now) {
    const currentTime = formatLocalTime(now);
    const today = formatLocalDate(now);
    return elder.medications.flatMap((medication) => {
        const times = Array.isArray(medication.times) ? medication.times : [];
        return times
            .filter((scheduledTime) => scheduledTime <= currentTime)
            .map((scheduledTime) => {
                const taken = elder.medicationLogs.some((log) =>
                    log.medicationId === medication.id &&
                    log.scheduledTime === scheduledTime &&
                    log.date === today &&
                    log.status === 'taken'
                );
                if (taken) return null;
                const overdueMinutes = Math.max(0, diffMinutes(scheduledTime, currentTime));
                return {
                    medication,
                    scheduledTime,
                    overdueMinutes,
                    elderNotifiedRecently: hasRecentOutbound(elder, 'medication', ['elder'], 15, {
                        medicationId: medication.id,
                        scheduledTime,
                    }),
                    guardianNotifiedRecently: hasRecentOutbound(elder, 'medication', ['guardians'], 30, {
                        medicationId: medication.id,
                        scheduledTime,
                    }),
                    voiceCallRecently: hasRecentOutbound(elder, 'medication', ['voicecall'], 60, {
                        medicationId: medication.id,
                        scheduledTime,
                    }),
                };
            })
            .filter(Boolean);
    });
}

function computeUpcomingCareItems(elder) {
    const currentTime = formatLocalTime(new Date());
    const items = Array.isArray(elder.carePlan?.items) ? elder.carePlan.items : [];
    return [...items]
        .filter((item) => item?.enabled)
        .sort((a, b) => {
            const aOffset = a.time >= currentTime ? 0 : 1;
            const bOffset = b.time >= currentTime ? 0 : 1;
            if (aOffset !== bOffset) return aOffset - bOffset;
            return String(a.time || '').localeCompare(String(b.time || ''));
        })
        .slice(0, 6);
}

function computeMedicationAdherence(elder, days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffDate = formatLocalDate(cutoff);
    const relevantLogs = elder.medicationLogs.filter((log) => log.date >= cutoffDate);
    if (relevantLogs.length === 0) return 100;
    const taken = relevantLogs.filter((log) => log.status === 'taken').length;
    return Math.round((taken / relevantLogs.length) * 100);
}

// ─── Guardian Contact Resolution ────────────────────────────────────────────

function reconcileGuardianContacts(profile, existingContacts = []) {
    if (!profile?.familyMembers) return [];
    const configuredChannel = normalizeChannel(DEFAULT_GUARDIAN_CHANNEL, 'guardian');
    const existingByKey = new Map(
        (Array.isArray(existingContacts) ? existingContacts : []).map((contact) => [guardianContactKey(contact), contact]),
    );
    return profile.familyMembers
        .map((member, index) => {
            const existing = existingByKey.get(guardianContactKey(member)) || null;
            const configuredTarget = DEFAULT_GUARDIAN_TARGETS[index] || '';
            const legacyTarget = normalizeTarget(configuredChannel, existing?.target || '');
            const fallbackTarget = configuredChannel === 'feishu'
                ? ''
                : normalizeTarget(configuredChannel, member.phone || existing?.phone || '');
            const target = configuredTarget || (!isPhoneLikeTarget(legacyTarget) ? legacyTarget : '') || fallbackTarget;
            return {
                id: `${member.relation || 'guardian'}_${index + 1}`,
                name: member.name,
                relation: member.relation,
                phone: member.phone || existing?.phone,
                channel: configuredChannel,
                target,
                priority: index + 1,
            };
        })
        .filter((contact) => contact.phone || contact.target)
        .map((contact) => ({
            ...contact,
            channel: configuredChannel,
        }));
}

// ─── OpenClaw Event Forwarding ──────────────────────────────────────────────

async function maybeForwardEvent(event, elderId, elder) {
    if (!OPENCLAW_GATEWAY_URL) return;
    if (!shouldForwardEvent(event)) return;
    const forwardGate = getForwardThrottle(event);
    if (forwardGate && shouldThrottleRecentKey(recentForwardAtByKey, forwardGate.key, forwardGate.throttleMs)) {
        console.info(`[EmoBitBridge] Skipped OpenClaw wake for ${event.type}; cooldown ${forwardGate.throttleMs}ms (${forwardGate.key}).`);
        return;
    }

    const hookUrl = `${OPENCLAW_GATEWAY_URL}/hooks/agent`;
    const nickname = elder.profile?.nickname || elder.profile?.name || elderId;
    const message = buildWakeMessage(event, elderId, nickname);
    const body = {
        agentId: OPENCLAW_AGENT_ID || undefined,
        deliver: false,
        message,
    };

    await fetch(hookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(OPENCLAW_WEBHOOK_TOKEN ? { Authorization: `Bearer ${OPENCLAW_WEBHOOK_TOKEN}` } : {}),
        },
        body: JSON.stringify(body),
    });
}

function shouldForwardEvent(event) {
    if (event.type === 'wandering.wandering_start' || event.type === 'wandering.left_safe_zone') return true;
    if (event.type === 'medication.reminder' || event.type === 'medication.snooze') return true;
    if (event.type === 'sundowning.alert') return true;
    if (event.type === 'sundowning.intervention' && event.payload?.status === 'running') return true;
    if (event.type === 'simulation.fall') return true;
    if (event.type === 'care.reminder_triggered') return true;
    if (event.type === 'location.unfamiliar_stay') return true;
    if (event.type === 'face.unknown') return true;
    return false;
}

function buildWakeMessage(event, elderId, nickname) {
    switch (event.type) {
        case 'wandering.wandering_start':
        case 'wandering.left_safe_zone':
            return `[YiCompanion] ${nickname} 发生迷路/游走事件（${event.type}）。请先调用 emobit_get_wandering_context，再安抚老人、通知家属，必要时发起语音外呼。`;
        case 'medication.reminder':
        case 'medication.snooze':
            return `[YiCompanion] ${nickname} 出现用药待确认事件（${event.type}）。请调用 emobit_get_medication_context，先提醒老人，再按超时规则升级通知家属。`;
        case 'sundowning.alert':
        case 'sundowning.intervention':
            return `[YiCompanion] ${nickname} 黄昏风险升高。请调用 emobit_get_sundowning_context，优先安抚老人，并视风险等级通知家属。`;
        case 'simulation.fall':
            return `[YiCompanion] ${nickname} 触发跌倒/紧急模拟事件。请先确认是否需要通知家属，并在必要时发起语音外呼。可使用 emobit_notify_guardians / emobit_place_guardian_call，并通过 emobit_ui_command 回写 UI 告警状态。`;
        case 'care.reminder_triggered':
            return `[YiCompanion] ${nickname} 触发了一条新的照护提醒。请调用 emobit_get_care_plan_context，决定是否提醒老人、通知家属，或通过 emobit_control_elder_frontend 让数字人执行动作。`;
        case 'location.unfamiliar_stay':
            return `[YiCompanion] ${nickname} 在陌生地点停留。请先调用 emobit_get_trends_context 和 emobit_get_wandering_context，再决定是否通知家属或发起前端安抚动作。`;
        case 'face.unknown':
            return `[YiCompanion] ${nickname} 的人脸识别未匹配到熟人。请评估是否属于认知风险或异常来访，并决定是否通知家属。`;
        default:
            return `[YiCompanion] ${nickname} 收到事件 ${event.type}。请使用对应的 emobit_* 工具处理。`;
    }
}

function getForwardThrottle(event) {
    switch (event.type) {
        case 'sundowning.alert':
            return { key: 'wake:sundowning', throttleMs: 120000 };
        case 'sundowning.intervention':
            return event.payload?.status === 'running'
                ? { key: 'wake:sundowning', throttleMs: 120000 }
                : null;
        case 'medication.reminder':
        case 'medication.snooze': {
            const reminderKey = event.payload?.reminder?.medicationId || event.payload?.medicationId || event.payload?.scheduledTime || 'general';
            return { key: `wake:medication:${reminderKey}`, throttleMs: 180000 };
        }
        case 'wandering.wandering_start':
        case 'wandering.left_safe_zone':
            return { key: 'wake:wandering', throttleMs: 180000 };
        case 'care.reminder_triggered': {
            const itemKey = event.payload?.itemId || event.payload?.id || 'general';
            return { key: `wake:care:${itemKey}`, throttleMs: 180000 };
        }
        case 'location.unfamiliar_stay': {
            const locationKey = event.payload?.locationLabel || 'unknown';
            return { key: `wake:location:${locationKey}`, throttleMs: 300000 };
        }
        case 'face.unknown':
            return { key: 'wake:face:unknown', throttleMs: 300000 };
        case 'simulation.fall':
            return { key: 'wake:fall', throttleMs: 60000 };
        default:
            return null;
    }
}

// ─── OpenClaw CLI Messaging ─────────────────────────────────────────────────

async function sendMessage({ channel, target, message }) {
    const args = ['message', 'send', '--channel', channel, '--target', target, '--message', message];
    const { stdout, stderr } = await execFile(OPENCLAW_CLI, args, {
        timeout: 30000,
        env: process.env,
    });
    return {
        channel,
        target,
        stdout: stdout?.trim() || '',
        stderr: stderr?.trim() || '',
    };
}

async function placeVoiceCall({ to, message, mode = 'notify' }) {
    const args = ['voicecall', 'call', '--to', to, '--message', message, '--mode', mode];
    const { stdout, stderr } = await execFile(OPENCLAW_CLI, args, {
        timeout: 30000,
        env: process.env,
    });
    return {
        to,
        stdout: stdout?.trim() || '',
        stderr: stderr?.trim() || '',
    };
}

// ─── Throttle / Outbound Helpers ────────────────────────────────────────────

function shouldThrottleRecentKey(map, key, throttleMs) {
    if (!key || throttleMs <= 0) return false;
    const now = Date.now();
    const previousTs = map.get(key) || 0;
    if (previousTs && now - previousTs < throttleMs) {
        return true;
    }
    map.set(key, now);
    return false;
}

function getGuardianNotificationThrottle({ purpose, metadata = {} }) {
    const normalizedPurpose = String(purpose || '').trim().toLowerCase();
    if (!normalizedPurpose) return null;

    const metadataKey = String(metadata.dedupeKey || '').trim();
    const metadataMinutes = Number(metadata.dedupeMinutes || metadata.dedupeWindowMinutes || metadata.cooldownMinutes || 0);
    if (metadataKey && metadataMinutes > 0) {
        return { key: metadataKey, minutes: metadataMinutes };
    }

    if (normalizedPurpose === 'daily_report') {
        return { key: 'daily_report', minutes: 24 * 60, oncePerDay: true };
    }

    if (
        normalizedPurpose === 'sundowning_alert' ||
        normalizedPurpose === 'sundowning_update' ||
        normalizedPurpose === 'guardian_summary'
    ) {
        return { key: 'sundowning', minutes: 5 };
    }

    if (normalizedPurpose.startsWith('wandering')) {
        return {
            key: `wandering:${metadata.wanderingType || metadata.anchorId || 'general'}`,
            minutes: 15,
        };
    }

    if (normalizedPurpose.startsWith('medication')) {
        return {
            key: `medication:${metadata.medicationId || metadata.scheduledTime || 'general'}`,
            minutes: 30,
        };
    }

    if (normalizedPurpose.startsWith('care_plan') || normalizedPurpose.startsWith('care.')) {
        return {
            key: `care_plan:${metadata.itemId || metadata.id || 'general'}`,
            minutes: 10,
        };
    }

    if (normalizedPurpose.startsWith('location')) {
        return {
            key: `location:${metadata.locationLabel || 'general'}`,
            minutes: 15,
        };
    }

    if (normalizedPurpose.startsWith('guardian_')) {
        return { key: normalizedPurpose, minutes: 5 };
    }

    return null;
}

function hasRecentGuardianOutbound(elder, purpose, minutes, dedupeKey = '') {
    const threshold = Date.now() - minutes * 60 * 1000;
    const normalizedPurpose = String(purpose || '').trim();
    return elder.outboundEvents.some((event) => {
        const ts = new Date(event.timestamp).getTime();
        if (Number.isNaN(ts) || ts < threshold) return false;
        if (event.audience !== 'guardians') return false;
        if (event.purpose !== normalizedPurpose) return false;
        if (!dedupeKey) return true;
        return event.metadata?.dedupeKey === dedupeKey || !event.metadata?.dedupeKey;
    });
}

function shouldSkipGuardianNotification(elder, { purpose, metadata = {} }) {
    const throttle = getGuardianNotificationThrottle({ purpose, metadata });
    if (!throttle) return null;
    if (throttle.oncePerDay && hasRecentOutboundSinceStartOfDay(elder, purpose)) {
        return {
            ...throttle,
            skipped: true,
            reason: `Guardian notification for ${purpose} already sent today.`,
        };
    }
    if (hasRecentGuardianOutbound(elder, purpose, throttle.minutes, throttle.key)) {
        return {
            ...throttle,
            skipped: true,
            reason: `Guardian notification for ${purpose} is within cooldown (${throttle.minutes} minutes).`,
        };
    }
    return {
        ...throttle,
        skipped: false,
    };
}

function shouldRouteToGuardiansInstead(message, purpose = 'general', metadata = {}) {
    const text = String(message || '').trim();
    const normalizedPurpose = String(purpose || '').trim().toLowerCase();
    if (!text) return false;
    if (normalizedPurpose === 'guardian_message_via_elder') return true;
    if (normalizedPurpose === 'daily_report') return true;
    if (normalizedPurpose.startsWith('guardian_')) return true;
    if (metadata?.guardianOnly === true) return true;
    if (text.includes('【发送给家属】')) return true;
    if (text.includes('建议今晚安排家属陪伴') || text.includes('建议家属')) return true;
    return false;
}

// ─── Guardian / Elder Target Resolution ─────────────────────────────────────

function resolveGuardianTargets(elder, explicitTargets, channel) {
    const contacts = getEffectiveGuardianContacts(elder);
    const targets = Array.isArray(explicitTargets) && explicitTargets.length > 0
        ? explicitTargets.map((target) => normalizeTarget(channel, target)).filter(Boolean)
        : contacts
            .map((contact) => getContactTargetForChannel(contact, channel))
            .filter(Boolean);
    if (shouldPreferConfiguredTargets(channel, targets) && DEFAULT_GUARDIAN_TARGETS.length > 0) {
        return DEFAULT_GUARDIAN_TARGETS;
    }
    return targets.length > 0 ? targets : DEFAULT_GUARDIAN_TARGETS;
}

function resolveGuardianChannel(elder) {
    if (HAS_EXPLICIT_GUARDIAN_CHANNEL) {
        return normalizeChannel(DEFAULT_GUARDIAN_CHANNEL, 'guardian');
    }
    const contacts = getEffectiveGuardianContacts(elder);
    return normalizeChannel(contacts[0]?.channel || DEFAULT_GUARDIAN_CHANNEL, 'guardian');
}

function resolveElderTarget(elder, channel) {
    if (channel === 'feishu' && DEFAULT_ELDER_TARGET) {
        return DEFAULT_ELDER_TARGET;
    }
    return normalizeTarget(channel, DEFAULT_ELDER_TARGET || elder.profile?.phone || '');
}

function resolveVoiceCallTarget(elder) {
    const contacts = getEffectiveGuardianContacts(elder);
    return DEFAULT_CALL_TO || contacts.find((contact) => contact.phone)?.phone || '';
}

function normalizeChannel(channel, audience = 'guardian') {
    const normalized = String(channel || '').trim().toLowerCase();
    if (!normalized) {
        return audience === 'elder' ? DEFAULT_ELDER_CHANNEL : DEFAULT_GUARDIAN_CHANNEL;
    }
    if (normalized === 'whatsapp') {
        const configured = audience === 'elder' ? DEFAULT_ELDER_CHANNEL : DEFAULT_GUARDIAN_CHANNEL;
        if (configured && configured !== 'whatsapp') {
            return configured;
        }
    }
    if (audience === 'elder' && ['elder_speaker', 'elder-speaker', 'speaker'].includes(normalized)) {
        return DEFAULT_ELDER_CHANNEL;
    }
    if (audience === 'elder' && HAS_EXPLICIT_ELDER_CHANNEL) {
        return DEFAULT_ELDER_CHANNEL;
    }
    return normalized;
}

function normalizeTarget(channel, target) {
    const normalized = String(target || '').trim();
    if (!normalized) return '';
    if (channel === 'feishu') {
        if (normalized.startsWith('user:') || normalized.startsWith('chat:')) {
            return normalized;
        }
        if (/^oc_[a-zA-Z0-9]+$/.test(normalized)) {
            return `user:${normalized}`;
        }
    }
    return normalized;
}

function resolveExplicitTarget(channel, target, fallbackTarget = '') {
    const normalized = normalizeTarget(channel, target);
    if (!normalized) return fallbackTarget;
    if (channel === 'feishu' && isPhoneLikeTarget(normalized)) {
        return fallbackTarget || '';
    }
    return normalized;
}

function isUiElderChannel(channel) {
    return ['frontend', 'ui', 'app', 'local', 'elder-app', 'elder_app'].includes(String(channel || '').trim().toLowerCase());
}

function getEffectiveGuardianContacts(elder) {
    return reconcileGuardianContacts(elder.profile, elder.guardianContacts);
}

function getContactTargetForChannel(contact, channel) {
    const explicitTarget = normalizeTarget(channel, contact?.target || '');
    if (explicitTarget && !(channel === 'feishu' && isPhoneLikeTarget(explicitTarget))) {
        return explicitTarget;
    }
    if (channel === 'feishu') {
        return '';
    }
    return normalizeTarget(channel, contact?.phone || '');
}

function guardianContactKey(contact) {
    return [contact?.name || '', contact?.relation || '', contact?.phone || ''].join('|');
}

function shouldPreferConfiguredTargets(channel, targets) {
    if (channel !== 'feishu') return false;
    if (DEFAULT_GUARDIAN_TARGETS.length === 0) return false;
    return (targets || []).every((target) => isPhoneLikeTarget(target));
}

function isPhoneLikeTarget(target) {
    return /^\+?\d[\d\s-]{5,}$/.test(String(target || '').trim());
}

function hasRecentOutbound(elder, purpose, audiences, minutes, metadata = null) {
    const threshold = Date.now() - minutes * 60 * 1000;
    return elder.outboundEvents.some((event) => {
        const ts = new Date(event.timestamp).getTime();
        if (Number.isNaN(ts) || ts < threshold) return false;
        const matchesPurpose = event.purpose === purpose;
        const matchesAudience = audiences.includes(event.audience) || audiences.includes(event.channel);
        const matchesMeta = !metadata || Object.entries(metadata).every(([key, value]) => event.metadata?.[key] === value);
        return matchesPurpose && matchesAudience && matchesMeta;
    });
}

function hasRecentOutboundSinceStartOfDay(elder, purpose) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return elder.outboundEvents.some((event) => event.purpose === purpose && new Date(event.timestamp).getTime() >= start.getTime());
}

function filterOutboundByPurpose(elder, purposes) {
    return elder.outboundEvents.filter((event) => purposes.includes(event.purpose));
}

// ─── Event / UI Command Normalization ───────────────────────────────────────

function normalizeEvent(body) {
    return {
        type: body.type,
        severity: body.severity || 'info',
        timestamp: new Date().toISOString(),
        payload: serialize(body.payload || {}),
    };
}

function normalizeUiCommand(input) {
    const now = Date.now();
    const cmd = serialize(input || {});
    const timestamp = typeof cmd.timestamp === 'number'
        ? cmd.timestamp
        : cmd.timestamp
            ? new Date(cmd.timestamp).getTime()
            : now;
    return {
        id: cmd.id || `ui_${now}_${Math.random().toString(36).slice(2, 8)}`,
        type: cmd.type || 'unknown',
        timestamp: Number.isFinite(timestamp) ? timestamp : now,
        payload: cmd.payload || {},
    };
}

// ─── Generic Helpers ────────────────────────────────────────────────────────

function distanceMeters(a, b) {
    const R = 6371000;
    const lat1 = a.latitude * Math.PI / 180;
    const lat2 = b.latitude * Math.PI / 180;
    const deltaLat = (b.latitude - a.latitude) * Math.PI / 180;
    const deltaLng = (b.longitude - a.longitude) * Math.PI / 180;
    const x = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) *
        Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    return R * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

function splitCsv(value) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function formatLocalDate(date) {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatLocalTime(date) {
    return `${date.getHours()}`.padStart(2, '0') + ':' + `${date.getMinutes()}`.padStart(2, '0');
}

function diffMinutes(start, end) {
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    return Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1));
}

function serialize(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-emobit-bridge-token');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function isAuthorized(req) {
    if (!TOKEN) return true;
    return req.headers['x-emobit-bridge-token'] === TOKEN;
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

async function readJson(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : {};
}
