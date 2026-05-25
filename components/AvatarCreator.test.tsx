import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AvatarCreator from './AvatarCreator';

const generateFromTextMock = vi.fn(async () => {
  return {
    imageUrl: 'https://example.com/generated-avatar.png',
    prompt: 'mock prompt',
    timestamp: Date.now(),
  };
});

vi.mock('../services/aigcService', () => {
  return {
    aigcService: {
      generateFromText: (...args: any[]) => generateFromTextMock(...args),
      generateFromPhoto: vi.fn(),
    },
  };
});

vi.mock('../services/speechService', () => {
  return {
    speechService: {
      startRecognition: vi.fn(),
      stopRecognition: vi.fn(),
    },
  };
});

describe('components/AvatarCreator (functional)', () => {
  it('creates avatar from text and confirms usage', async () => {
    const user = userEvent.setup();
    const onAvatarCreated = vi.fn();
    const onClose = vi.fn();

    render(<AvatarCreator onAvatarCreated={onAvatarCreated} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /语音描述/ }));
    await user.type(
      screen.getByPlaceholderText('例如：戴着眼镜，慈祥的笑容，穿着蓝色中山装...'),
      '戴着眼镜，微笑',
    );

    await user.click(screen.getByRole('button', { name: '开始生成' }));

    expect(generateFromTextMock).toHaveBeenCalled();
    expect(await screen.findByAltText('Generated Avatar')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '使用此形象' }));
    expect(onAvatarCreated).toHaveBeenCalledWith('https://example.com/generated-avatar.png');
    expect(onClose).toHaveBeenCalled();
  });
});

