/**
 * 真实服务联调测试：FunASR 语音识别 WebSocket、Edge TTS WebSocket、IndexTTS2 语音克隆 WebSocket。
 * 默认不执行；需本地已启动对应服务后设置环境变量：
 *   VITEST_REAL_SERVICES=1 npm run test:functional:live
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const RUN_LIVE = process.env.VITEST_REAL_SERVICES === '1';

function funAsrWsUrl(): string {
  return process.env.VITE_FUNASR_WS_URL || 'ws://127.0.0.1:10095';
}

function edgeTtsWsUrl(): string {
  return process.env.VITE_EDGE_TTS_WS_URL || 'ws://127.0.0.1:10096';
}

function voiceCloneWsUrl(): string {
  return process.env.VITE_VOICE_CLONE_WS_URL || 'ws://127.0.0.1:10097';
}

function voiceCloneSampleDir(): string {
  return path.resolve(process.cwd(), 'scripts', 'cloned_voices');
}

/** FunASR 服务端 MIN_AUDIO_SIZE 默认 8000 字节；发送略大于阈值的静音 PCM（Int16） */
const SILENCE_PCM_BYTES = 16_000;

function funAsrPipelineOnce(url: string): Promise<{
  startToReadyMs: number;
  stopToFinalMs: number;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const tid = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error('FunASR 联调超时（请确认 funasr_server 已启动且地址正确）'));
    }, 180_000);

    let tOpen = 0;
    let tReady = 0;
    let tStopSent = 0;
    let gotFinal = false;

    ws.onerror = () => {
      clearTimeout(tid);
      reject(new Error('FunASR WebSocket 连接失败'));
    };

    ws.onopen = () => {
      tOpen = performance.now();
      ws.send(JSON.stringify({ type: 'start' }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data));

        if (data.type === 'ready' && tReady === 0) {
          tReady = performance.now();
          const samples = SILENCE_PCM_BYTES / 2;
          const pcm = new Int16Array(samples);
          ws.send(pcm.buffer);
          tStopSent = performance.now();
          ws.send(JSON.stringify({ type: 'stop', is_speaking: false }));
        }

        if (data.is_final === true && !gotFinal) {
          gotFinal = true;
          const tFinal = performance.now();
          clearTimeout(tid);
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          const startToReadyMs = Math.round(tReady - tOpen);
          const stopToFinalMs = Math.round(tFinal - tStopSent);
          console.log(`REAL_FUNASR_start_to_ready_ms=${startToReadyMs}`);
          console.log(`REAL_FUNASR_stop_to_final_ms=${stopToFinalMs}`);
          resolve({ startToReadyMs, stopToFinalMs });
        }
      } catch (e) {
        clearTimeout(tid);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
  });
}

function edgeTtsOnce(url: string, text: string, voice = 'xiaoyi'): Promise<{
  roundtripMs: number;
  audioBytes: number;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const tid = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error('Edge TTS 联调超时（请确认 edge_tts_server 已启动且网络可用）'));
    }, 120_000);

    let tOpen = 0;

    ws.onerror = () => {
      clearTimeout(tid);
      reject(new Error('Edge TTS WebSocket 连接失败'));
    };

    ws.onopen = () => {
      tOpen = performance.now();
      ws.send(JSON.stringify({ text, voice }));
    };

    ws.onmessage = (event) => {
      clearTimeout(tid);
      try {
        const data = JSON.parse(String(event.data));
        if (!data.success || !data.audio) {
          throw new Error(data.error || 'Edge TTS 未返回音频');
        }
        const roundtripMs = Math.round(performance.now() - tOpen);
        const audioBytes = Buffer.from(String(data.audio), 'base64').byteLength;
        console.log(`REAL_EDGE_TTS_roundtrip_ms=${roundtripMs}`);
        console.log(`REAL_EDGE_TTS_audio_bytes=${audioBytes}`);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        resolve({ roundtripMs, audioBytes });
      } catch (error) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
  });
}

async function loadVoiceCloneSample(): Promise<File> {
  const dir = voiceCloneSampleDir();
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith('.wav'));
  if (names.length === 0) {
    throw new Error(`未找到语音克隆样本文件：${dir}`);
  }
  const samplePath = path.join(dir, names.sort()[0]!);
  const bytes = await fs.readFile(samplePath);
  return new File([bytes], path.basename(samplePath), { type: 'audio/wav' });
}

function voiceCloneSynthesizeOnce(
  url: string,
  text: string,
  voiceId: string,
  options?: { timeoutMs?: number; logPrefix?: string; },
): Promise<{
  roundtripMs: number;
  audioBytes: number;
}> {
  return new Promise((resolve, reject) => {
    const timeoutMs = options?.timeoutMs ?? 420_000;
    const logPrefix = options?.logPrefix ?? 'REAL_VOICE_CLONE';
    const ws = new WebSocket(url);
    const tid = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error(`语音克隆联调超时（服务已启动，但真实合成耗时超过 ${timeoutMs}ms）`));
    }, timeoutMs);

    let tOpen = 0;

    ws.onerror = () => {
      clearTimeout(tid);
      reject(new Error('语音克隆 WebSocket 连接失败'));
    };

    ws.onopen = () => {
      tOpen = performance.now();
      ws.send(JSON.stringify({
        action: 'synthesize',
        text,
        voice_id: voiceId,
        language: 'zh',
      }));
    };

    ws.onmessage = (event) => {
      clearTimeout(tid);
      try {
        const data = JSON.parse(String(event.data));
        if (!data.success || !data.audio) {
          throw new Error(data.error || '语音克隆未返回音频');
        }
        const roundtripMs = Math.round(performance.now() - tOpen);
        const audioBytes = Buffer.from(String(data.audio), 'base64').byteLength;
        console.log(`${logPrefix}_synthesize_ms=${roundtripMs}`);
        console.log(`${logPrefix}_audio_bytes=${audioBytes}`);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        resolve({ roundtripMs, audioBytes });
      } catch (error) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
  });
}

describe.skipIf(!RUN_LIVE)('真实服务联调（FunASR + Edge TTS + 语音克隆）', { timeout: 420_000 }, () => {
  it('FunASR：WebSocket 会话就绪与一次静音帧识别闭环时延', async () => {
    const url = funAsrWsUrl();
    const { startToReadyMs, stopToFinalMs } = await funAsrPipelineOnce(url);

    expect(startToReadyMs).toBeGreaterThanOrEqual(0);
    expect(startToReadyMs).toBeLessThan(60_000);
    expect(stopToFinalMs).toBeGreaterThanOrEqual(0);
    expect(stopToFinalMs).toBeLessThan(180_000);
  });

  it('Edge TTS：真实 WebSocket 文本转语音返回时延与音频结果', async () => {
    const url = edgeTtsWsUrl();
    const { roundtripMs, audioBytes } = await edgeTtsOnce(
      url,
      '张爷爷，晚上好，我来提醒您按时服药和早点休息。',
      'xiaoyi',
    );

    expect(roundtripMs).toBeGreaterThanOrEqual(0);
    expect(roundtripMs).toBeLessThan(120_000);
    expect(audioBytes).toBeGreaterThan(0);
  });

  it('语音克隆：模型就绪、注册样本并完成一次真实合成', async () => {
    const { voiceCloneService } = await import('../../services/voiceCloneService');

    const tConn0 = performance.now();
    const ok = await voiceCloneService.checkConnection();
    const tConn1 = performance.now();
    const checkConnectionMs = Math.round(tConn1 - tConn0);
    console.log(`REAL_VOICE_CLONE_check_connection_ms=${checkConnectionMs}`);
    expect(ok).toBe(true);

    const tSt0 = performance.now();
    const status = await voiceCloneService.checkStatus();
    const tSt1 = performance.now();
    const checkStatusMs = Math.round(tSt1 - tSt0);
    console.log(`REAL_VOICE_CLONE_check_status_roundtrip_ms=${checkStatusMs}`);

    expect(status.hasModel).toBe(true);
    expect(status.modelReady).toBe(true);
    expect(checkStatusMs).toBeGreaterThanOrEqual(0);
    expect(checkStatusMs).toBeLessThan(60_000);

    const sample = await loadVoiceCloneSample();
    const voiceId = `live_voice_${Date.now()}`;

    const tReg0 = performance.now();
    const config = await voiceCloneService.registerVoice(sample, voiceId, 'Live Test Voice');
    const tReg1 = performance.now();
    const registerMs = Math.round(tReg1 - tReg0);
    console.log(`REAL_VOICE_CLONE_register_ms=${registerMs}`);

    expect(config.status).toBe('ready');
    expect(registerMs).toBeGreaterThanOrEqual(0);
    expect(registerMs).toBeLessThan(120_000);

    const uniqueText = `晚上好，请按时休息。缓存验证批次 ${Date.now()}`;
    const { roundtripMs, audioBytes } = await voiceCloneSynthesizeOnce(
      voiceCloneWsUrl(),
      uniqueText,
      voiceId,
    );
    const cached = await voiceCloneSynthesizeOnce(
      voiceCloneWsUrl(),
      uniqueText,
      voiceId,
      { timeoutMs: 10_000, logPrefix: 'REAL_VOICE_CLONE_cache_hit' },
    );
    console.log(`REAL_VOICE_CLONE_cache_speedup_ratio=${(roundtripMs / cached.roundtripMs).toFixed(2)}`);
    expect(roundtripMs).toBeGreaterThanOrEqual(0);
    expect(roundtripMs).toBeLessThan(420_000);
    expect(audioBytes).toBeGreaterThan(0);
    expect(cached.roundtripMs).toBeGreaterThanOrEqual(0);
    expect(cached.roundtripMs).toBeLessThan(10_000);
    expect(cached.audioBytes).toBe(audioBytes);
    expect(cached.roundtripMs).toBeLessThan(roundtripMs);
  });
});
