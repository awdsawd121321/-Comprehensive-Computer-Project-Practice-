/**
 * 语音克隆服务 - 使用 IndexTTS2
 * 支持零样本语音克隆，仅需 3–10 秒音频样本即可克隆声音
 * IndexTTS2: https://github.com/index-tts/index-tts
 */

import { USE_MOCK_API } from './api';

export interface VoiceCloneConfig {
    id: string;
    name: string;
    status: 'processing' | 'ready' | 'failed';
    createdAt?: number;
}

export interface VoiceCloneResult {
    success: boolean;
    audioUrl?: string;
    error?: string;
    voiceId?: string;
}

class VoiceCloneService {
    private wsUrl: string;
    private ws: WebSocket | null = null;
    private pendingRequests: Map<number, {
        resolve: (result: any) => void;
        reject: (error: Error) => void;
    }> = new Map();
    private requestId = 0;

    constructor() {
        this.wsUrl = import.meta.env.VITE_VOICE_CLONE_WS_URL || 'ws://localhost:10097';
        console.log('[VoiceClone] WebSocket URL:', this.wsUrl);
    }

    /**
     * 检查服务是否可用
     */
    async checkConnection(): Promise<boolean> {
        return new Promise((resolve) => {
            let done = false;
            const finish = (ok: boolean) => {
                if (done) return;
                done = true;
                resolve(ok);
            };
            try {
                if (USE_MOCK_API) {
                    // Mock mode always returns true but doesn't actually connect
                    console.log('[VoiceClone-MOCK] checkConnection: 模拟模式，跳过连接检查');
                    resolve(true);
                    return;
                }

                console.log('[VoiceClone] checkConnection: 连接中...', this.wsUrl);
                const testWs = new WebSocket(this.wsUrl);
                testWs.onopen = () => {
                    console.log('[VoiceClone] checkConnection: 连接成功');
                    testWs.close();
                    finish(true);
                };
                testWs.onerror = () => {
                    console.warn('[VoiceClone] checkConnection: 连接失败');
                    finish(false);
                };
                setTimeout(() => {
                    testWs.close();
                    finish(false);
                }, 3000);
            } catch (e) {
                console.warn('[VoiceClone] checkConnection: 异常', e);
                finish(false);
            }
        });
    }

    /**
     * 将音频文件转换为Base64
     */
    private async fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                // 移除 data:audio/...;base64, 前缀
                const base64 = result.split(',')[1] || result;
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    /**
     * 将Blob转换为Base64
     */
    private async blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                const base64 = result.split(',')[1] || result;
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * 发送WebSocket请求
     */
    private async sendRequest(action: string, data: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (USE_MOCK_API) {
                // Mock response for requests
                console.log(`[VoiceClone-MOCK] sendRequest: ${action} - 模拟成功`);
                if (action === 'check_status') {
                    resolve({ success: true, model_ready: true, has_model: true });
                } else if (action === 'list_voices') {
                    resolve({ success: true, voices: [] });
                } else {
                    resolve({ success: true });
                }
                return;
            }

            try {
                const reqId = ++this.requestId;
                const payload = { action, ...data };
                const payloadSize = JSON.stringify(payload).length;
                console.log(`[VoiceClone] sendRequest: action=${action}, payloadSize=${payloadSize}`);

                const ws = new WebSocket(this.wsUrl);

                ws.onopen = () => {
                    console.log(`[VoiceClone] sendRequest: WS 已连接 (readyState=${ws.readyState}), 发送 ${action}`);
                    try {
                        const jsonStr = JSON.stringify(payload);
                        console.log(`[VoiceClone] sendRequest: 发送 JSON 长度=${jsonStr.length}, 前100字符=${jsonStr.substring(0, 100)}`);
                        ws.send(jsonStr);
                        console.log(`[VoiceClone] sendRequest: 消息已发送`);
                    } catch (e) {
                        console.error(`[VoiceClone] sendRequest: 发送失败`, e);
                        reject(new Error('发送消息失败: ' + (e instanceof Error ? e.message : String(e))));
                    }
                };

                // synthesize/clone_and_speak 推理较慢（可能 2-3 分钟），设置更长的超时
                const timeoutMs = action === 'synthesize' || action === 'clone_and_speak' ? 300000 : 15000; // 5 分钟
                const tid = setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                        ws.close();
                        reject(new Error('请求超时'));
                    }
                }, timeoutMs);

                ws.onmessage = (event) => {
                    clearTimeout(tid);
                    try {
                        const response = JSON.parse(event.data);
                        ws.close();
                        if (response.error) {
                            console.warn(`[VoiceClone] sendRequest: ${action} 错误`, response.error);
                            reject(new Error(response.error));
                        } else {
                            console.log(`[VoiceClone] sendRequest: ${action} 成功`);
                            resolve(response);
                        }
                    } catch (e) {
                        ws.close();
                        console.warn('[VoiceClone] sendRequest: 解析响应失败', e);
                        reject(new Error('解析响应失败'));
                    }
                };

                ws.onerror = (e) => {
                    clearTimeout(tid);
                    console.error('[VoiceClone] sendRequest: WS 错误', e, 'readyState=', ws.readyState);
                    try {
                        ws.close();
                    } catch { }
                    reject(new Error('语音克隆服务连接失败，请确保 voice_clone_server 已启动'));
                };

                ws.onclose = (e) => {
                    if (ws.readyState === WebSocket.CLOSED) {
                        console.warn(`[VoiceClone] sendRequest: WS 关闭 (code=${e.code}, reason=${e.reason || 'none'}, wasClean=${e.wasClean})`);
                    }
                };
            } catch (error) {
                reject(new Error('无法连接语音克隆服务'));
            }
        });
    }

    /**
     * 注册声音样本（上传音频并保存）
     * @param audioFile 音频文件 (推荐3-10秒，WAV/MP3格式)
     * @param voiceId 声音ID（唯一标识）
     * @param voiceName 声音名称（显示用）
     */
    async registerVoice(
        audioFile: File | Blob,
        voiceId: string,
        voiceName: string
    ): Promise<VoiceCloneConfig> {
        try {
            console.log('[VoiceClone] registerVoice: 开始', { voiceId, voiceName });
            const base64 = audioFile instanceof File
                ? await this.fileToBase64(audioFile)
                : await this.blobToBase64(audioFile);
            console.log('[VoiceClone] registerVoice: Base64 长度', base64.length);

            const response = await this.sendRequest('register_voice', {
                voice_sample: base64,
                voice_id: voiceId,
                voice_name: voiceName
            });

            console.log('[VoiceClone] registerVoice: 完成', response);
            return {
                id: voiceId,
                name: voiceName,
                status: 'ready',
                createdAt: Date.now()
            };
        } catch (error) {
            console.error('[VoiceClone] 注册声音失败:', error);
            throw error;
        }
    }

    /**
     * 使用克隆声音合成语音
     * @param text 要合成的文本
     * @param voiceId 已注册的声音ID
     * @param language 语言代码 (zh=中文, en=英文)
     */
    async synthesize(
        text: string,
        voiceId: string,
        language: string = 'zh'
    ): Promise<VoiceCloneResult> {
        try {
            console.log('[VoiceClone] synthesize: 开始', { text: text.slice(0, 30), voiceId });
            const response = await this.sendRequest('synthesize', {
                text,
                voice_id: voiceId,
                language
            });

            if (response.success && response.audio) {
                // 将Base64转换为Blob URL
                const audioBlob = this.base64ToBlob(response.audio, 'audio/wav');
                const audioUrl = URL.createObjectURL(audioBlob);
                return {
                    success: true,
                    audioUrl,
                    voiceId: response.voice_id
                };
            } else {
                return {
                    success: false,
                    error: response.error || '合成失败'
                };
            }
        } catch (error) {
            console.error('[VoiceClone] 语音合成失败:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '合成失败'
            };
        }
    }

    /**
     * 一次性克隆并合成（不需要先注册）
     * @param text 要合成的文本
     * @param audioFile 声音样本文件
     * @param language 语言代码
     */
    async cloneAndSpeak(
        text: string,
        audioFile: File | Blob,
        language: string = 'zh'
    ): Promise<VoiceCloneResult> {
        try {
            // 转换为Base64
            const base64 = audioFile instanceof File
                ? await this.fileToBase64(audioFile)
                : await this.blobToBase64(audioFile);

            // 发送克隆并合成请求
            const response = await this.sendRequest('clone_and_speak', {
                text,
                voice_sample: base64,
                voice_id: 'temp_' + Date.now(),
                language
            });

            if (response.success && response.audio) {
                // 将Base64转换为Blob URL
                const audioBlob = this.base64ToBlob(response.audio, 'audio/wav');
                const audioUrl = URL.createObjectURL(audioBlob);
                return {
                    success: true,
                    audioUrl,
                    voiceId: response.voice_id
                };
            } else {
                return {
                    success: false,
                    error: response.error || '克隆合成失败'
                };
            }
        } catch (error) {
            console.error('[VoiceClone] 克隆合成失败:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '克隆合成失败'
            };
        }
    }

    /**
     * 检查服务状态（模型是否就绪）
     */
    async checkStatus(): Promise<{ modelReady: boolean; hasModel: boolean }> {
        try {
            const response = await this.sendRequest('check_status', {});
            if (response.success) {
                return {
                    modelReady: response.model_ready || false,
                    hasModel: response.has_model || false
                };
            }
            return { modelReady: false, hasModel: false };
        } catch (error) {
            console.error('[VoiceClone] 检查状态失败:', error);
            return { modelReady: false, hasModel: false };
        }
    }

    /**
     * 获取所有已注册的声音列表
     */
    async listVoices(): Promise<VoiceCloneConfig[]> {
        try {
            console.log('[VoiceClone] listVoices: 请求列表');
            const response = await this.sendRequest('list_voices', {});

            if (response.success && response.voices) {
                console.log('[VoiceClone] listVoices: 共', response.voices.length, '个');
                return response.voices.map((v: any) => ({
                    id: v.id,
                    name: v.name,
                    status: 'ready' as const
                }));
            }

            return [];
        } catch (error) {
            console.error('[VoiceClone] 获取声音列表失败:', error);
            return [];
        }
    }

    private currentAudio: HTMLAudioElement | null = null;

    /**
     * 直接播放语音（使用克隆声音）
     */
    async speak(
        text: string,
        voiceId: string,
        language: string = 'zh',
        onEnded?: () => void
    ): Promise<void> {
        this.stop();
        const result = await this.synthesize(text, voiceId, language);

        if (result.success && result.audioUrl) {
            const audio = new Audio(result.audioUrl);
            this.currentAudio = audio;
            try {
                await audio.play();
                audio.onended = () => {
                    this.currentAudio = null;
                    URL.revokeObjectURL(result.audioUrl!);
                    onEnded?.();
                };
            } catch (err) {
                console.error("Audio playback failed", err);
                this.currentAudio = null;
                URL.revokeObjectURL(result.audioUrl!);
                throw err instanceof Error ? err : new Error(String(err));
            }
        } else {
            console.error('[VoiceClone] 播放失败:', result.error);
            throw new Error(result.error || '语音克隆播放失败');
        }
    }

    stop(): void {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.currentAudio = null;
        }
    }

    /**
     * 预拉常用句并触发服务端缓存，不播放。后续相同 (text, voiceId) 合成可命中缓存近即时返回。
     */
    async preloadPhrases(voiceId: string, texts: string[]): Promise<void> {
        for (const text of texts) {
            try {
                const r = await this.synthesize(text, voiceId, 'zh');
                if (r.success && r.audioUrl) {
                    URL.revokeObjectURL(r.audioUrl);
                }
            } catch {
                /* ignore */
            }
        }
    }

    /**
     * Base64转Blob
     */
    private base64ToBlob(base64: string, mimeType: string): Blob {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }
}

// 单例导出
export const voiceCloneService = new VoiceCloneService();
