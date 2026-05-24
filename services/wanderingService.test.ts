import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./openclawSyncService', () => {
  return {
    openclawSyncService: {
      syncWanderingConfig: vi.fn(),
      syncWanderingState: vi.fn(),
      syncWanderingEvent: vi.fn(),
    },
  };
});

describe('services/wanderingService', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    // minimal localStorage polyfill for node env
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => void store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    } as any);
  });

  it('simulateWandering emits start then end events', async () => {
    vi.useFakeTimers();
    const { WanderingService } = await import('./wanderingService');
    const { openclawSyncService } = await import('./openclawSyncService');

    const svc = new WanderingService();
    const events: string[] = [];
    svc.subscribe((e) => events.push(e.type));

    svc.simulateWandering('lost');
    expect(events[0]).toBe('wandering_start');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(events).toEqual(['wandering_start', 'wandering_end']);

    expect(openclawSyncService.syncWanderingEvent).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

