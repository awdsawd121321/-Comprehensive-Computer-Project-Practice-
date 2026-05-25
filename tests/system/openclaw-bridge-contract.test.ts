// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { OpenClawActionService } from '@/services/openclawActionService';
import { OpenClawSyncService } from '@/services/openclawSyncService';
import { bridgeRequestLog } from '@/src/test/msw/handlers';

describe('system/openclaw bridge contract (msw)', () => {
  it('sync event then notify guardians (cross-module happy path)', async () => {
    const sync = new OpenClawSyncService({
      enabled: true,
      baseUrl: 'http://127.0.0.1:4318',
      token: 'demo-token',
      elderId: 'elder_demo',
    });
    const action = new OpenClawActionService({
      baseUrl: 'http://127.0.0.1:4318',
      token: 'demo-token',
      elderId: 'elder_demo',
    });

    sync.emitScenarioSignal('simulation.fall', { gForce: 3.1 }, 'critical');
    await action.notifyGuardians({ message: '【系统测试】跌倒通知', purpose: 'fall' });

    expect(bridgeRequestLog.length).toBe(2);
    expect(bridgeRequestLog[0]!.url).toBe('http://127.0.0.1:4318/api/events');
    expect(bridgeRequestLog[1]!.url).toBe('http://127.0.0.1:4318/api/outbound/notify-guardians');
  });
});

