// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { OpenClawActionService } from '@/services/openclawActionService';
import { OpenClawSyncService } from '@/services/openclawSyncService';
import { bridgeRequestLog } from '@/src/test/msw/handlers';

describe('system/openclaw sync+action via msw', () => {
  it('posts event envelope with token header', async () => {
    const svc = new OpenClawSyncService({
      enabled: true,
      baseUrl: 'http://127.0.0.1:4318',
      token: 'demo-token',
      elderId: 'elder_demo',
    });

    svc.emitScenarioSignal('simulation.fall', { gForce: 3.2, posture: 'lying' }, 'critical');

    await vi.waitFor(() => {
      expect(bridgeRequestLog.length).toBe(1);
    });

    const req = bridgeRequestLog[0]!;
    expect(req.url).toBe('http://127.0.0.1:4318/api/events');
    expect(req.method).toBe('POST');
    expect(req.headers['x-emobit-bridge-token']).toBe('demo-token');
    expect(req.body).toMatchObject({
      elderId: 'elder_demo',
      type: 'simulation.fall',
      severity: 'critical',
      payload: { gForce: 3.2, posture: 'lying' },
    });
  });

  it('dedupes identical state payloads within throttle window', async () => {
    const svc = new OpenClawSyncService({
      enabled: true,
      baseUrl: 'http://127.0.0.1:4318',
      token: 'demo-token',
      elderId: 'elder_demo',
    });

    svc.syncHealthMetrics(
      {
        heartRate: 80,
        bloodOxygen: 98,
        sleepHours: 7,
        steps: 1000,
        bloodPressure: { systolic: 120, diastolic: 80 },
        temperature: 36.6,
      },
      [],
    );
    svc.syncHealthMetrics(
      {
        heartRate: 80,
        bloodOxygen: 98,
        sleepHours: 7,
        steps: 1000,
        bloodPressure: { systolic: 120, diastolic: 80 },
        temperature: 36.6,
      },
      [],
    );

    await vi.waitFor(() => {
      expect(bridgeRequestLog.length).toBe(1);
    });

    expect(bridgeRequestLog[0]!.url).toBe('http://127.0.0.1:4318/api/state/health');
  });

  it('posts notify-guardians request with defaults', async () => {
    const svc = new OpenClawActionService({
      baseUrl: 'http://127.0.0.1:4318',
      token: 'demo-token',
      elderId: 'elder_demo',
    });

    const res = await svc.notifyGuardians({
      message: '【测试】notify-guardians',
      purpose: 'test',
    });

    expect(res).toMatchObject({ ok: true });
    expect(bridgeRequestLog.length).toBe(1);
    expect(bridgeRequestLog[0]!.url).toBe('http://127.0.0.1:4318/api/outbound/notify-guardians');
    expect(bridgeRequestLog[0]!.headers['x-emobit-bridge-token']).toBe('demo-token');
    expect(bridgeRequestLog[0]!.body).toMatchObject({
      elderId: 'elder_demo',
      message: '【测试】notify-guardians',
      purpose: 'test',
    });
  });
});

