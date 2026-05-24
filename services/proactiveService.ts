/**
 * 主动交互服务
 * 负责监控用户状态，触发主动对话（如吃药提醒、闲聊关怀）
 */

type ProactiveCallback = (message: string, type: 'reminder' | 'chat' | 'checkup') => void;

class ProactiveService {
    private lastInteractionTime: number = Date.now();
    private checkInterval: NodeJS.Timeout | null = null;
    private listeners: ProactiveCallback[] = [];
    private isUserSpeaking: boolean = false; // 用户是否正在说话状态
    private isBusy: boolean = false;         // AI 是否正在忙（思考或说话）

    // 配置
    private IDLE_THRESHOLD = 30 * 1000; // 30秒无操作触发 (用户要求)
    private CHECK_RATE = 5 * 1000;        // 每5秒检查一次

    // 闲聊语料库 - 多样化关怀
    private chatPrompts = [
        "张爷爷，您在干什么呢？",
        "今天天气真不错，要不要听听新闻？",
        "有一会儿没听到您说话了，您还需要什么帮助吗？",
        "记得多喝水哦，对身体好。",
        "要不要给儿子打个可视电话？他可能想您了。",
        "我在看您的老照片，那个公园真漂亮，您还记得吗？",
        "今天身体感觉怎么样？有没有哪里不舒服？",
        "到了做手指操的时间了，我们要不要一起活动活动？",
        "给您放一段您喜欢的京剧怎么样？",
        "我看您坐了好久了，起来走走吧？"
    ];

    constructor() {
    }

    /**
     * 启动服务
     */
    start() {
        if (this.checkInterval) return;

        console.log('[ProactiveService] Started');
        this.resetTimer();

        this.checkInterval = setInterval(() => {
            this.checkStatus();
        }, this.CHECK_RATE);

        // 立即检查一次 (确保首次进入也能触发)
        setTimeout(() => this.checkStatus(), 1000);
    }

    /**
     * 立即触发一次检查 (用于组件加载时)
     */
    triggerImmediately() {
        this.checkStatus();
    }

    /**
     * 停止服务
     */
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    /**
     * 重置交互计时器 (需在用户每次说话/点击时调用)
     */
    resetTimer() {
        this.lastInteractionTime = Date.now();
    }

    /**
     * 订阅主动消息
     */
    subscribe(callback: ProactiveCallback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    /**
     * 触发消息
     */
    private emit(message: string, type: 'reminder' | 'chat' | 'checkup') {
        this.listeners.forEach(cb => cb(message, type));
    }

    /**
     * 触发主动闲聊消息
     */
    private emitProactiveMessage() {
        const randomMsg = this.chatPrompts[Math.floor(Math.random() * this.chatPrompts.length)];
        this.emit(randomMsg, 'chat');
        this.resetTimer(); // 触发后重置，避免连续触发
    }

    /**
     * 设置忙碌状态 (思考中或说话中)
     */
    setBusy(busy: boolean) {
        this.isBusy = busy;
        if (busy) this.resetTimer(); // 忙碌时也重置计时器
    }

    /**
     * 检查是否需要触发
     */
    private checkStatus(force: boolean = false) {
        if (this.isUserSpeaking || this.isBusy) return;

        const now = Date.now();
        const diff = now - this.lastInteractionTime;

        // 触发条件：强制触发 OR 超过阈值且有一定概率触发
        if (force || (diff > this.IDLE_THRESHOLD && Math.random() > 0.3)) {
            this.emitProactiveMessage();
        }

        // 此处还可以接入 medicationService 的检查，或者由 medicationService 独立触发
    }

    /**
     * 外部触发提醒 (例如从 MedicationService 接收到事件后调用)
     */
    triggerReminder(message: string) {
        this.emit(message, 'reminder');
    }
}

export const proactiveService = new ProactiveService();
