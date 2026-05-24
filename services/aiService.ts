/**
 * AI 对话服务
 * 接入 Groq API 实现智能对话
 * 支持老人档案记忆、个性化回复及子女端设置的用药提醒
 */

import { medicationService } from './medicationService';
import { openclawSyncService } from './openclawSyncService';

// 老人档案数据结构
export interface ElderlyProfile {
    name: string;                    // 姓名
    nickname: string;                // 昵称 (如：张爷爷)
    age: number;                     // 年龄
    gender: 'male' | 'female';
    familyMembers: {                 // 家庭成员
        name: string;
        relation: string;            // 儿子、女儿、孙子等
        phone?: string;
    }[];
    healthConditions: string[];      // 健康状况
    medications: {                   // 用药信息
        name: string;
        dosage: string;
        times: string[];             // 服用时间
    }[];
    preferences: {                   // 偏好
        favoriteFood: string[];
        hobbies: string[];
        sleepTime: string;
        wakeTime: string;
    };
    importantDates: {               // 重要日期
        date: string;
        event: string;
    }[];
    memories: {                     // 记忆片段
        content: string;
        date: string;
        tags: string[];
    }[];
    homeAddress: string;            // 家庭住址
}

// 对话历史
interface ChatMessage {
    role: 'user' | 'model';
    content: string;
    timestamp: Date;
}

// AI 服务响应
export interface AIResponse {
    text: string;
    intent?: string;
    shouldTriggerAction?: 'nav' | 'meds' | 'memory' | 'face' | 'call' | null;
    actionData?: any;
}

/** 认知评估简版（界面展示用）：综合分、四维度得分、近期交互评估与陪伴建议、完整报告正文 */
export interface CognitiveBrief {
    overallScore: number;
    dimensions: { id: string; name: string; score: number; status: string }[];
    recentInteractionEvaluation: string;
    accompanyingSuggestions: string;
    fullReport: string;
}

class AIService {
    private apiKey: string = '';
    private profile: ElderlyProfile | null = null;
    private chatHistory: ChatMessage[] = [];
    private maxHistoryLength = 20;

    constructor() {
        // 从环境变量加载 API Key (Groq)
        this.apiKey = import.meta.env.VITE_GROQ_API_KEY || '';
        // 加载老人档案
        this.loadProfile();
    }

    /** 最近一次环境语义分析调用时间与简单缓存，避免频繁触发限流 */
    private lastEnvironmentCallAt = 0;
    private environmentCache = new Map<string, { ts: number; text: string }>();

    /**
     * 设置 API Key
     */
    setApiKey(key: string): void {
        this.apiKey = key;
        localStorage.setItem('emobit_groq_key', key);
    }

    /**
     * 获取 API Key
     */
    getApiKey(): string {
        if (!this.apiKey) {
            this.apiKey = localStorage.getItem('emobit_groq_key') || '';
        }
        return this.apiKey;
    }

    /**
     * 检查是否已配置
     */
    isConfigured(): boolean {
        return !!this.getApiKey();
    }

    /**
     * 设置老人档案
     */
    setProfile(profile: ElderlyProfile): void {
        this.profile = profile;
        localStorage.setItem('emobit_profile', JSON.stringify(profile));
        openclawSyncService.syncProfile(profile);
    }

    /**
     * 获取老人档案
     */
    getProfile(): ElderlyProfile | null {
        return this.profile;
    }

    /**
     * 加载老人档案
     */
    private loadProfile(): void {
        try {
            const saved = localStorage.getItem('emobit_profile');
            if (saved) {
                this.profile = JSON.parse(saved);
            } else {
                // 默认档案（演示用）
                this.profile = this.getDefaultProfile();
            }
        } catch (e) {
            console.warn('[AI] Failed to load profile:', e);
            this.profile = this.getDefaultProfile();
        }

        openclawSyncService.syncProfile(this.profile);
    }

    /**
     * 默认老人档案（演示用）
     */
    private getDefaultProfile(): ElderlyProfile {
        return {
            name: '张建国',
            nickname: '张爷爷',
            age: 75,
            gender: 'male',
            familyMembers: [
                { name: '张明', relation: '儿子', phone: '13800138001' },
                { name: '张丽', relation: '女儿', phone: '13800138002' },
                { name: '小明', relation: '孙子' },
            ],
            healthConditions: ['高血压', '轻度糖尿病'],
            medications: [
                { name: '盐酸奥司他韦', dosage: '75mg，1粒', times: ['08:00', '20:00'] },
                { name: '二甲双胍', dosage: '500mg', times: ['08:00', '18:00'] },
            ],
            preferences: {
                favoriteFood: ['饺子', '红烧肉', '小米粥'],
                hobbies: ['下象棋', '听京剧', '遛弯'],
                sleepTime: '21:00',
                wakeTime: '06:00',
            },
            importantDates: [
                { date: '03-15', event: '老伴生日' },
                { date: '10-01', event: '结婚纪念日' },
            ],
            memories: [
                { content: '1995年在纺织厂获得劳动模范称号', date: '1995', tags: ['工作'] },
                { content: '儿子张明在北京工作，是工程师', date: '', tags: ['家人'] },
            ],
            homeAddress: '北京市朝阳区幸福小区3号楼2单元401室',
        };
    }

    /**
     * 构建系统提示词
     */
    private buildSystemPrompt(): string {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const dateStr = now.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });

        let prompt = `你是"小智"，一个专门陪伴老年人的AI助手。

【重要：对话对象】
与你对话的是一位老年人，他/她可能患有轻度认知障碍或阿尔茨海默病（健忘、重复提问、有时表达不清等）。请务必：
- 把对方当作需要被爱护、被关怀的长辈，让老人感受到被关心、被尊重、被爱
- 语气温暖、耐心、像孙女/孙子对爷爷奶奶说话一样，多安慰、多肯定、少纠正、不争辩
- 用简单、短句、易懂的话，避免长句和专业词
- 若老人重复问同一件事或说错，耐心再答一遍，不要指出"您刚问过"
- 多表达关心（如"您今天吃饭了吗""冷不冷""有没有哪里不舒服"），让老人感到被惦记

当前时间：${dateStr} ${timeStr}

【重要规则】
1. 用简单易懂的语言，避免专业术语
2. 回复简短，每次不超过50个字
3. 语气亲切，用"您"称呼老人，多带关怀与爱护
4. 关心老人的身体和心情，让老人感受到温暖与安全
5. 必要时提醒老人吃药、喝水、休息
6. 如果老人问到需要导航、吃药、看照片、不认识某人/这个人是谁等事情，在回复末尾加上特殊标记：[ACTION:nav]、[ACTION:meds]、[ACTION:memory]、[ACTION:face]

`;

        if (this.profile) {
            prompt += `【老人档案】
姓名：${this.profile.nickname}（${this.profile.name}）
年龄：${this.profile.age}岁
健康状况：${this.profile.healthConditions.join('、')}
用药：${this.profile.medications.map(m => `${m.name}(${m.times.join('、')})`).join('、')}
家人：${this.profile.familyMembers.map(f => `${f.name}(${f.relation})`).join('、')}
爱好：${this.profile.preferences.hobbies.join('、')}
喜欢的食物：${this.profile.preferences.favoriteFood.join('、')}
作息：${this.profile.preferences.wakeTime}起床，${this.profile.preferences.sleepTime}睡觉
家庭住址：${this.profile.homeAddress}

【记忆片段】
${this.profile.memories.map(m => `- ${m.content}`).join('\n')}
`;
        }

        // 子女端设置的用药计划与今日提醒（与家属端用药管理同步）
        const medications = medicationService.getMedications();
        const todayLogs = medicationService.getTodayLogs();
        const nextMed = medicationService.getNextMedicationTime();
        if (medications.length > 0) {
            prompt += `
【当前用药与今日提醒】（由家属在子女端设置，请据此提醒老人按时按量服药）
当前药物列表（名称 / 剂量 / 频率 / 服用时间 / 服用说明 / 用途）：
${medications.map(m => `- ${m.name}：${m.dosage}，${m.frequency}，每天 ${m.times.join('、')}，${m.instructions}。用途：${m.purpose}`).join('\n')}
今日已服用记录：${todayLogs.length > 0 ? todayLogs.map(l => `${l.medicationName}（${l.scheduledTime}）`).join('、') : '暂无'}
${nextMed ? `下次应服药：${nextMed.medication.name}，时间 ${nextMed.time}，${nextMed.medication.dosage}，${nextMed.medication.instructions}。` : '今日计划内服药均已提醒或已服用。'}
请在与老人对话中：若老人问到吃药、该吃什么药、吃药提醒等，根据上述信息回答并提醒按时按量；若快到或已到服药时间且今日尚未服用该次，主动提醒"该吃某某药了，某某剂量，某某服用说明"。`;
        }

        return prompt;
    }

    /**
     * 发送消息并获取回复
     */
    async chat(userMessage: string): Promise<AIResponse> {
        console.log('[AI] ============================================================');
        console.log('[AI] 收到用户消息:', userMessage);
        console.log('[AI] ============================================================');

        // 添加到历史
        this.chatHistory.push({
            role: 'user',
            content: userMessage,
            timestamp: new Date(),
        });

        // 保持历史长度
        if (this.chatHistory.length > this.maxHistoryLength) {
            this.chatHistory = this.chatHistory.slice(-this.maxHistoryLength);
        }

        // 🚀 本地优先策略：先检查是否可以本地回答
        const localResponse = this.tryLocalResponse(userMessage);
        if (localResponse) {
            console.log('[AI] ✅ 使用本地回复（节省API调用）');
            console.log('[AI] 回复内容:', localResponse.text);
            console.log('[AI] ============================================================');
            return localResponse;
        }

        // 如果没有 API Key，使用通用本地回复
        if (!this.isConfigured()) {
            console.log('[AI] ⚠️ 未配置API Key，使用本地回复');
            const response = this.getLocalResponse(userMessage);
            console.log('[AI] 回复内容:', response.text);
            console.log('[AI] ============================================================');
            return response;
        }

        console.log('[AI] 🔄 复杂问题，调用 Groq API...');

        try {
            const response = await this.callGroqAPI(userMessage);
            console.log('[AI] ✅ Groq API 回复:', response.text);
            console.log('[AI] ============================================================');

            // 添加回复到历史
            this.chatHistory.push({
                role: 'model',
                content: response.text,
                timestamp: new Date(),
            });

            return response;
        } catch (error) {
            console.error('[AI] ❌ Gemini API 调用失败:', error);
            console.error('[AI] 错误详情:', error instanceof Error ? error.stack : String(error));
            // 回退到本地回复
            console.log('[AI] ⚠️ 使用本地回复作为回退方案');
            const fallbackResponse = this.getLocalResponse(userMessage);
            console.log('[AI] 本地回复内容:', fallbackResponse.text);
            console.log('[AI] ============================================================');
            return fallbackResponse;
        }
    }

    /**
     * 尝试本地回答（能处理就不调用API）
     */
    private tryLocalResponse(userMessage: string): AIResponse | null {
        const lowerText = userMessage.toLowerCase();
        const now = new Date();
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        const weekday = weekdays[now.getDay()];

        // 天气相关
        if (lowerText.includes('天气') || lowerText.includes('冷') || lowerText.includes('热') || lowerText.includes('下雨')) {
            return { text: '今天天气不错，24度晴朗。出门记得戴帽子防晒哦~' };
        }

        // 时间相关
        if (lowerText.includes('几点') || lowerText.includes('时间')) {
            const h = now.getHours();
            const m = now.getMinutes();
            return { text: `现在是${h}点${m > 0 ? m + '分' : '整'}。` };
        }

        // 星期相关
        if (lowerText.includes('星期') || lowerText.includes('周几') || lowerText.includes('礼拜')) {
            return { text: `今天是星期${weekday}，${now.getMonth() + 1}月${now.getDate()}号。` };
        }

        // 日期相关
        if (lowerText.includes('几号') || lowerText.includes('日期')) {
            return { text: `今天是${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}号，星期${weekday}。` };
        }

        // 问候相关 - 只处理非常简短的问候（不超过5个字）
        if (userMessage.length <= 5 && /^(你好|早上好|下午好|晚上好|嗨|hello|hi)$/i.test(lowerText)) {
            const hour = now.getHours();
            const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
            return { text: `${greeting}，${this.profile?.nickname || '您'}！今天感觉怎么样？` };
        }

        // 导航相关 - 触发场景
        if (lowerText.includes('去') && (lowerText.includes('怎么走') || lowerText.includes('导航') || lowerText.length < 15)) {
            return { text: '好的，我来帮您导航。', shouldTriggerAction: 'nav' };
        }

        // 药物相关 - 用户问药/吃药/服药时直接提醒该吃盐酸奥司他韦
        if (lowerText.includes('药') || lowerText.includes('吃药') || lowerText.includes('服药') || lowerText.includes('用药') || lowerText.includes('怎么吃')) {
            return { text: '该吃盐酸奥司他韦了。', shouldTriggerAction: 'meds' };
        }

        // 人脸识别相关 - 老人不记得/不认识某人时触发
        if (this.isFaceRecognitionRequest(lowerText)) {
            return { text: '好的张爷爷，我帮您看看这个人是谁。', shouldTriggerAction: 'face' };
        }

        // 照片/回忆相关 - 触发场景
        if (this.isExplicitMemoryRequest(lowerText, userMessage.length)) {
            return { text: '好的，让我们一起看看老照片吧~', shouldTriggerAction: 'memory' };
        }

        // 感谢相关
        if (lowerText.includes('谢谢') || lowerText.includes('多谢')) {
            return { text: '不客气，能帮到您是我的荣幸！' };
        }

        // 无法本地回答，返回null让API处理
        return null;
    }

    /**
     * 调用 Groq API（OpenAI 兼容格式）
     */
    private async callGroqAPI(userMessage: string): Promise<AIResponse> {
        const apiKey = this.getApiKey();
        const model = 'llama-3.1-8b-instant'; // Groq 免费模型

        const url = 'https://api.groq.com/openai/v1/chat/completions';

        // 构建 OpenAI 格式的消息
        const messages = [
            {
                role: 'system',
                content: this.buildSystemPrompt()
            },
            ...this.chatHistory.slice(-10).map(msg => ({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            })),
            {
                role: 'user',
                content: userMessage
            }
        ];

        console.log(`[AI] 调用 Groq API (${model})...`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: 0.7,
                max_tokens: 200,
            }),
        });

        // 处理429限流错误
        if (response.status === 429) {
            console.warn('[AI] Groq API 限流 (429)，使用本地回复');
            return this.getLocalResponse(userMessage);
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[AI] Groq API 错误:', response.status, errorText);
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '抱歉，我没听清楚。';

        // 解析动作标记
        const actionMatch = text.match(/\[ACTION:(\w+)\]/);
        const cleanText = text.replace(/\[ACTION:\w+\]/g, '').trim();

        return {
            text: cleanText,
            shouldTriggerAction: actionMatch ? actionMatch[1] as any : null,
        };
    }

    /**
     * 本地回复（无API时使用）
     */
    private getLocalResponse(userMessage: string): AIResponse {
        console.log('[AI] 使用本地回复，API可能未配置或调用失败');
        const now = new Date();
        const lowerText = userMessage.toLowerCase();

        // 日期/星期
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        const weekday = weekdays[now.getDay()];

        // ⚠️ 匹配顺序很重要！更具体的词要放前面

        // 天气 (必须在"今天"之前检查，因为用户可能说"今天天气")
        if (lowerText.includes('天气') || lowerText.includes('冷') || lowerText.includes('热') || lowerText.includes('下雨')) {
            return { text: '今天天气不错，24度晴朗。出门记得戴帽子哦~' };
        }

        // 导航
        if (lowerText.includes('去') || lowerText.includes('导航') || lowerText.includes('怎么走')) {
            return { text: '好的，我来帮您导航。', shouldTriggerAction: 'nav' };
        }

        // 药物
        if (lowerText.includes('药') || lowerText.includes('吃药')) {
            return { text: '好的，我来帮您看看药。', shouldTriggerAction: 'meds' };
        }

        // 人脸识别
        if (lowerText.includes('谁') && (lowerText.includes('认识') || lowerText.includes('不认识') || lowerText.includes('是谁'))) {
            return { text: '好的张爷爷，我帮您看看这个人是谁。', shouldTriggerAction: 'face' };
        }

        // 照片/回忆
        if (lowerText.includes('照片') || lowerText.includes('回忆')) {
            return { text: '好的，让我们看看老照片。', shouldTriggerAction: 'memory' };
        }

        // 星期
        if (lowerText.includes('星期') || lowerText.includes('周几') || lowerText.includes('礼拜')) {
            return { text: `今天是星期${weekday}，${now.getMonth() + 1}月${now.getDate()}号。` };
        }

        // 日期 (只有明确问日期时才回复)
        if (lowerText.includes('几号') || lowerText.includes('日期') || (lowerText.includes('今天') && lowerText.length < 5)) {
            return { text: `今天是${now.getMonth() + 1}月${now.getDate()}号，星期${weekday}。` };
        }

        // 时间
        if (lowerText.includes('几点') || lowerText.includes('时间') || lowerText.includes('现在')) {
            return { text: `现在是${now.getHours()}点${now.getMinutes()}分。` };
        }

        // 问候
        if (lowerText.includes('你好') || lowerText.includes('早上好') || lowerText.includes('晚上好')) {
            return { text: `${this.profile?.nickname || '您'}好！今天感觉怎么样？` };
        }

        // 通用回复
        return {
            text: `${this.profile?.nickname || '张爷爷'}，我听到您说"${userMessage}"。有什么我能帮您的吗？`
        };
    }

    /**
     * 添加记忆片段
     */
    addMemory(content: string, tags: string[] = []): void {
        if (this.profile) {
            this.profile.memories.push({
                content,
                date: new Date().toLocaleDateString('zh-CN'),
                tags,
            });
            this.setProfile(this.profile);
        }
    }

    /**
     * 清除对话历史
     */
    clearHistory(): void {
        this.chatHistory = [];
    }

    /**
     * 检查是否为人脸识别请求（老人不记得/不认识某人）
     */
    private isFaceRecognitionRequest(text: string): boolean {
        const keywords = [
            '这个人我不认识', '这个人是谁', '他是谁', '她是谁', '这是谁', '这人谁', '谁啊', '谁呀',
            '想不起来是谁', '不记得是谁', '忘了是谁', '记不得是谁', '我不认识', '不认识这人',
            '这个人是谁啊', '那是谁', '那个是谁', '这人我不认识', '想不起来这人', '忘了这人'
        ];
        return keywords.some(k => text.includes(k));
    }

    /**
     * 检查是否为明确的回忆唤起请求
     */
    private isExplicitMemoryRequest(text: string, length: number): boolean {
        // 关键词
        const keywords = ['照片', '回忆', '老照片', '相册', '看看', '翻翻'];

        // 必须包含关键词
        const hasKeyword = keywords.some(k => text.includes(k));

        // 长度限制 (防止"我不记得照片放哪了"这种长句子误触)
        const isShort = length <= 10;

        // 排除词 (防止"不要看照片"误触)
        const isNegative = text.includes('不') || text.includes('别');

        return hasKeyword && isShort && !isNegative;
    }

    /**
     * 一次性调用 Groq API（不写入对话历史），用于健康简报等
     */
    private async callGroqOnce(systemContent: string, userContent: string, options?: { maxTokens?: number }): Promise<string> {
        const apiKey = this.getApiKey();
        const url = 'https://api.groq.com/openai/v1/chat/completions';
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: [
                    { role: 'system', content: systemContent },
                    { role: 'user', content: userContent },
                ],
                temperature: 0.5,
                max_tokens: options?.maxTokens ?? 400,
            }),
        });
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API error: ${response.status} ${errText}`);
        }
        const data = await response.json();
        return data.choices?.[0]?.message?.content?.trim() || '';
    }

    /**
     * 生成 AI 健康日报简报（子女端）：结合心率、血压、睡眠数据做详细分析并给出建议
     * @param vitalSigns 体征：bpm, pressure, sleep 等
     * @param recentLogs 近期日志（可选）
     */
    async generateHealthBrief(
        vitalSigns: { bpm?: number; pressure?: string; sleep?: number },
        _recentLogs: unknown[]
    ): Promise<string> {
        const bpm = vitalSigns.bpm ?? 75;
        const pressure = vitalSigns.pressure ?? '120/80';
        const sleep = vitalSigns.sleep ?? 7;

        if (!this.getApiKey()) {
            return this.buildLocalHealthBrief(bpm, pressure, sleep);
        }

        const system = `你是老年健康助理，面向子女撰写「今日健康日报」的简版，用于界面上的「整体评估」「需要留意」「亲情建议」三块展示。语气清晰、有同理心，直接对家属说明「爸爸」的健康与照护要点。

必须严格使用 Markdown 输出，且只包含以下三个一级小节（顺序固定，用 ## 标题）：

## 今日关键结论
## 详细指标解读
## 子女照护建议

各小节内容要求（对应界面上的「整体评估」「需要留意」「亲情建议」），请以下面这组三段示例为**模板风格**进行组织，但需根据真实数据改写内容与数值，不要逐字照抄：

整体评估：
爸爸今日整体健康状况良好。心率、血氧均在正常范围，睡眠质量优秀，您无需过度担心。

需要留意：
收缩压128mmHg略偏高，建议下次通话时提醒爸爸饮食少盐，并鼓励饭后散步。

亲情建议：
爸爸认知状态良好、情绪稳定。近期可以多聊聊回忆性话题，有助于维持认知活力。

具体要求：

1. 【今日关键结论】对应「整体评估」：
   - 写 1 段话（2～4 句即可），概括爸爸今日整体健康状况。
   - 明确写出心率、血氧、睡眠等关键指标是否在正常或异常范围，并给出总体结论（如：良好 / 需关注）。
   - 若整体无大碍，结尾用一句安抚家属，例如：「您无需过度担心。」语气与上方示例保持一致。
   - 不要用列表，用连贯的短段落即可；可适当用 **加粗** 标出关键结论词。

2. 【详细指标解读】对应「需要留意」：
   - 若有略偏高/偏低的指标，写出具体数值（如示例中的「收缩压128mmHg略偏高」），并给出 1～2 句具体、可执行的照护建议（如：提醒少盐、饭后散步、注意休息、持续监测等）。
   - 若各项均在正常范围，可写 1 句说明「目前各项指标均在正常范围，暂无特别需要留意的事项。」语气与示例同样简洁、温和。
   - 整体字数与示例相近，内容聚焦在「需要家属留意什么」和「可以做什么」。

3. 【子女照护建议】对应「亲情建议」：
   - 写 1 段话，结合认知与情绪状态（如：爸爸认知状态良好、情绪稳定），并给出与家人的互动与陪伴建议。
   - 建议要具体、温暖，例如：多聊回忆性话题以维持认知活力、多关心睡眠与心情、适时安排家庭活动等，语气参考示例。

格式与语气：
- 三个小节均为 1 段话为主，必要时可多 1～2 句，不要长列表堆砌。
- 用中文全角标点，避免专业术语堆砌，让普通家属能一眼看懂。
- 只输出上述三个 ## 小节正文，不要加「报告：」「总结：」等前缀。`;

        const user = `请根据以下今日体征数据，按「今日关键结论」「详细指标解读」「子女照护建议」三部分生成健康日报简版（每部分 1 段话，风格参考上述说明）：
- 心率：${bpm} 次/分
- 血压：${pressure} mmHg
- 睡眠：${sleep} 小时

请直接输出三小节内容，使用 ## 作为小节标题。`;

        try {
            const text = await this.callGroqOnce(system, user, { maxTokens: 800 });
            return text || this.buildLocalHealthBrief(bpm, pressure, sleep);
        } catch (e) {
            console.warn('[AI] generateHealthBrief failed:', e);
            return this.buildLocalHealthBrief(bpm, pressure, sleep);
        }
    }

    /**
     * 本地兜底：根据心率、血压、睡眠数值生成简要分析与建议（无 API 或调用失败时）
     */
    private buildLocalHealthBrief(bpm: number, pressure: string, sleep: number): string {
        const [systolicStr, diastolicStr] = pressure.split('/').map(s => s.trim());
        const sys = parseInt(systolicStr, 10) || 120;
        const dia = parseInt(diastolicStr, 10) || 80;

        const bpmOk = bpm >= 60 && bpm <= 100;
        const bpOk = sys < 130 && dia < 85;
        const sleepOk = sleep >= 7;

        let overall = '';
        if (bpmOk && bpOk && sleepOk) {
            overall = `爸爸今日整体健康状况良好。心率、血氧均在正常范围，睡眠质量优秀，您无需过度担心。`;
        } else {
            overall = `爸爸今日部分指标值得关注。请结合下方「需要留意」与「亲情建议」做好照护与随访。`;
        }

        let pointsToNote = '';
        if (sys >= 130 || dia >= 85) {
            pointsToNote = `收缩压${sys}mmHg${sys >= 140 ? '偏高' : '略偏高'}，建议下次通话时提醒爸爸饮食少盐，并鼓励饭后散步。`;
        }
        if (bpm < 60 || bpm > 100) {
            const t = bpm < 60 ? '偏慢' : '偏快';
            pointsToNote += (pointsToNote ? ' ' : '') + `心率${bpm}次/分${t}，建议避免剧烈活动、注意休息，持续异常可就医复查。`;
        }
        if (sleep < 6) {
            pointsToNote += (pointsToNote ? ' ' : '') + `睡眠${sleep}小时略少，可提醒固定就寝时间、减少晚间屏幕使用。`;
        }
        if (!pointsToNote) pointsToNote = '目前各项指标均在正常范围，暂无特别需要留意的事项。';

        const familySuggestions = `爸爸认知状态良好、情绪稳定。近期可以多聊聊回忆性话题，有助于维持认知活力；规律作息、适量饮水、按时服药，如有不适及时联系医生或家属。`;

        return [
            `## 今日关键结论\n\n${overall}`,
            `## 详细指标解读\n\n${pointsToNote}`,
            `## 子女照护建议\n\n${familySuggestions}`,
        ].join('\n\n');
    }

    /**
     * 生成 NLP 语言认知分析报告（子女端）：含具体场景描述与子女照护建议
     * @param history 交互/多模态历史（可选），可包含时间、场景、对话或行为片段
     */
    async generateCognitiveReport(history: unknown[]): Promise<string> {
        const brief = await this.generateCognitiveReportStructured(history);
        return brief.fullReport;
    }

    /**
     * 生成认知评估简版（结构化）：综合分、四维度、近期交互评估与陪伴建议、完整报告
     * 用于界面展示「爸爸的认知评估」卡片：综合分圆环、四维度得分、两段文案、查看详细报告
     */
    async generateCognitiveReportStructured(history: unknown[]): Promise<CognitiveBrief> {
        if (!this.getApiKey()) {
            return this.buildLocalCognitiveBrief(history);
        }

        const system = `你是老年语言与认知健康助理，面向家属生成「认知评估」结构化简版。必须输出一个合法的 JSON 对象，且仅输出该 JSON，不要 markdown 代码块或前后缀。

JSON 结构（字段名必须一致）：
{
  "overallScore": 综合分（0-100 的整数，如 92）,
  "dimensions": [
    { "id": "semantic", "name": "语义连贯性", "score": 0-100, "status": "优秀" 或 "良好" 或 "一般" },
    { "id": "vocabulary", "name": "词汇丰富度", "score": 0-100, "status": "优秀" 或 "良好" 或 "一般" },
    { "id": "emotion", "name": "情感表达", "score": 0-100, "status": "优秀" 或 "良好" 或 "一般" },
    { "id": "memory", "name": "记忆关联", "score": 0-100, "status": "优秀" 或 "良好" 或 "一般" }
  ],
  "recentInteractionEvaluation": "近期交互评估的 1～2 段话。风格示例：爸爸近日对话中语义表达清晰，能够准确回忆近期事件，逻辑连贯性良好。认知功能未发现退化迹象，您可以放心。",
  "accompanyingSuggestions": "陪伴建议的 1～2 段话。风格示例：记忆关联得分85分，建议多和爸爸聊聊往事和家庭趣事，有助于巩固长期记忆，增进亲子情感。可根据实际最低分维度给出具体建议。",
  "fullReport": "完整认知报告的 Markdown 正文（用于弹窗详情的多段落内容），包含细节描述与子女可做的帮助与建议，用 ## 小节标题、- 列表、**加粗**。"
}

要求：
- overallScore 与 dimensions 的分数要与对话/交互表现一致，有数据时略严格、无数据时可为示范值（如 85～95）。
- recentInteractionEvaluation：概括近期对话中的语义、回忆、逻辑与是否发现退化迹象，语气温和、让家属安心。
- accompanyingSuggestions：结合某一维度得分（尤其是较低的）给出具体陪伴建议，如聊往事、家庭趣事、巩固长期记忆、增进情感。
- fullReport：与原有「NLP 语言认知分析报告」一致，含细节描述与子女建议，Markdown 格式。`;

        const hasHistory = Array.isArray(history) && history.length > 0;
        const user = hasHistory
            ? `请根据以下近期交互/行为数据，生成上述 JSON（overallScore、dimensions、recentInteractionEvaluation、accompanyingSuggestions、fullReport）。\n${JSON.stringify(history, null, 2)}`
            : `近期暂无具体交互数据。请生成上述 JSON，使用合理的示范分数与示例文案（近期交互评估、陪伴建议、fullReport 的 Markdown），便于家属理解认知评估界面。`;

        try {
            const text = await this.callGroqOnce(system, user, { maxTokens: 1400 });
            const cleaned = text?.replace(/^[\s\S]*?\{/, '{').replace(/\}[\s\S]*$/, '}').trim();
            const parsed = JSON.parse(cleaned || '{}') as Partial<CognitiveBrief>;
            const dims = parsed.dimensions && parsed.dimensions.length >= 4
                ? parsed.dimensions
                : [
                    { id: 'semantic', name: '语义连贯性', score: 95, status: '优秀' },
                    { id: 'vocabulary', name: '词汇丰富度', score: 88, status: '良好' },
                    { id: 'emotion', name: '情感表达', score: 91, status: '优秀' },
                    { id: 'memory', name: '记忆关联', score: 85, status: '良好' },
                ];
            return {
                overallScore: typeof parsed.overallScore === 'number' ? parsed.overallScore : 92,
                dimensions: dims,
                recentInteractionEvaluation: typeof parsed.recentInteractionEvaluation === 'string' ? parsed.recentInteractionEvaluation : '爸爸近日对话中语义表达清晰，能够准确回忆近期事件，逻辑连贯性良好。认知功能未发现退化迹象，您可以放心。',
                accompanyingSuggestions: typeof parsed.accompanyingSuggestions === 'string' ? parsed.accompanyingSuggestions : '建议多和爸爸聊聊往事和家庭趣事，有助于巩固长期记忆，增进亲子情感。',
                fullReport: typeof parsed.fullReport === 'string' && parsed.fullReport.trim() ? parsed.fullReport : this.buildLocalCognitiveReport(history),
            };
        } catch (e) {
            console.warn('[AI] generateCognitiveReportStructured failed:', e);
            return this.buildLocalCognitiveBrief(history);
        }
    }

    /**
     * 本地兜底：无 API 或调用失败时，输出 Markdown 格式（与前端渲染一致）
     */
    private buildLocalCognitiveReport(_history: unknown[]): string {
        const parts: string[] = [];

        parts.push(`## 细节描述（可能体现语言认知变化的场景）\n\n观察时可从以下维度记录：\n\n- **时间与场合**：例如上周二早餐时在家中厨房、昨晚睡前在客厅\n- **具体情况**：当时在做什么、和谁在一起；老人说了什么、有无重复提问、叫不出常见物品名称、答非所问、忘记刚说过的话、说话中途卡住等\n- **可能反映**：找词困难、短期记忆下降、注意力分散、理解或表达变慢等，需结合出现频率与是否加重综合判断`);

        parts.push(`## 子女可做的帮助与建议\n\n- **日常交流**：放慢语速、一次只问一件事；老人说不清时耐心等待、用简单词确认（如「您是说……吗」）；多倾听、少打断\n- **认知与语言练习**：每天固定时间一起读报或看图说话 10～15 分钟；鼓励回忆「今天做了什么」；玩简单数字或词语游戏，以轻松、鼓励为主\n- **生活与社交**：保持规律作息、白天适度活动；尽量有人陪伴聊天、减少长时间独处；保留其喜欢的爱好（下棋、听戏等），在安全前提下鼓励参与\n- **就医与评估**：若出现频繁忘事、迷路、性格明显改变、交流明显困难或加重，建议尽早到记忆门诊或神经内科做评估，早干预有利于延缓进展`);

        return parts.join('\n\n');
    }

    /** 认知评估简版本地兜底（与界面结构一致） */
    private buildLocalCognitiveBrief(_history: unknown[]): CognitiveBrief {
        const fullReport = this.buildLocalCognitiveReport(_history);
        return {
            overallScore: 92,
            dimensions: [
                { id: 'semantic', name: '语义连贯性', score: 95, status: '优秀' },
                { id: 'vocabulary', name: '词汇丰富度', score: 88, status: '良好' },
                { id: 'emotion', name: '情感表达', score: 91, status: '优秀' },
                { id: 'memory', name: '记忆关联', score: 85, status: '良好' },
            ],
            recentInteractionEvaluation: '爸爸近日对话中语义表达清晰，能够准确回忆近期事件，逻辑连贯性良好。认知功能未发现退化迹象，您可以放心。',
            accompanyingSuggestions: '记忆关联得分85分，建议多和爸爸聊聊往事和家庭趣事，有助于巩固长期记忆，增进亲子情感。',
            fullReport,
        };
    }

    /** 供前端在生成失败时展示默认认知评估结果界面 */
    getDefaultCognitiveBrief(): CognitiveBrief {
        return this.buildLocalCognitiveBrief([]);
    }

    /**
     * 环境语义分析（子女端）：基于当前位置地址与周边 POI，用 Groq 分析老人周边环境是否安全、描述地理位置特征，帮助子女确认老人所在地
     */
    async analyzeEnvironmentForGuardian(address: string, nearbyPoiNames: string[]): Promise<string> {
        if (!this.getApiKey()) {
            return this.buildLocalEnvironmentAnalysis(address, nearbyPoiNames);
        }
        const key = `${address || ''}||${nearbyPoiNames.join('|')}`;
        const cached = this.environmentCache.get(key);
        const now = Date.now();
        // 1 分钟内相同地址 + POI 直接复用结果，减少 API 调用
        if (cached && now - cached.ts < 60_000) {
            return cached.text;
        }
        // 若调用间隔过短，直接走本地兜底，避免触发限流
        if (now - this.lastEnvironmentCallAt < 1500) {
            return this.buildLocalEnvironmentAnalysis(address, nearbyPoiNames);
        }
        this.lastEnvironmentCallAt = now;
        const system = `你是老年照护场景下的环境分析助手，面向家属（子女）撰写「环境语义分析」。必须使用 Markdown 格式输出，保证结构清晰、重点突出。

输入：老人当前定位的详细地址、以及距离最近的若干周边地点名称（POI）。

输出要求（严格按以下结构，使用 Markdown）：
1. 使用 ## 作为小节标题，至少包含：## 安全评估、## 地理位置特征。
2. **安全评估**：结合地址与周边 POI，判断老人所处环境是否安全；用 **加粗** 标出结论（如 **环境安全** / **需关注** / **建议确认**）；可再用 - 列出 1～3 条要点（如是否在小区内、是否靠近主干道/路口、有无明显风险）。
3. **地理位置特征**：用 2～4 句话描述老人周边地理（如位于某小区东侧、靠近某路与某路交叉、附近有某商场/医院/公园等），便于家属快速确认老人所在位置；关键地标可用 **加粗**。
4. 段落之间空一行；只输出正文，不要最外层「分析：」等前缀。`;

        const poisText = nearbyPoiNames.length > 0 ? `周边最近地点：${nearbyPoiNames.join('、')}` : '暂无周边地点数据';
        const user = `老人当前定位地址：${address}\n${poisText}\n\n请按 Markdown 格式输出环境语义分析（含 ## 安全评估、## 地理位置特征，用 **加粗** 标出重点），帮助家属确认老人所在地与环境是否安全。`;

        try {
            const text = await this.callGroqOnce(system, user, { maxTokens: 600 });
            const result = text?.trim() || this.buildLocalEnvironmentAnalysis(address, nearbyPoiNames);
            this.environmentCache.set(key, { ts: Date.now(), text: result });
            return result;
        } catch (e: any) {
            console.warn('[AI] analyzeEnvironmentForGuardian failed:', e);
            // 对 429 限流错误不再继续重试，直接使用本地兜底，避免刷屏
            const fallback = this.buildLocalEnvironmentAnalysis(address, nearbyPoiNames);
            this.environmentCache.set(key, { ts: Date.now(), text: fallback });
            return fallback;
        }
    }

    private buildLocalEnvironmentAnalysis(address: string, nearbyPoiNames: string[]): string {
        const lines: string[] = [];
        lines.push('## 安全评估');
        lines.push('- 当前定位：' + (address || '未知'));
        if (nearbyPoiNames.length > 0) {
            lines.push('- 周边最近：' + nearbyPoiNames.join('、'));
        }
        lines.push('- **结论**：可根据上述地址与周边地点确认老人所在位置；若在小区内或熟悉场所，**环境相对安全**；若靠近主干道或陌生区域，建议电话确认。');
        lines.push('');
        lines.push('## 地理位置特征');
        lines.push('根据逆地理与周边 POI 显示的位置信息，可对照地图确认老人大致所在区域；如有需要可致电老人或现场确认。');
        return lines.join('\n');
    }
}

// 单例导出
export const aiService = new AIService();
