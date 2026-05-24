/**
 * Web Speech API 服务
 * 使用浏览器原生 API 实现实时语音识别
 */

export interface WebSpeechResult {
    transcript: string;
    isFinal: boolean;
}

type SpeechCallback = (result: WebSpeechResult) => void;
type ErrorCallback = (error: string) => void;

class WebSpeechService {
    private recognition: any = null;
    private isListening: boolean = false;
    private onResultCallback: SpeechCallback | null = null;
    private onErrorCallback: ErrorCallback | null = null;

    constructor() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            // @ts-ignore
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false; // 设为 false 以便每句话结束后停止，简化逻辑
            this.recognition.interimResults = true;
            this.recognition.lang = 'zh-CN';

            this.recognition.onresult = (event: any) => {
                let finalTranscript = '';
                let interimTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }

                if (this.onResultCallback) {
                    this.onResultCallback({
                        transcript: finalTranscript || interimTranscript,
                        isFinal: !!finalTranscript
                    });
                }
            };

            this.recognition.onerror = (event: any) => {
                console.error('[WebSpeech] Error:', event.error);
                if (this.onErrorCallback) {
                    this.onErrorCallback(event.error);
                }
                this.isListening = false;
            };

            this.recognition.onend = () => {
                this.isListening = false;
                console.log('[WebSpeech] End');
            };
        } else {
            console.warn('[WebSpeech] Browser does not support Speech Recognition');
        }
    }

    start(onResult: SpeechCallback, onError?: ErrorCallback) {
        if (!this.recognition) return;
        if (this.isListening) this.stop();

        this.onResultCallback = onResult;
        this.onErrorCallback = onError || null;

        try {
            this.recognition.start();
            this.isListening = true;
        } catch (e) {
            console.error('[WebSpeech] Failed to start:', e);
        }
    }

    stop() {
        if (!this.recognition) return;
        try {
            this.recognition.stop();
        } catch (e) { }
        this.isListening = false;
    }

    isSupported() {
        return !!this.recognition;
    }
}

export const webSpeechService = new WebSpeechService();
