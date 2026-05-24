/**
 * YiCompanion API 服务层
 * 语音合成使用 Edge TTS（流畅、免费），默认孙女声（晓伊）；可选语音克隆 (IndexTTS2)。3D 形象：Ready Player Me
 */

import { VoiceProfile, AvatarModel } from '../types';
import { edgeTTSService } from './ttsService';
import type { VoiceType } from './ttsService';
import { voiceCloneService } from './voiceCloneService';
import { voiceSelectionService } from './voiceSelectionService';

/** 默认 TTS 声音：孙女风格（晓伊，年轻女声/女童声） */
const DEFAULT_TTS_VOICE: VoiceType = 'xiaoyi';
const CLONE_VOICE_FAILURE_COOLDOWN_MS = 30_000;
const cloneVoiceBackoffUntil = new Map<string, number>();

/** Edge TTS 可选音色（id 为 edge_xxx，与后端 voice key 一致） */
const EDGE_VOICE_OPTIONS: { id: string; name: string; voiceKey: VoiceType }[] = [
  { id: 'edge_xiaoyi', name: '孙女 (晓伊)', voiceKey: 'xiaoyi' },
  { id: 'edge_xiaoxiao', name: '晓晓 (女声)', voiceKey: 'xiaoxiao' },
  { id: 'edge_xiaoxuan', name: '晓萱 (女声)', voiceKey: 'xiaoxuan' },
  { id: 'edge_yunxia', name: '云夏 (女声)', voiceKey: 'yunxia' },
  { id: 'edge_yunxi', name: '云希 (男声)', voiceKey: 'yunxi' },
  { id: 'edge_yunjian', name: '云健 (男声)', voiceKey: 'yunjian' },
  { id: 'edge_yunyang', name: '云扬 (男声)', voiceKey: 'yunyang' },
];

/** 根据选中的 voiceId 解析出 Edge TTS 的 voice key */
function getEffectiveVoice(voiceId: string | null | undefined): VoiceType {
  if (!voiceId || !voiceId.startsWith('edge_')) return DEFAULT_TTS_VOICE;
  const key = voiceId.replace(/^edge_/, '');
  const opt = EDGE_VOICE_OPTIONS.find(o => o.voiceKey === key);
  return opt ? opt.voiceKey : DEFAULT_TTS_VOICE;
}

function isClonedVoiceId(voiceId: string | null | undefined): voiceId is string {
  return Boolean(voiceId && !voiceId.startsWith('edge_'));
}

function resolveVoiceTarget(voiceId?: string): { kind: 'clone'; voiceId: string } | { kind: 'edge'; voice: VoiceType } {
  const selectedVoiceId = voiceId ?? voiceSelectionService.getSelectedVoiceId();
  if (isClonedVoiceId(selectedVoiceId)) {
    return { kind: 'clone', voiceId: selectedVoiceId };
  }
  return { kind: 'edge', voice: getEffectiveVoice(selectedVoiceId) };
}

function isCloneVoiceInBackoff(voiceId: string): boolean {
  return (cloneVoiceBackoffUntil.get(voiceId) || 0) > Date.now();
}

function markCloneVoiceFailed(voiceId: string, error?: unknown): void {
  const previous = cloneVoiceBackoffUntil.get(voiceId) || 0;
  cloneVoiceBackoffUntil.set(voiceId, Date.now() + CLONE_VOICE_FAILURE_COOLDOWN_MS);
  if (previous <= Date.now()) {
    console.warn(`[VoiceService] 克隆音色 ${voiceId} 当前不可用，已临时回退到 Edge TTS。`, error);
  }
}

function clearCloneVoiceFailure(voiceId: string): void {
  cloneVoiceBackoffUntil.delete(voiceId);
}

async function synthesizeWithEdgeVoice(text: string, voice: VoiceType = DEFAULT_TTS_VOICE): Promise<string> {
  const result = await edgeTTSService.synthesize(text, voice);
  if (result.success && result.audioUrl) return result.audioUrl;
  throw new Error(result.error || '语音合成失败');
}

// 配置：设置为 false 以启用真实 API 调用
export const USE_MOCK_API = false;

/** Edge TTS 常用句预拉，命中缓存可近即时播放 */
const COMMON_TTS_PHRASES = [
  '你好，我是你的数字人助手',
  '张爷爷，我是您的数字人助手。今天身体怎么样？',
  '张爷爷，您到家了呢！要不要看看时光相册，回忆一下美好时光？',
  '今天天气不错，24度晴朗。出门记得戴帽子防晒哦~',
  '好的，我来帮您导航。',
  '好的，我来帮您看看药。',
  '好的，让我们一起看看老照片吧~',
  '不客气，能帮到您是我的荣幸！',
  '抱歉，我没太听清楚，您能再说一遍吗？',
];

/** 语音克隆高频短句预热集合：命中缓存后可显著缩短重复播报等待时间 */
const COMMON_CLONE_PHRASES = [
  '你好，我是你的数字人助手',
  '好的，我来帮您看看药。',
  '晚上好，请按时休息。',
];

// --- Voice Service (主 TTS: Edge TTS，默认孙女声；可选语音克隆) ---
export const VoiceService = {
  /**
   * 声音克隆功能 - 使用 IndexTTS2
   * @param audioBlob 音频文件 (须 ≥10 秒，WAV；前端会先整合/转换)
   * @param name 声音名称
   * @returns 返回克隆的声音配置，并会存入可切换列表
   */
  cloneVoice: async (audioBlob: Blob, name: string): Promise<VoiceProfile> => {
    try {
      console.log('[VoiceService] cloneVoice: 检查服务连接...');
      const isAvailable = await voiceCloneService.checkConnection();

      if (!isAvailable) {
        console.warn('[VoiceService] 语音克隆服务不可用');
        throw new Error('语音克隆服务不可用，请确保语音克隆服务器正在运行');
      }

      const voiceId = `cloned_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log('[VoiceService] cloneVoice: 注册声音', { voiceId, name, blobSize: audioBlob.size });

      const config = await voiceCloneService.registerVoice(
        audioBlob,
        voiceId,
        name || '克隆声音'
      );

      // 注册完成后立即异步预热高频短句，后续同音色/同文本请求可直接命中缓存。
      void voiceCloneService.preloadPhrases(voiceId, COMMON_CLONE_PHRASES).catch((error) => {
        console.warn('[VoiceService] 语音克隆短句预热失败:', error);
      });

      console.log('[VoiceService] cloneVoice: 完成', config);
      return {
        id: voiceId,
        name: config.name,
        status: config.status,
        previewUrl: undefined,
        isCloned: true,
        voiceId: voiceId,
      };
    } catch (error) {
      console.error('[VoiceService] 声音克隆失败:', error);
      return {
        id: 'voice_xiaoxiao',
        name: name || '小小 (女声)',
        status: 'failed',
        previewUrl: undefined,
        isCloned: false,
      };
    }
  },

  /**
   * 获取可用的预设声音列表（已废弃，只返回空数组）
   * 现在只支持克隆声音
   */
  getAvailableVoices: (): VoiceProfile[] => {
    return [];
  },

  /**
   * 文字转语音（Edge TTS，音色可由 voiceId 或当前选中音色决定）
   * @param text 要转换的文本
   * @param voiceId 可选，edge_xxx 表示 Edge 音色，不传则用当前选中
   * @param voiceProfile 可选
   * @returns 返回音频 Blob 的 URL
   */
  synthesize: async (
    text: string,
    voiceId?: string,
    voiceProfile?: VoiceProfile
  ): Promise<string> => {
    if (USE_MOCK_API) {
      return 'mock_audio_url.mp3';
    }

    const target = resolveVoiceTarget(voiceId);
    if (target.kind === 'clone') {
      if (isCloneVoiceInBackoff(target.voiceId)) {
        return synthesizeWithEdgeVoice(text);
      }

      try {
        const result = await voiceCloneService.synthesize(text, target.voiceId, 'zh');
        if (result.success && result.audioUrl) {
          clearCloneVoiceFailure(target.voiceId);
          return result.audioUrl;
        }
        throw new Error(result.error || '语音克隆合成失败');
      } catch (error) {
        markCloneVoiceFailed(target.voiceId, error);
        return synthesizeWithEdgeVoice(text);
      }
    }

    try {
      return synthesizeWithEdgeVoice(text, target.voice);
    } catch (error) {
      console.error('[VoiceService] 语音合成失败:', error);
      throw error;
    }
  },

  /**
   * 直接播放语音（Edge TTS，默认孙女声晓伊）
   * 对话、讲解回忆、相册故事、提醒等均使用此音色。onEnded 播完或出错时回调。
   */
  speak: async (
    text: string,
    voiceId?: string,
    voiceProfile?: VoiceProfile,
    onEnded?: () => void
  ): Promise<void> => {
    if (USE_MOCK_API) {
      console.log(`[VoiceService-MOCK] 正在播放语音: "${text}"`);

      // Use browser's native Web Speech API for audible mock output
      return new Promise<void>((resolve) => {
        // Cancel any pending speech
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 1.0;

        utterance.onend = () => {
          console.log('[VoiceService-MOCK] 播放结束');
          onEnded?.();
          resolve();
        };

        utterance.onerror = (e) => {
          console.error('[VoiceService-MOCK] 播放错误', e);
          // Fallback to timeout if speech synthesis fails
          const duration = Math.min(Math.max(text.length * 200, 1000), 5000);
          setTimeout(() => {
            onEnded?.();
            resolve();
          }, duration);
        };

        window.speechSynthesis.speak(utterance);
      });
    }

    const target = resolveVoiceTarget(voiceId);
    if (target.kind === 'clone') {
      if (isCloneVoiceInBackoff(target.voiceId)) {
        await edgeTTSService.speak(text, DEFAULT_TTS_VOICE, onEnded);
        return;
      }

      try {
        console.log(`[VoiceService] 播放语音: "${text}" (Clone Voice: ${target.voiceId})`);
        await voiceCloneService.speak(text, target.voiceId, 'zh', onEnded);
        clearCloneVoiceFailure(target.voiceId);
        return;
      } catch (error) {
        markCloneVoiceFailed(target.voiceId, error);
        try {
          console.log(`[VoiceService] 播放语音: "${text}" (Edge TTS Fallback: ${DEFAULT_TTS_VOICE})`);
          await edgeTTSService.speak(text, DEFAULT_TTS_VOICE, onEnded);
        } catch (fallbackError) {
          console.error('[VoiceService] ❌ Edge TTS 回退播放失败:', fallbackError);
          onEnded?.();
        }
        return;
      }
    }

    try {
      console.log(`[VoiceService] 播放语音: "${text}" (Edge TTS: ${target.voice})`);
      await edgeTTSService.speak(text, target.voice, onEnded);
    } catch (error) {
      console.error('[VoiceService] ❌ 播放语音失败:', error);
      onEnded?.();
    }
  },

  stop: (): void => {
    if (USE_MOCK_API) {
      window.speechSynthesis.cancel();
      return;
    }
    voiceCloneService.stop();
    edgeTTSService.stop();
  },

  /**
   * 按句优先播放：将文本按 。！？\n 拆成多句，先播第一句，再依次播剩余句。
   */
  speakSegments: async (
    text: string,
    voiceId?: string,
    voiceProfile?: VoiceProfile,
    onEnded?: () => void
  ): Promise<void> => {
    const t = text.trim();
    if (!t) {
      onEnded?.();
      return;
    }
    const segs = t.split(/[。！？\n]+/).map((s) => s.trim()).filter(Boolean);
    if (segs.length <= 1) {
      return VoiceService.speak(t, voiceId, voiceProfile, onEnded);
    }

    const run = async (i: number): Promise<void> => {
      if (i >= segs.length) {
        onEnded?.();
        return;
      }
      try {
        await new Promise<void>((resolve, reject) => {
          VoiceService.speak(segs[i], voiceId, voiceProfile, () => resolve()).catch(reject);
        });
        await run(i + 1);
      } catch {
        onEnded?.();
      }
    };
    run(0);
  },

  /**
   * 预拉当前选中音色的高频短句。Edge TTS 命中本地缓存，克隆音色命中服务端缓存。
   */
  preloadClonePhrases: (voiceId?: string): void => {
    const target = resolveVoiceTarget(voiceId);
    if (target.kind === 'clone') {
      if (isCloneVoiceInBackoff(target.voiceId)) {
        edgeTTSService.preload(COMMON_TTS_PHRASES, DEFAULT_TTS_VOICE).catch(() => { });
        return;
      }

      void voiceCloneService.preloadPhrases(target.voiceId, COMMON_CLONE_PHRASES)
        .then(() => {
          clearCloneVoiceFailure(target.voiceId);
        })
        .catch((error) => {
          markCloneVoiceFailed(target.voiceId, error);
          edgeTTSService.preload(COMMON_TTS_PHRASES, DEFAULT_TTS_VOICE).catch(() => { });
        });
      return;
    }
    edgeTTSService.preload(COMMON_TTS_PHRASES, target.voice).catch(() => { });
  },

  /**
   * 获取所有可用的声音：Edge TTS 可选音色 + 克隆音色（若有）
   */
  getAllVoices: async (): Promise<VoiceProfile[]> => {
    const edgeProfiles: VoiceProfile[] = EDGE_VOICE_OPTIONS.map(o => ({
      id: o.id,
      name: o.name,
      status: 'ready' as const,
      isCloned: false,
      voiceId: o.id,
    }));
    try {
      const clonedVoices = await voiceCloneService.listVoices();
      const clonedProfiles: VoiceProfile[] = clonedVoices.map(v => ({
        id: v.id,
        name: v.name,
        status: v.status,
        isCloned: true,
        voiceId: v.id,
      }));
      return [...edgeProfiles, ...clonedProfiles];
    } catch {
      return edgeProfiles;
    }
  },

  /**
   * 检查 TTS 服务是否可用（Edge TTS 服务）
   */
  checkAvailability: async (): Promise<boolean> => {
    return edgeTTSService.checkConnection();
  },
};

// --- Avatar Generation Service (Ready Player Me - 免费100/月) ---
export const AvatarService = {
  /**
   * 使用Ready Player Me API从照片生成3D头像
   * @param photoFile 照片文件 (推荐正面清晰照片)
   */
  generateAvatar: async (photoFile: File): Promise<AvatarModel> => {
    if (USE_MOCK_API) {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            id: 'avatar_' + Math.random().toString(36).substr(2, 9),
            meshUrl: 'https://models.readyplayer.me/64b7...glb',
            thumbnailUrl: URL.createObjectURL(photoFile),
            status: 'ready'
          });
        }, 5000);
      });
    }

    const apiKey = import.meta.env.VITE_RPM_API_KEY;
    const subdomain = import.meta.env.VITE_RPM_SUBDOMAIN || 'emobit';

    if (!apiKey || apiKey === 'your_ready_player_me_api_key_here') {
      console.warn('[AvatarService] Ready Player Me API Key未配置，使用模拟模式');
      return {
        id: 'avatar_mock_' + Date.now(),
        meshUrl: '',
        thumbnailUrl: URL.createObjectURL(photoFile),
        status: 'ready',
      };
    }

    try {
      // Step 1: 将图片转为Base64
      const base64Image = await fileToBase64(photoFile);

      // Step 2: 创建头像草稿
      const createResponse = await fetch('https://api.readyplayer.me/v2/avatars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          partner: subdomain,
          bodyType: 'fullbody',
          base64Image: base64Image.split(',')[1], // 移除data:image/...;base64,前缀
        }),
      });

      if (!createResponse.ok) {
        const error = await createResponse.json();
        throw new Error(error.message || '创建头像失败');
      }

      const createData = await createResponse.json();
      const avatarId = createData.data?.id || createData.id;

      // Step 3: 保存头像草稿
      await fetch(`https://api.readyplayer.me/v2/avatars/${avatarId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({}),
      });

      // Step 4: 构建GLB模型URL
      const meshUrl = `https://models.readyplayer.me/${avatarId}.glb`;
      const thumbnailUrl = `https://models.readyplayer.me/${avatarId}.png`;

      return {
        id: avatarId,
        meshUrl,
        thumbnailUrl,
        status: 'ready',
      };
    } catch (error) {
      console.error('[AvatarService] 头像生成失败:', error);
      throw error;
    }
  },

  /**
   * 获取头像GLB模型URL
   */
  getAvatarModelUrl: (avatarId: string, options?: {
    quality?: 'low' | 'medium' | 'high';
    morphTargets?: string[];
  }): string => {
    let url = `https://models.readyplayer.me/${avatarId}.glb`;
    const params: string[] = [];

    if (options?.quality) {
      const qualityMap = { low: 'low', medium: 'medium', high: 'high' };
      params.push(`quality=${qualityMap[options.quality]}`);
    }

    if (options?.morphTargets?.length) {
      params.push(`morphTargets=${options.morphTargets.join(',')}`);
    }

    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    return url;
  },

  /**
   * 预加载头像模型（检查是否可访问）
   */
  preloadAvatar: async (avatarId: string): Promise<boolean> => {
    try {
      const response = await fetch(
        `https://models.readyplayer.me/${avatarId}.glb`,
        { method: 'HEAD' }
      );
      return response.ok;
    } catch {
      return false;
    }
  },
};

// --- Helper Functions ---

/**
 * 将File转换为Base64字符串
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * API健康检查
 */
export const ApiHealth = {
  checkElevenLabs: async (): Promise<boolean> => {
    const apiKey = import.meta.env.VITE_ELEVENLABS_API_KEY;
    if (!apiKey || apiKey === 'your_elevenlabs_api_key_here') return false;

    try {
      const response = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': apiKey },
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  checkReadyPlayerMe: async (): Promise<boolean> => {
    const apiKey = import.meta.env.VITE_RPM_API_KEY;
    if (!apiKey || apiKey === 'your_ready_player_me_api_key_here') return false;

    try {
      // 简单检查API是否可达
      const response = await fetch('https://api.readyplayer.me/v2/avatars', {
        method: 'OPTIONS',
      });
      return response.ok || response.status === 204;
    } catch {
      return false;
    }
  },

  checkAll: async (): Promise<{
    elevenLabs: boolean;
    readyPlayerMe: boolean;
    amap: boolean;
    funAsr: boolean;
  }> => {
    const [elevenLabs, readyPlayerMe] = await Promise.all([
      ApiHealth.checkElevenLabs(),
      ApiHealth.checkReadyPlayerMe(),
    ]);

    // 高德地图检查（JS API 或 Web 服务任一配置即可）
    const amapJsKey = import.meta.env.VITE_AMAP_JS_KEY;
    const amapWebKey = import.meta.env.VITE_AMAP_WEB_KEY;
    const amap = !!(
      (amapJsKey && amapJsKey !== 'your_amap_js_key_here') ||
      (amapWebKey && amapWebKey !== 'your_amap_web_key_here')
    );

    // FunASR检查
    const funAsrUrl = import.meta.env.VITE_FUNASR_WS_URL;
    const funAsr = !!(funAsrUrl && funAsrUrl !== 'ws://localhost:10095') ||
      funAsrUrl === 'ws://localhost:10095';

    return { elevenLabs, readyPlayerMe, amap, funAsr };
  },
};
