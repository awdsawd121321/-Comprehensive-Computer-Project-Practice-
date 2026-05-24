/**
 * 语音识别服务 - 直接使用浏览器 Web Speech API
 *
 * - 使用浏览器内置语音识别（Chrome/Edge 等）
 * - 无需 FunASR 或其它后端
 * - 需麦克风权限与网络（云端识别）
 */

export interface SpeechRecognitionResult {
    text: string;
    isFinal: boolean;
    confidence?: number;
}

export type OnResultCallback = (result: SpeechRecognitionResult) => void;
export type OnErrorCallback = (error: Error) => void;

export class SpeechRecognitionService {
    private isRecording = false;
    private onResult: OnResultCallback | null = null;
    private onError: OnErrorCallback | null = null;

    /**
     * 检查浏览器是否支持语音识别
     */
    async checkConnection(): Promise<boolean> {
        const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        return !!SpeechRecognition;
    }

    /**
     * 开始语音识别（直接使用浏览器 Web Speech API）
     */
    async startRecognition(
        onResult: OnResultCallback,
        onError?: OnErrorCallback
    ): Promise<void> {
        if (this.isRecording) {
            console.warn('[SpeechService] 已在录音中');
            return;
        }

        this.onResult = onResult;
        this.onError = onError || null;

        console.log('[SpeechService] 使用浏览器语音识别');
        this.startBrowserRecognition(onResult, onError);
    }

    /**
     * 停止语音识别
     */
    stopRecognition(): void {
        this.isRecording = false;
        this.browserRecognitionStopRequested = true;
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (_) {
                /* ignore */
            }
            this.recognition = null;
        }
        console.log('[SpeechService-Browser] Stopped');
    }

    /**
     * 检查是否正在录音
     */
    get recording(): boolean {
        return this.isRecording;
    }

    private recognition: SpeechRecognition | null = null;
    /** 浏览器识别致命错误已上报，避免 not-allowed 等导致的重复 onerror/onend 循环只通知一次 */
    private browserRecognitionErrorReported = false;
    /** 已请求停止（用户松开），onend 时不再自动 start，避免松开后仍一直录音 */
    private browserRecognitionStopRequested = false;

    private startBrowserRecognition(onResult: OnResultCallback, onError?: OnErrorCallback): void {
        const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            const err = new Error('浏览器不支持 Web Speech API');
            onError?.(err);
            return;
        }

        this.browserRecognitionErrorReported = false;
        this.browserRecognitionStopRequested = false;

        try {
            const recognition = new SpeechRecognition();
            recognition.lang = 'zh-CN';
            recognition.continuous = true;
            recognition.interimResults = true;

            recognition.onresult = (event: SpeechRecognitionEvent) => {
                const result = event.results[event.results.length - 1];
                if (result) {
                    const text = result[0].transcript;
                    const isFinal = result.isFinal;

                    console.log('[SpeechService-Browser] Result:', text, 'isFinal:', isFinal);
                    onResult({
                        text,
                        isFinal
                    });
                }
            };

            recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
                const errMsg = String(event.error || '');
                const isFatal = errMsg === 'not-allowed' || event.error === 'aborted' || event.error === 'network';
                if (isFatal) {
                    this.isRecording = false;
                    try {
                        recognition.stop();
                    } catch (_) { /* ignore */ }
                    this.recognition = null;
                }
                if (!this.browserRecognitionErrorReported) {
                    this.browserRecognitionErrorReported = true;
                    const friendlyMessage =
                        errMsg === 'not-allowed'
                            ? '请允许麦克风权限，或点击左侧键盘图标使用文字输入'
                            : errMsg === 'network'
                                ? '网络不可用（浏览器语音依赖云端），请检查网络或使用键盘输入'
                                : errMsg === 'no-speech'
                                    ? '未检测到语音，请重试'
                                    : errMsg;
                    console.error('[SpeechService-Browser] Error:', event.error);
                    onError?.(new Error(friendlyMessage));
                }
            };

            recognition.onend = () => {
                if (this.recognition === null) return;
                if (
                    this.isRecording &&
                    !this.browserRecognitionErrorReported &&
                    !this.browserRecognitionStopRequested
                ) {
                    try {
                        recognition.start();
                    } catch (_) {
                        // ignore
                    }
                }
            };

            recognition.start();
            this.recognition = recognition;
            this.isRecording = true;
            console.log('[SpeechService-Browser] Started');
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            onError?.(err);
        }
    }
}

// 单例导出
export const speechService = new SpeechRecognitionService();
