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

type WanderingState = {
  isWandering: boolean;
  wanderingType: 'none' | 'circling' | 'pacing' | 'lost';
  confidence: number;
  duration: number;
  distanceFromHome: number;
  outsideSafeZone: boolean;
  lastKnownLocation?: { latitude: number; longitude: number; timestamp: number };
};

type WanderingEvent = {
  type: 'wandering_start' | 'wandering_end' | 'left_safe_zone' | 'returned_safe';
  state: WanderingState;
  timestamp: Date;
};

let wanderingEventHandler: ((e: WanderingEvent) => void) | null = null;
const subscribeSpy = vi.fn();

vi.mock('../services/wanderingService', () => {
  return {
    wanderingService: {
      subscribe: (cb: (e: WanderingEvent) => void) => {
        subscribeSpy();
        wanderingEventHandler = cb;
        return () => {
          wanderingEventHandler = null;
        };
      },
    },
  };
});

describe('components/WanderingAlert (functional)', () => {
  beforeEach(() => {
    vi.resetModules();
    wanderingEventHandler = null;
    subscribeSpy.mockClear();
  });

  it('shows alert on wandering_start and allows calling family', async () => {
    const user = userEvent.setup();
    const onCallFamily = vi.fn();

    const { default: WanderingAlert } = await import('./WanderingAlert');
    render(<WanderingAlert onCallFamily={onCallFamily} />);
    expect(subscribeSpy).toHaveBeenCalled();

    const state: WanderingState = {
      isWandering: true,
      wanderingType: 'lost',
      confidence: 0.9,
      duration: 0,
      distanceFromHome: 1500,
      outsideSafeZone: true,
    };

    wanderingEventHandler?.({ type: 'wandering_start', state, timestamp: new Date() });

    expect(await screen.findByText('已离开安全区域')).toBeInTheDocument();
    expect(screen.getByText(/距家 1500 米/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '联系家人' }));
    expect(onCallFamily).toHaveBeenCalled();
  });

  it('auto calls family after countdown', async () => {
    vi.useFakeTimers();
    const onCallFamily = vi.fn();

    const { default: WanderingAlert } = await import('./WanderingAlert');
    const { unmount } = render(<WanderingAlert onCallFamily={onCallFamily} />);

    const state: WanderingState = {
      isWandering: true,
      wanderingType: 'lost',
      confidence: 0.9,
      duration: 0,
      distanceFromHome: 1500,
      outsideSafeZone: true,
    };

    wanderingEventHandler?.({ type: 'left_safe_zone', state, timestamp: new Date() });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText('已离开安全区域')).toBeInTheDocument();

    // advance second-by-second to allow React state/effects to flush
    for (let i = 0; i < 31; i += 1) {
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(onCallFamily).toHaveBeenCalled();

    unmount();
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});

