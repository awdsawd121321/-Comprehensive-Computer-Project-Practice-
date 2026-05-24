import { describe, expect, it, vi } from 'vitest';
import { OpenClawSyncService } from './openclawSyncService';

describe('services/openclawSyncService', () => {
  it('does not call fetch when disabled', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const svc = new OpenClawSyncService({
      enabled: false,
      baseUrl: 'http://127.0.0.1:4318',
      token: 't',
      elderId: 'elder_demo',
    });

    svc.emitScenarioSignal('simulation.fall', { gForce: 3.2 }, 'critical');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

