import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CognitiveReport from './CognitiveReport';

vi.mock('../services/cognitiveService', () => {
  return {
    cognitiveService: {
      getTodayReport: vi.fn(() => ({
        date: '2026-03-19',
        score: {
          total: 82,
          level: 'good',
          memory: 16,
          language: 17,
          orientation: 15,
          emotion: 17,
          social: 17,
        },
        conversationCount: 6,
        repetitionCount: 1,
        medicationAdherence: 92,
        alerts: ['出现一次重复询问，建议加强陪伴沟通'],
        highlights: ['今天心情较稳定，愿意参与对话'],
      })),
      getTrend: vi.fn(() => ({
        trend: 'stable',
        average: 78,
        scores: [70, 72, 75, 76, 78, 79, 81],
        dates: ['2026-03-13', '2026-03-14', '2026-03-15', '2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19'],
      })),
    },
  };
});

describe('components/CognitiveReport (functional)', () => {
  it('renders when open and allows switching tabs', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<CognitiveReport isOpen={true} onClose={onClose} />);
    expect(screen.getByText('认知健康报告')).toBeInTheDocument();

    // default tab: 今日详情
    expect(screen.getByText('五维度评分')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '趋势分析' }));
    expect(screen.getByText('近7天趋势')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const { container } = render(<CognitiveReport isOpen={true} onClose={onClose} />);

    const buttons = container.querySelectorAll('button');
    // first button in header is the close button (X icon)
    await user.click(buttons[0] as HTMLButtonElement);
    expect(onClose).toHaveBeenCalled();
  });
});

