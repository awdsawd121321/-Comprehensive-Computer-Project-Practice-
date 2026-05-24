import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./openclawSyncService', () => {
  return {
    openclawSyncService: {
      syncMedications: vi.fn(),
      syncMedicationLogs: vi.fn(),
      syncMedicationEvent: vi.fn(),
    },
  };
});

describe('services/medicationService', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
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

  it('simulateReminder emits reminder event and sets activeReminder', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T08:00:00.000Z'));

    const { MedicationService } = await import('./medicationService');
    const { openclawSyncService } = await import('./openclawSyncService');
    const api = await import('./api');
    vi.spyOn(api.VoiceService, 'speak').mockResolvedValue(undefined);

    const svc = new MedicationService();
    const events: string[] = [];
    svc.subscribe((e) => events.push(e.type));

    svc.simulateReminder();
    expect(events[0]).toBe('reminder');
    expect(svc.getActiveReminder()).not.toBeNull();
    expect(openclawSyncService.syncMedicationEvent).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('confirmTaken emits taken event and clears activeReminder', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T08:00:00.000Z'));

    const { MedicationService } = await import('./medicationService');
    const api = await import('./api');
    vi.spyOn(api.VoiceService, 'speak').mockResolvedValue(undefined);

    const svc = new MedicationService();
    const events: string[] = [];
    svc.subscribe((e) => events.push(e.type));

    svc.simulateReminder();
    svc.confirmTaken();
    expect(events).toContain('taken');
    expect(svc.getActiveReminder()).toBeNull();
    vi.useRealTimers();
  });
});

