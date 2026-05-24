/**
 * 录音转 WAV 等音频工具
 * 将 MediaRecorder 等产生的 Blob 转为 WAV，供语音克隆使用
 */

/**
 * 把 Float32Array PCM 转为 16bit PCM
 */
function floatTo16Bit(float32: Float32Array): Int16Array {
  const len = float32.length;
  const buf = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return buf;
}

/**
 * 写入 WAV 文件头 + PCM 数据
 */
function wavHeader(
  dataLength: number,
  sampleRate: number,
  numChannels: number
): ArrayBuffer {
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset: number, val: number, little = true) =>
    view.setUint32(offset, val, little);

  const setStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  setStr(0, 'RIFF');
  write(4, 36 + dataLength);
  setStr(8, 'WAVE');
  setStr(12, 'fmt ');
  write(16, 16); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  write(24, sampleRate);
  write(28, byteRate);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  setStr(36, 'data');
  write(40, dataLength);

  return header;
}

/**
 * 将 Blob（如 webm/mp4 录音）解码后转成 WAV Blob
 * 用于录音 ≥10s 后整合成单一 WAV 供克隆
 */
export async function blobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  let float32: Float32Array;

  if (numChannels === 1) {
    float32 = buffer.getChannelData(0);
  } else {
    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);
    float32 = new Float32Array(L.length + R.length);
    for (let i = 0; i < L.length; i++) {
      float32[i * 2] = L[i];
      float32[i * 2 + 1] = R[i];
    }
  }

  const pcm = floatTo16Bit(float32);
  const dataLength = pcm.byteLength;
  const header = wavHeader(dataLength, sampleRate, numChannels);
  const wav = new Blob([header, new Uint8Array(pcm.buffer, 0, pcm.byteLength)], {
    type: 'audio/wav',
  });
  try {
    ctx.close();
  } catch {
    /* ignore */
  }
  return wav;
}

/**
 * 获取音频时长（秒）
 */
export async function getAudioDurationSeconds(blob: Blob): Promise<number> {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const dur = buffer.duration;
  try {
    ctx.close();
  } catch {
    /* ignore */
  }
  return dur;
}
