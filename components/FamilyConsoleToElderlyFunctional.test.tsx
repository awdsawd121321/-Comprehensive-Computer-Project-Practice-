import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ElderlyApp from './ElderlyApp';
import { SimulationType, SystemStatus } from '../types';

type Medication = {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  times: string[];
  instructions: string;
  purpose: string;
  imageUrl?: string;
};

type MedicationEvent = {
  type: 'reminder' | 'taken' | 'missed' | 'snooze' | 'box_open' | 'pillbox_connected';
  medication: Medication;
  scheduledTime: string;
  timestamp: Date;
};

const presetMedication: Medication = {
  id: 'med_test_1',
  name: '二甲双胍',
  dosage: '500mg，1片',
  frequency: '每日2次',
  times: ['08:00', '18:00'],
  instructions: '饭后服用',
  purpose: '控制血糖',
};

let medicationSubscribers: Set<(e: MedicationEvent) => void> = new Set();
let activeReminder: { medication: Medication; scheduledTime: string } | null = null;

const triggerReminderMock = vi.fn();
const confirmTakenMock = vi.fn();

vi.mock('../services/api', () => {
  return {
    VoiceService: {
      speak: vi.fn(
        (_text: string, _voice?: string, _mode?: string, onEnded?: () => void) => {
          onEnded?.();
          return Promise.resolve();
        },
      ),
      speakSegments: vi.fn(),
      stop: vi.fn(),
      checkAvailability: vi.fn(async () => false),
      preloadClonePhrases: vi.fn(),
      checkConnection: vi.fn(async () => false),
    },
  };
});

vi.mock('../services/openclawActionService', () => {
  return {
    openclawActionService: {
      isConfigured: () => false,
      notifyGuardians: vi.fn(),
      queueElderAction: vi.fn(),
    },
  };
});

vi.mock('../services/openclawSyncService', () => {
  return {
    openclawSyncService: {
      enabled: true,
      isEnabled: () => true,
      getElderId: () => 'elder_demo',
      emitScenarioSignal: vi.fn(),
      syncProfile: vi.fn(),
      syncCarePlanState: vi.fn(),
      syncCarePlanEvent: vi.fn(),
      syncConversation: vi.fn(),
      syncCognitiveAssessment: vi.fn(),
      syncCognitiveHistory: vi.fn(),
      syncMemoryAnchors: vi.fn(),
      syncMemoryEvent: vi.fn(),
      syncMedications: vi.fn(),
      syncMedicationLogs: vi.fn(),
      syncMedicationEvent: vi.fn(),
      syncHealthMetrics: vi.fn(),
      syncLocationAutomationState: vi.fn(),
      syncLocationAutomationEvent: vi.fn(),
      syncWanderingConfig: vi.fn(),
      syncWanderingState: vi.fn(),
      syncWanderingEvent: vi.fn(),
      syncSundowningSnapshot: vi.fn(),
      syncSundowningAlert: vi.fn(),
      syncSundowningIntervention: vi.fn(),
      syncFaceEvent: vi.fn(),
    },
  };
});

vi.mock('../services/medicationService', () => {
  const subscribe = (cb: (e: MedicationEvent) => void) => {
    medicationSubscribers.add(cb);
    return () => {
      medicationSubscribers.delete(cb);
    };
  };

  const getStatistics = () => {
    return {
      totalScheduled: 1,
      totalTaken: 1,
      adherenceRate: 100,
      logs: [],
    };
  };

  const getMedications = () => [presetMedication];

  return {
    medicationService: {
      startMonitoring: vi.fn(),
      stopMonitoring: vi.fn(),
      subscribe,
      triggerReminder: (medication: Medication, scheduledTime: string) => {
        triggerReminderMock(medication, scheduledTime);
        activeReminder = { medication, scheduledTime };
        for (const handler of medicationSubscribers) {
          handler({
          type: 'reminder',
          medication,
          scheduledTime,
          timestamp: new Date(),
          });
        }
      },
      confirmTaken: (_medicationId?: string) => {
        confirmTakenMock(_medicationId);
        if (!activeReminder) return;
        const { medication, scheduledTime } = activeReminder;
        activeReminder = null;
        for (const handler of medicationSubscribers) {
          handler({
            type: 'taken',
            medication,
            scheduledTime,
            timestamp: new Date(),
          });
        }
      },
      snoozeReminder: vi.fn(),
      getActiveReminder: () => {
        if (!activeReminder) return null;
        return {
          medication: activeReminder.medication,
          scheduledTime: activeReminder.scheduledTime,
          isActive: true,
          snoozeCount: 0,
        };
      },
      getNextMedicationTime: () => {
        return { medication: presetMedication, time: '08:00' };
      },
      getMedications,
      getStatistics,
    },
  };
});

vi.mock('../services/carePlanService', () => {
  return {
    carePlanService: {
      getUpcomingItems: vi.fn(() => []),
      getTrend: vi.fn(() => ({
        days: 7,
        completionRate: 0,
        triggeredCount: 0,
        completedCount: 0,
        missedCount: 0,
      })),
      subscribe: vi.fn(() => () => {}),
      simulateVoicePlan: vi.fn((kind: 'medication' | 'hydration' | 'sleep' | 'followup') => {
        // 只覆盖本测试用例关心的 medication 文案
        if (kind === 'medication') {
          return {
            item: {
              id: 'care_test_med',
              type: 'medication',
              title: '二甲双胍 用药提醒',
              time: '20:00',
              recurrence: 'daily',
              enabled: true,
              createdBy: 'voice',
              medicationName: '二甲双胍',
              dosage: '500mg，1片',
              instructions: '饭后服用',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastTriggeredAt: null,
              lastCompletedAt: null,
            },
            reply: '已经记下了。20:00提醒您服用二甲双胍，剂量是500mg，1片。',
          };
        }

        return {
          item: {
            id: 'care_test_other',
            type: kind,
            title: 'other',
            time: '20:00',
            recurrence: 'once',
            enabled: true,
            createdBy: 'voice',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastTriggeredAt: null,
            lastCompletedAt: null,
          },
          reply: '已创建提醒。',
        };
      }),
    },
  };
});

vi.mock('../services/cognitiveService', () => {
  return {
    cognitiveService: {
      getAssessments: vi.fn(() => []),
      getTrend: vi.fn(() => ({
        dates: [],
        scores: [],
        average: 75,
        trend: 'stable',
      })),
      recordConversation: vi.fn(),
    },
  };
});

vi.mock('../services/sundowningService', () => {
  const snapshot = {
    timestamp: Date.now(),
    riskScore: 10,
    riskLevel: 'low',
    trend: 'stable',
    timeWindowWeight: 0,
    behaviorSummary: {
      confusionScore: 0,
      repeatedQuestions: 0,
      stepAnomalyScore: 0,
      agitationScore: 0,
    },
    keyFactors: [],
    recommendedInterventions: [],
  };

  return {
    sundowningService: {
      getCurrentSnapshot: () => snapshot,
      getAlerts: vi.fn(() => []),
      getActiveIntervention: vi.fn(() => null),
      subscribe: (cb: (s: typeof snapshot) => void) => {
        cb(snapshot);
        return () => {};
      },
      subscribeAlerts: () => () => {},
      subscribeInterventions: () => () => {},
      evaluateRisk: vi.fn(),
      startSimulation: vi.fn(),
      stopSimulation: vi.fn(),
      triggerIntervention: vi.fn(() => null),
      completeActiveIntervention: vi.fn(),
      recordBehavior: vi.fn(),
    },
  };
});

// 其它依赖：本测试不触发这些逻辑，但需要保证模块导入不会因缺少方法而崩溃
vi.mock('../services/memoryService', () => {
  return {
    memoryService: {
      subscribe: () => () => {},
      generateMemoryDialogue: () => 'mock',
    },
  };
});

vi.mock('../services/locationAutomationService', () => {
  return {
    locationAutomationService: {
      simulateArrivalHome: vi.fn(),
      getState: () => ({
        currentStatus: 'home',
        currentLabel: '家中',
        lastDistanceMeters: 0,
      }),
      getEvents: () => [],
      subscribe: () => () => {},
    },
  };
});

vi.mock('../services/faceService', () => {
  return {
    faceService: {
      getFaces: vi.fn(() => []),
    },
  };
});

vi.mock('../services/wanderingService', () => {
  return {
    wanderingService: {
      subscribe: () => () => {},
      getState: () => ({
        isWandering: false,
        wanderingType: 'none',
        confidence: 0,
        duration: 0,
        distanceFromHome: 0,
        outsideSafeZone: false,
      }),
      getEvents: () => [],
    },
  };
});

describe('Family console buttons (functional UI wiring)', () => {
  beforeEach(() => {
    // JSDOM does not implement scrollIntoView; ElderlyApp calls it in useEffect.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).scrollIntoView = vi.fn();

    medicationSubscribers = new Set();
    activeReminder = null;
    triggerReminderMock.mockClear();
    confirmTakenMock.mockClear();
    localStorage.clear();
  });

  it('uses family console to create medication reminder (voice build) and updates elderly message + console card', async () => {
    render(<ElderlyApp status={SystemStatus.NORMAL} simulation={SimulationType.NONE} externalMessage={null} externalAction={null} />);

    const voiceBuildBtn = screen.getByRole('button', { name: /语音建用药/ });
    fireEvent.click(voiceBuildBtn);

    // 控制台先展示「预设老人语音」
    expect(screen.getByText(/预设老人语音/)).toBeInTheDocument();

    // 语音建按钮内部约 700ms 延迟后才写入照护计划与状态
    await new Promise((r) => setTimeout(r, 800));

    // 老人端 AI 消息区域应展示 carePlanService 的回复（mock 固定）
    expect(screen.getByText((t) => typeof t === 'string' && t.includes('已经记下了。20:00'))).toBeInTheDocument();
    // 控制台应展示照护计划创建结果
    expect(screen.getByText((t) => typeof t === 'string' && t.includes('已创建：'))).toBeInTheDocument();
    expect(screen.getByText((t) => typeof t === 'string' && t.includes('二甲双胍 用药提醒'))).toBeInTheDocument();

  });

  it('uses family console to trigger medication reminder (pending) -> MedicationReminder modal', async () => {
    render(<ElderlyApp status={SystemStatus.NORMAL} simulation={SimulationType.NONE} externalMessage={null} externalAction={null} />);

    // 等待 MedicationReminder 订阅到 medicationService 事件处理器
    await waitFor(() => {
      expect(medicationSubscribers.size).toBeGreaterThan(0);
    });

    const pendingBtns = screen.getAllByRole('button', { name: /未服药提醒/ });
    fireEvent.click(pendingBtns[0]);

    expect(triggerReminderMock).toHaveBeenCalled();
    // 老人端弹层：reminder UI
    expect(await screen.findByText('该吃药啦')).toBeInTheDocument();
    expect(screen.getByText(presetMedication.name)).toBeInTheDocument();

    // 控制台操作结果
    expect(screen.getByText(/已触发未服药提醒：/)).toBeInTheDocument();

  });

  it('uses family console to confirm taken (taken) -> confirmation UI auto hides after 3s', async () => {
    render(<ElderlyApp status={SystemStatus.NORMAL} simulation={SimulationType.NONE} externalMessage={null} externalAction={null} />);

    await waitFor(() => {
      expect(medicationSubscribers.size).toBeGreaterThan(0);
    });

    // 先触发 reminder，再确认 taken（更贴近真实操作顺序）
    const pendingBtns = screen.getAllByRole('button', { name: /未服药提醒/ });
    fireEvent.click(pendingBtns[0]);
    expect((await screen.findAllByText('该吃药啦')).length).toBeGreaterThan(0);

    const takenBtns = screen.getAllByRole('button', { name: /已服药确认/ });
    fireEvent.click(takenBtns[0]);

    expect(confirmTakenMock).toHaveBeenCalled();
    // 立即出现确认界面
    expect(await screen.findByText('已记录服药')).toBeInTheDocument();

    // 3 秒后自动关闭
    await new Promise((r) => setTimeout(r, 3100));
    expect(screen.queryByText('已记录服药')).toBeNull();

    // 控制台应有“已记录服药完成”文案
    expect(screen.getByText(/已记录服药完成：/)).toBeInTheDocument();

  });
});

