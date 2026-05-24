import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SimulationType } from './types';

const mockSundowningService = (opts?: { riskLevel?: 'low' | 'medium' | 'high' }) => {
  const riskLevel = opts?.riskLevel ?? 'low';
  vi.doMock('./services/sundowningService', () => {
    return {
      sundowningService: {
        subscribe: (cb: (snapshot: any) => void) => {
          cb({ riskLevel });
          return () => {};
        },
        subscribeAlerts: () => () => {},
        startSimulation: vi.fn(),
        stopSimulation: vi.fn(),
      },
    };
  });
};

vi.mock('./components/Dashboard', () => {
  return {
    default: () => <div>__DASHBOARD_VIEW__</div>,
  };
});

vi.mock('./components/ElderlyApp', () => {
  return {
    default: ({ externalAction, externalMessage }: any) => (
      <div>
        <div>__ELDERLY_APP_VIEW__</div>
        <div>__ELDERLY_ACTION__:{externalAction?.action || ''}</div>
        <div>__ELDERLY_MESSAGE__:{externalMessage?.text || ''}</div>
      </div>
    ),
  };
});

vi.mock('./components/Sidebar', () => {
  return {
    default: ({ onSimulate }: { onSimulate: (t: SimulationType) => void }) => (
      <div>
        <button onClick={() => onSimulate(SimulationType.FALL)}>__SIM_FALL__</button>
        <button onClick={() => onSimulate(SimulationType.NONE)}>__SIM_RESET__</button>
      </div>
    ),
  };
});

vi.mock('./services/wanderingService', () => {
  return {
    wanderingService: {
      simulateWandering: vi.fn(),
    },
  };
});

vi.mock('./services/medicationService', () => {
  return {
    medicationService: {
      simulateReminder: vi.fn(),
    },
  };
});

vi.mock('./services/openclawSyncService', () => {
  return {
    openclawSyncService: {
      isEnabled: () => false,
      getElderId: () => 'elder_demo',
      emitScenarioSignal: vi.fn(),
    },
  };
});

describe('App (functional)', () => {
  it('switches views between elderly app and dashboard', async () => {
    const user = userEvent.setup();
    vi.resetModules();
    mockSundowningService({ riskLevel: 'low' });
    const { default: App } = await import('./App');

    render(<App />);

    expect(screen.getByText('__DASHBOARD_VIEW__')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: '老人端 (App)' })[0]!);
    expect(screen.getByText('__ELDERLY_APP_VIEW__')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '家属端 (后台)' }));
    expect(screen.getByText('__DASHBOARD_VIEW__')).toBeInTheDocument();
  });

  it('shows warning status when sundowning risk is high', async () => {
    vi.resetModules();
    mockSundowningService({ riskLevel: 'high' });
    const { default: App } = await import('./App');

    render(<App />);
    expect(screen.getAllByText('检测到异常行为').length).toBeGreaterThan(0);
  });

  it('applies local ui commands to the elderly app', async () => {
    const user = userEvent.setup();
    vi.resetModules();
    mockSundowningService({ riskLevel: 'low' });
    const { publishLocalUiCommand } = await import('./services/localUiCommandBus');
    const { default: App } = await import('./App');

    render(<App />);

    publishLocalUiCommand({
      type: 'elder.action',
      payload: {
        action: 'speak_text',
        text: '本地兜底播报',
      },
    });

    await user.click(screen.getAllByRole('button', { name: '老人端 (App)' })[0]!);

    await waitFor(() => {
      expect(screen.getByText('__ELDERLY_ACTION__:speak_text')).toBeInTheDocument();
    });
  });
});
