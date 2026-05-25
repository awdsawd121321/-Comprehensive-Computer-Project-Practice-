import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('voice clone (functional)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('clones voice successfully with measurable latency', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T10:00:00.000Z'));
    const preloadPhrases = vi.fn(async () => undefined);

    vi.doMock('../services/voiceCloneService', () => {
      return {
        voiceCloneService: {
          checkConnection: vi.fn(async () => true),
          registerVoice: vi.fn(
            () =>
              new Promise((resolve) => {
                setTimeout(() => {
                  resolve({
                    name: '爷爷声音样本A',
                    status: 'ready',
                  });
                }, 80);
              }),
          ),
          preloadPhrases,
          listVoices: vi.fn(async () => []),
        },
      };
    });

    const { VoiceService } = await import('../services/api');
    const startedAt = Date.now();
    const clonePromise = VoiceService.cloneVoice(new Blob(['mock-voice']), '爷爷声音样本A');

    await vi.advanceTimersByTimeAsync(80);
    const profile = await clonePromise;
    const cloneReadyLatencyMs = Date.now() - startedAt;
    console.log(`[VOICE-CLONE] clone_ready_latency_ms=${cloneReadyLatencyMs}`);

    expect(cloneReadyLatencyMs).toBe(80);
    expect(profile.status).toBe('ready');
    expect(profile.isCloned).toBe(true);
    expect(profile.id.startsWith('cloned_')).toBe(true);
    expect(preloadPhrases).toHaveBeenCalledTimes(1);
    expect(preloadPhrases).toHaveBeenCalledWith(profile.id, expect.any(Array));
    vi.useRealTimers();
  });

  it('routes cloned voice playback through the clone service instead of Edge TTS', async () => {
    const cloneSpeak = vi.fn(async (_text: string, _voiceId: string, _language?: string, onEnded?: () => void) => {
      onEnded?.();
    });
    const edgeSpeak = vi.fn(async () => undefined);

    vi.doMock('../services/voiceCloneService', () => {
      return {
        voiceCloneService: {
          checkConnection: vi.fn(async () => true),
          registerVoice: vi.fn(),
          preloadPhrases: vi.fn(async () => undefined),
          listVoices: vi.fn(async () => []),
          speak: cloneSpeak,
          stop: vi.fn(),
          synthesize: vi.fn(),
        },
      };
    });

    vi.doMock('../services/ttsService', () => {
      return {
        edgeTTSService: {
          speak: edgeSpeak,
          synthesize: vi.fn(),
          stop: vi.fn(),
          preload: vi.fn(),
          checkConnection: vi.fn(async () => true),
        },
      };
    });

    const { VoiceService } = await import('../services/api');
    const onEnded = vi.fn();
    await VoiceService.speak('你好，我是你的数字人助手', 'cloned_test_voice', undefined, onEnded);

    expect(cloneSpeak).toHaveBeenCalledTimes(1);
    expect(cloneSpeak).toHaveBeenCalledWith(
      '你好，我是你的数字人助手',
      'cloned_test_voice',
      'zh',
      onEnded,
    );
    expect(edgeSpeak).not.toHaveBeenCalled();
  });

  it('falls back to Edge TTS when clone playback fails and backs off repeated clone retries', async () => {
    const cloneSpeak = vi.fn(async () => {
      throw new Error('语音克隆服务连接失败');
    });
    const edgeSpeak = vi.fn(async (_text: string, _voice: string, onEnded?: () => void) => {
      onEnded?.();
    });

    vi.doMock('../services/voiceCloneService', () => {
      return {
        voiceCloneService: {
          checkConnection: vi.fn(async () => true),
          registerVoice: vi.fn(),
          preloadPhrases: vi.fn(async () => undefined),
          listVoices: vi.fn(async () => []),
          speak: cloneSpeak,
          stop: vi.fn(),
          synthesize: vi.fn(),
        },
      };
    });

    vi.doMock('../services/ttsService', () => {
      return {
        edgeTTSService: {
          speak: edgeSpeak,
          synthesize: vi.fn(),
          stop: vi.fn(),
          preload: vi.fn(),
          checkConnection: vi.fn(async () => true),
        },
      };
    });

    const { VoiceService } = await import('../services/api');
    const onEnded = vi.fn();

    await VoiceService.speak('你好，我是你的数字人助手', 'cloned_test_voice', undefined, onEnded);
    await VoiceService.speak('再次问候', 'cloned_test_voice', undefined, onEnded);

    expect(cloneSpeak).toHaveBeenCalledTimes(1);
    expect(edgeSpeak).toHaveBeenCalledTimes(2);
    expect(edgeSpeak).toHaveBeenNthCalledWith(1, '你好，我是你的数字人助手', 'xiaoyi', onEnded);
    expect(edgeSpeak).toHaveBeenNthCalledWith(2, '再次问候', 'xiaoyi', onEnded);
  });

  it('falls back safely when clone service unavailable', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.doMock('../services/voiceCloneService', () => {
      return {
        voiceCloneService: {
          checkConnection: vi.fn(async () => false),
          registerVoice: vi.fn(),
          listVoices: vi.fn(async () => []),
        },
      };
    });

    const { VoiceService } = await import('../services/api');
    const profile = await VoiceService.cloneVoice(new Blob(['mock-voice']), '回退验证');

    expect(profile.status).toBe('failed');
    expect(profile.isCloned).toBe(false);
    expect(profile.id).toBe('voice_xiaoxiao');

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
