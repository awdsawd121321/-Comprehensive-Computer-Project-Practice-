import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockRecognitionEvent = {
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

class MockSpeechRecognition {
  public lang = 'zh-CN';
  public continuous = true;
  public interimResults = true;
  public onresult: ((event: MockRecognitionEvent) => void) | null = null;
  public onerror: ((event: { error: string }) => void) | null = null;
  public onend: (() => void) | null = null;

  start() {
    setTimeout(() => {
      const event: MockRecognitionEvent = {
        results: [
          {
            isFinal: true,
            0: { transcript: '我要去天安门' },
          },
        ],
      };
      this.onresult?.(event);
      this.onend?.();
    }, 40);
  }

  stop() {
    this.onend?.();
  }
}

describe('voice interaction latency (functional)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T10:00:00.000Z'));
    (window as any).webkitSpeechRecognition = MockSpeechRecognition;
  });

  it('measures speech recognition callback latency', async () => {
    const { speechService } = await import('../services/speechService');
    const startedAt = Date.now();

    const latencyPromise = new Promise<number>((resolve) => {
      speechService.startRecognition((result) => {
        if (result.isFinal) {
          resolve(Date.now() - startedAt);
        }
      });
    });

    await vi.advanceTimersByTimeAsync(40);
    const recognitionLatencyMs = await latencyPromise;
    console.log(`[VOICE-LATENCY] recognition_latency_ms=${recognitionLatencyMs}`);

    expect(recognitionLatencyMs).toBe(40);
    speechService.stopRecognition();
    vi.useRealTimers();
  });

  it('measures voice reply completion latency', async () => {
    vi.doMock('../services/ttsService', () => {
      return {
        edgeTTSService: {
          speak: vi.fn(
            (_text: string, _voice: string, onEnded?: () => void) =>
              new Promise<void>((resolve) => {
                setTimeout(() => {
                  onEnded?.();
                  resolve();
                }, 55);
              }),
          ),
          synthesize: vi.fn(),
          stop: vi.fn(),
          preload: vi.fn(),
          checkConnection: vi.fn(async () => true),
        },
      };
    });

    const { VoiceService } = await import('../services/api');
    const startedAt = Date.now();
    let callbackLatencyMs = -1;

    const speakPromise = VoiceService.speak('请按医嘱服药', undefined, undefined, () => {
      callbackLatencyMs = Date.now() - startedAt;
    });

    await vi.advanceTimersByTimeAsync(55);
    await speakPromise;
    console.log(`[VOICE-LATENCY] reply_latency_ms=${callbackLatencyMs}`);

    expect(callbackLatencyMs).toBe(55);
    vi.useRealTimers();
  });
});

