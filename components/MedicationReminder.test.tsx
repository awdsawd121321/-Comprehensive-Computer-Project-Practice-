import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../services/api', () => {
  const speak = vi.fn(() => Promise.resolve());
  return {
    VoiceService: {
      speak,
    },
  };
});

type MedicationEvent = {
  type: 'reminder' | 'taken' | 'missed' | 'snooze' | 'box_open' | 'pillbox_connected';
  medication: {
    id: string;
    name: string;
    dosage: string;
    frequency: string;
    times: string[];
    instructions: string;
    purpose: string;
    imageUrl?: string;
  };
  scheduledTime: string;
  timestamp: Date;
};

let medicationEventHandler: ((e: MedicationEvent) => void) | null = null;
const startMonitoring = vi.fn();
const stopMonitoring = vi.fn();
const confirmTaken = vi.fn();
const snoozeReminder = vi.fn();

vi.mock('../services/medicationService', () => {
  return {
    medicationService: {
      startMonitoring: (...args: any[]) => startMonitoring(...args),
      stopMonitoring: (...args: any[]) => stopMonitoring(...args),
      confirmTaken: (...args: any[]) => confirmTaken(...args),
      snoozeReminder: (...args: any[]) => snoozeReminder(...args),
      subscribe: (cb: (e: MedicationEvent) => void) => {
        medicationEventHandler = cb;
        return () => {
          medicationEventHandler = null;
        };
      },
    },
  };
});

describe('components/MedicationReminder (functional)', () => {
  beforeEach(() => {
    vi.resetModules();
    medicationEventHandler = null;
    startMonitoring.mockClear();
    stopMonitoring.mockClear();
    confirmTaken.mockClear();
    snoozeReminder.mockClear();
  });

  it('renders reminder UI and calls service actions', async () => {
    const user = userEvent.setup();
    const { default: MedicationReminder } = await import('./MedicationReminder');
    render(<MedicationReminder />);
    expect(startMonitoring).toHaveBeenCalled();

    const medication = {
      id: 'med_1',
      name: '盐酸奥司他韦',
      dosage: '75mg，1粒',
      frequency: '每日2次',
      times: ['08:00', '20:00'],
      instructions: '与食物同服，用温水送服',
      purpose: '抗流感',
    };

    medicationEventHandler?.({
      type: 'reminder',
      medication,
      scheduledTime: '08:00',
      timestamp: new Date(),
    });

    expect(await screen.findByText('该吃药啦')).toBeInTheDocument();
    expect(screen.getByText('盐酸奥司他韦')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '10分钟后提醒' }));
    expect(snoozeReminder).toHaveBeenCalledWith(10);

    await user.click(screen.getByRole('button', { name: '我已服药' }));
    expect(confirmTaken).toHaveBeenCalled();
  });

  it('shows confirmation on taken event and auto hides', async () => {
    vi.useFakeTimers();
    const { default: MedicationReminder } = await import('./MedicationReminder');
    const { unmount } = render(<MedicationReminder />);

    const medication = {
      id: 'med_1',
      name: '盐酸奥司他韦',
      dosage: '75mg，1粒',
      frequency: '每日2次',
      times: ['08:00', '20:00'],
      instructions: '与食物同服，用温水送服',
      purpose: '抗流感',
    };

    medicationEventHandler?.({ type: 'reminder', medication, scheduledTime: '08:00', timestamp: new Date() });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText('该吃药啦')).toBeInTheDocument();

    medicationEventHandler?.({ type: 'taken', medication, scheduledTime: '08:00', timestamp: new Date() });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText('已记录服药')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByText('已记录服药')).toBeNull();

    unmount();
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});

