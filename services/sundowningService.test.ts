import { describe, expect, it, vi } from 'vitest';

vi.mock('./openclawSyncService', () => {
  return {
    openclawSyncService: {
      syncSundowningSnapshot: vi.fn(),
      syncSundowningAlert: vi.fn(),
      syncSundowningIntervention: vi.fn(),
    },
  };
});

describe('services/sundowningService', () => {
  it('evaluates high risk and triggers auto intervention', async () => {
    vi.useFakeTimers();
    // use local time to match getHours() window (16:00-19:00)
    vi.setSystemTime(new Date('2026-03-19T17:30:00'));
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);

    const { SundowningService } = await import('./sundowningService');
    const { openclawSyncService } = await import('./openclawSyncService');

    const svc = new SundowningService({ enableHeartbeat: false });
    // exponential smoothing means first high signal may land at medium;
    // push a short burst to converge into high risk deterministically.
    let snapshot = svc.recordBehavior({
      confusionScore: 95,
      repeatedQuestions: 3,
      stepAnomalyScore: 90,
      agitationScore: 88,
      source: 'manual',
    });
    snapshot = svc.recordBehavior({
      confusionScore: 95,
      repeatedQuestions: 3,
      stepAnomalyScore: 90,
      agitationScore: 88,
      source: 'manual',
    });
    snapshot = svc.recordBehavior({
      confusionScore: 95,
      repeatedQuestions: 3,
      stepAnomalyScore: 90,
      agitationScore: 88,
      source: 'manual',
    });

    expect(snapshot.riskLevel).toBe('high');
    expect(svc.getActiveIntervention()?.status).toBe('running');
    expect(openclawSyncService.syncSundowningIntervention).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(18_000);
    expect(svc.getActiveIntervention()?.status).toBe('completed');
    vi.useRealTimers();
  });

  it('keeps risk score within 0..100', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:00:00.000Z'));
    const { SundowningService } = await import('./sundowningService');

    const svc = new SundowningService({ enableHeartbeat: false });
    const snapshot = svc.recordBehavior({
      confusionScore: 999,
      repeatedQuestions: 999,
      stepAnomalyScore: 999,
      agitationScore: 999,
      source: 'manual',
    });
    expect(snapshot.riskScore).toBeGreaterThanOrEqual(0);
    expect(snapshot.riskScore).toBeLessThanOrEqual(100);
    vi.useRealTimers();
  });
});

