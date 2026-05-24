import { describe, expect, it, vi } from 'vitest';

vi.mock('./openclawSyncService', () => {
  return {
    openclawSyncService: {
      syncHealthMetrics: vi.fn(),
    },
  };
});

describe('services/healthStateService', () => {
  it('adds critical alert when blood oxygen below critical threshold', async () => {
    const { HealthStateService } = await import('./healthStateService');
    const { openclawSyncService } = await import('./openclawSyncService');

    const svc = new HealthStateService();
    svc.updateMetrics({
      bloodOxygen: 89,
      heartRate: 72,
      sleepHours: 7,
      steps: 3000,
      bloodPressure: { systolic: 120, diastolic: 80 },
    });

    const alerts = svc.getAlertHistory();
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]!.metric).toBe('bloodOxygen');
    expect(alerts[0]!.type).toBe('critical');
    expect(openclawSyncService.syncHealthMetrics).toHaveBeenCalled();
  });
});

