/**
 * 认知评估服务
 * 通过分析对话和行为评估老人的认知健康状态
 */

import { openclawSyncService } from './openclawSyncService';
import { emotionService } from './emotionService';

// 对话记录
export interface ConversationLog {
    id: string;
    userMessage: string;        // 老人说的话
    aiResponse: string;         // AI回复
    timestamp: Date;
    sentiment: 'positive' | 'neutral' | 'negative';  // 情绪
    topics: string[];           // 话题标签
}

export interface CognitiveAssessmentItem {
    id: string;
    category: 'time_orientation' | 'location_orientation' | 'person_recognition' | 'memory_repetition' | 'emotion';
    prompt: string;
    response: string;
    score: number;
    maxScore: number;
    notes?: string;
    timestamp: Date;
}

// 认知评分
export interface CognitiveScore {
    memory: number;             // 记忆力 0-20
    language: number;           // 语言能力 0-20
    orientation: number;        // 定向力 0-20
    emotion: number;            // 情绪稳定 0-20
    social: number;             // 社交互动 0-20
    total: number;              // 总分 0-100
    level: 'excellent' | 'good' | 'moderate' | 'concern';  // 等级
}

// 日报数据
export interface DailyReport {
    date: string;               // 日期 YYYY-MM-DD
    score: CognitiveScore;      // 当日评分
    conversationCount: number;  // 对话次数
    repetitionCount: number;    // 重复询问次数
    highlights: string[];       // 重点对话摘要
    alerts: string[];           // 异常提醒
    medicationAdherence: number; // 服药依从率 0-100
    activityLevel: 'low' | 'normal' | 'high';  // 活动水平
}

// 认知趋势
export interface CognitiveTrend {
    dates: string[];
    scores: number[];
    average: number;
    trend: 'improving' | 'stable' | 'declining';
}

class CognitiveService {
    private conversations: ConversationLog[] = [];
    private assessments: CognitiveAssessmentItem[] = [];
    private dailyReports: DailyReport[] = [];
    private maxConversations = 500;  // 保留最近500条对话

    // 关键词词典
    private readonly TIME_KEYWORDS = ['几点', '时间', '星期', '今天', '日期', '几号'];
    private readonly LOCATION_KEYWORDS = ['在哪', '这是哪', '怎么走', '迷路'];
    private readonly NEGATIVE_KEYWORDS = ['不想', '烦', '累', '难受', '疼', '怕'];
    private readonly POSITIVE_KEYWORDS = ['好', '开心', '高兴', '想', '喜欢', '谢谢'];

    constructor() {
        this.loadConversations();
        this.loadAssessments();
        this.loadReports();
        openclawSyncService.syncCognitiveHistory(this.conversations, this.assessments);
    }

    /**
     * 加载对话记录
     */
    private loadConversations(): void {
        try {
            const saved = localStorage.getItem('emobit_conversations');
            if (saved) {
                this.conversations = JSON.parse(saved);
            } else {
                // 模拟对话数据 (演示用)
                this.generateSimulatedConversations();
            }
        } catch (e) {
            console.warn('[Cognitive] 加载对话失败:', e);
        }
    }

    /**
     * 生成模拟对话数据
     */
    private generateSimulatedConversations() {
        const now = new Date();
        const templates = [
            { u: '今天几号了？', a: '今天是1月25日。', t: ['时间定向'], s: 'neutral' },
            { u: '我刚才吃药了吗？', a: '您早餐后已经吃过盐酸奥司他韦了。', t: ['服药', '记忆力'], s: 'neutral' },
            { u: '今天天气不错，我很开心。', a: '是啊，天气真好，您的心情也不错呢！', t: ['情绪'], s: 'positive' },
            { u: '我儿子什么时候回来？', a: '他周末会回来看您。', t: ['家人'], s: 'neutral' },
            { u: '今天几号了？', a: '今天是1月25日，张爷爷。', t: ['时间定向'], s: 'neutral' },
            { u: '我不记得有没有吃药。', a: '别担心，记录显示您早上已经吃过了。', t: ['服药', '记忆力'], s: 'negative' },
            { u: '这里是哪里啊？', a: '这里是您家，在朝阳区。', t: ['空间定向'], s: 'negative' },
            { u: '谢谢你陪我聊天。', a: '不客气，我很喜欢听您讲故事。', t: ['社交'], s: 'positive' },
        ];

        this.conversations = templates.map((t, i) => ({
            id: `sim_${i}`,
            userMessage: t.u,
            aiResponse: t.a,
            timestamp: new Date(now.getTime() - (templates.length - i) * 3600000), // 每小时一条
            sentiment: t.s as any,
            topics: t.t,
        }));
    }

    /**
     * 加载日报
     */
    private loadReports(): void {
        try {
            const saved = localStorage.getItem('emobit_cognitive_reports');
            if (saved) {
                this.dailyReports = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('[Cognitive] 加载报告失败:', e);
        }
    }

    private loadAssessments(): void {
        try {
            const saved = localStorage.getItem('emobit_cognitive_assessments');
            if (saved) {
                this.assessments = JSON.parse(saved);
            } else {
                this.assessments = [];
            }
        } catch (e) {
            console.warn('[Cognitive] 加载评估项失败:', e);
        }
    }

    /**
     * 保存对话记录
     */
    private saveConversations(): void {
        // 只保留最近的记录
        if (this.conversations.length > this.maxConversations) {
            this.conversations = this.conversations.slice(-this.maxConversations);
        }
        localStorage.setItem('emobit_conversations', JSON.stringify(this.conversations));
        openclawSyncService.syncCognitiveHistory(this.conversations, this.assessments);
    }

    /**
     * 保存日报
     */
    private saveReports(): void {
        // 只保留最近30天
        if (this.dailyReports.length > 30) {
            this.dailyReports = this.dailyReports.slice(-30);
        }
        localStorage.setItem('emobit_cognitive_reports', JSON.stringify(this.dailyReports));
    }

    private saveAssessments(): void {
        if (this.assessments.length > this.maxConversations) {
            this.assessments = this.assessments.slice(-this.maxConversations);
        }
        localStorage.setItem('emobit_cognitive_assessments', JSON.stringify(this.assessments));
        openclawSyncService.syncCognitiveHistory(this.conversations, this.assessments);
    }

    /**
     * 记录对话
     */
    recordConversation(userMessage: string, aiResponse: string): void {
        const sentiment = emotionService.toSentiment(userMessage);
        const topics = this.extractTopics(userMessage);

        const log: ConversationLog = {
            id: `conv_${Date.now()}`,
            userMessage,
            aiResponse,
            timestamp: new Date(),
            sentiment,
            topics,
        };

        this.conversations.push(log);
        this.saveConversations();
        openclawSyncService.syncConversation(log);
        this.recordAssessments(userMessage, aiResponse);

        console.log('[Cognitive] 记录对话:', { sentiment, topics });
    }

    private recordAssessments(userMessage: string, aiResponse: string): void {
        const items = this.deriveAssessmentItems(userMessage, aiResponse);
        if (items.length === 0) return;
        this.assessments.push(...items);
        this.saveAssessments();
        items.forEach((item) => openclawSyncService.syncCognitiveAssessment(item));
    }

    private deriveAssessmentItems(userMessage: string, aiResponse: string): CognitiveAssessmentItem[] {
        const items: CognitiveAssessmentItem[] = [];
        const normalized = userMessage.replace(/\s+/g, '');
        const duplicateCount = this.conversations
            .filter((entry) => this.calculateSimilarity(entry.userMessage, userMessage) > 0.75)
            .length;

        if (this.TIME_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
            items.push({
                id: `cog_${Date.now()}_time`,
                category: 'time_orientation',
                prompt: '时间定向',
                response: userMessage,
                score: duplicateCount > 1 ? 0 : 1,
                maxScore: 1,
                notes: duplicateCount > 1 ? '重复询问时间，建议持续观察时间定向能力。' : aiResponse,
                timestamp: new Date(),
            });
        }

        if (this.LOCATION_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
            items.push({
                id: `cog_${Date.now()}_location`,
                category: 'location_orientation',
                prompt: '地点定向',
                response: userMessage,
                score: duplicateCount > 0 ? 0 : 1,
                maxScore: 1,
                notes: duplicateCount > 0 ? '出现地点/路线困惑信号。' : aiResponse,
                timestamp: new Date(),
            });
        }

        if (/他是谁|这是谁|认不出来|不认识/.test(normalized)) {
            items.push({
                id: `cog_${Date.now()}_person`,
                category: 'person_recognition',
                prompt: '人物识别',
                response: userMessage,
                score: 0,
                maxScore: 1,
                notes: '建议结合人脸识别场景继续观察熟人识别能力。',
                timestamp: new Date(),
            });
        }

        if (duplicateCount > 1) {
            items.push({
                id: `cog_${Date.now()}_repeat`,
                category: 'memory_repetition',
                prompt: '重复提问',
                response: userMessage,
                score: Math.max(0, 2 - duplicateCount),
                maxScore: 2,
                notes: `近阶段相似问题出现 ${duplicateCount} 次。`,
                timestamp: new Date(),
            });
        }

        if (this.NEGATIVE_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
            items.push({
                id: `cog_${Date.now()}_emotion`,
                category: 'emotion',
                prompt: '情绪状态',
                response: userMessage,
                score: 0,
                maxScore: 1,
                notes: '检测到焦虑/不适情绪，可结合黄昏守护和家属安抚。',
                timestamp: new Date(),
            });
        }

        return items;
    }

    /**
     * 分析情感倾向
     */
    private analyzeSentiment(text: string): 'positive' | 'neutral' | 'negative' {
        let positiveScore = 0;
        let negativeScore = 0;

        for (const keyword of this.POSITIVE_KEYWORDS) {
            if (text.includes(keyword)) positiveScore++;
        }
        for (const keyword of this.NEGATIVE_KEYWORDS) {
            if (text.includes(keyword)) negativeScore++;
        }

        if (positiveScore > negativeScore) return 'positive';
        if (negativeScore > positiveScore) return 'negative';
        return 'neutral';
    }

    /**
     * 提取话题标签
     */
    private extractTopics(text: string): string[] {
        const topics: string[] = [];

        if (this.TIME_KEYWORDS.some(k => text.includes(k))) topics.push('时间定向');
        if (this.LOCATION_KEYWORDS.some(k => text.includes(k))) topics.push('空间定向');
        if (text.includes('药') || text.includes('吃')) topics.push('服药');
        if (text.includes('家') || text.includes('儿子') || text.includes('女儿')) topics.push('家人');
        if (text.includes('痛') || text.includes('不舒服')) topics.push('健康');

        return topics;
    }

    /**
     * 计算认知评分
     */
    calculateScore(date?: string): CognitiveScore {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const dayConversations = this.conversations.filter(c =>
            c.timestamp.toString().startsWith(targetDate) ||
            new Date(c.timestamp).toISOString().split('T')[0] === targetDate
        );

        // 1. 记忆力评分 (重复询问越少越好)
        const repetitionRate = this.calculateRepetitionRate(dayConversations);
        const memory = Math.max(0, 20 - repetitionRate * 20);

        // 2. 语言能力评分 (词汇多样性)
        const vocabularyDiversity = this.calculateVocabularyDiversity(dayConversations);
        const language = Math.min(20, vocabularyDiversity * 20);

        // 3. 定向力评分 (时间地点询问越少越好)
        const orientationQueries = dayConversations.filter(c =>
            c.topics.includes('时间定向') || c.topics.includes('空间定向')
        ).length;
        const orientation = Math.max(0, 20 - orientationQueries * 2);

        // 4. 情绪稳定评分 (正面情绪越多越好)
        const positiveRatio = dayConversations.filter(c => c.sentiment === 'positive').length /
            Math.max(1, dayConversations.length);
        const negativeRatio = dayConversations.filter(c => c.sentiment === 'negative').length /
            Math.max(1, dayConversations.length);
        const emotion = Math.round(10 + positiveRatio * 10 - negativeRatio * 10);

        // 5. 社交互动评分 (对话越多越好，但有上限)
        const social = Math.min(20, dayConversations.length * 2);

        const total = Math.round(memory + language + orientation + emotion + social);

        let level: CognitiveScore['level'];
        if (total >= 85) level = 'excellent';
        else if (total >= 70) level = 'good';
        else if (total >= 50) level = 'moderate';
        else level = 'concern';

        return {
            memory: Math.round(memory),
            language: Math.round(language),
            orientation: Math.round(orientation),
            emotion: Math.round(emotion),
            social: Math.round(social),
            total,
            level,
        };
    }

    /**
     * 计算重复率
     */
    private calculateRepetitionRate(conversations: ConversationLog[]): number {
        if (conversations.length < 2) return 0;

        let repetitions = 0;
        const messages = conversations.map(c => c.userMessage);

        for (let i = 1; i < messages.length; i++) {
            for (let j = 0; j < i; j++) {
                if (this.calculateSimilarity(messages[i], messages[j]) > 0.7) {
                    repetitions++;
                    break;
                }
            }
        }

        return repetitions / conversations.length;
    }

    /**
     * 计算文本相似度 (简化版)
     */
    private calculateSimilarity(text1: string, text2: string): number {
        const chars1 = new Set(text1);
        const chars2 = new Set(text2);
        const intersection = new Set([...chars1].filter(x => chars2.has(x)));
        const union = new Set([...chars1, ...chars2]);
        return intersection.size / union.size;
    }

    /**
     * 计算词汇多样性 (TTR)
     */
    private calculateVocabularyDiversity(conversations: ConversationLog[]): number {
        const allText = conversations.map(c => c.userMessage).join('');
        const chars = allText.split('').filter(c => c.trim());
        const uniqueChars = new Set(chars);

        if (chars.length === 0) return 0.5;  // 默认中等
        return Math.min(1, uniqueChars.size / chars.length * 5);  // 放大比率
    }

    /**
     * 生成日报
     */
    generateDailyReport(date?: string): DailyReport {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const score = this.calculateScore(targetDate);

        const dayConversations = this.conversations.filter(c =>
            new Date(c.timestamp).toISOString().split('T')[0] === targetDate
        );

        // 检测异常
        const alerts: string[] = [];
        if (score.memory < 10) alerts.push('记忆力下降明显');
        if (score.orientation < 10) alerts.push('定向力需要关注');
        if (score.emotion < 10) alerts.push('情绪状态不佳');

        // 提取重点对话
        const highlights = dayConversations
            .filter(c => c.sentiment !== 'neutral' || c.topics.length > 0)
            .slice(0, 3)
            .map(c => c.userMessage);

        const report: DailyReport = {
            date: targetDate,
            score,
            conversationCount: dayConversations.length,
            repetitionCount: Math.round(this.calculateRepetitionRate(dayConversations) * dayConversations.length),
            highlights,
            alerts,
            medicationAdherence: 100,  // 从服药服务获取
            activityLevel: dayConversations.length > 10 ? 'high' :
                dayConversations.length > 5 ? 'normal' : 'low',
        };

        // 保存日报
        const existingIndex = this.dailyReports.findIndex(r => r.date === targetDate);
        if (existingIndex >= 0) {
            this.dailyReports[existingIndex] = report;
        } else {
            this.dailyReports.push(report);
        }
        this.saveReports();

        return report;
    }

    /**
     * 获取认知趋势
     */
    getTrend(days: number = 7): CognitiveTrend {
        const reports = this.dailyReports.slice(-days);

        const dates = reports.map(r => r.date);
        const scores = reports.map(r => r.score.total);
        const average = scores.length > 0
            ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
            : 75;

        // 计算趋势
        let trend: CognitiveTrend['trend'] = 'stable';
        if (scores.length >= 3) {
            const recent = scores.slice(-3);
            const earlier = scores.slice(0, 3);
            const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
            const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;

            if (recentAvg > earlierAvg + 5) trend = 'improving';
            else if (recentAvg < earlierAvg - 5) trend = 'declining';
        }

        return { dates, scores, average, trend };
    }

    /**
     * 获取今日报告
     */
    getTodayReport(): DailyReport {
        const today = new Date().toISOString().split('T')[0];
        const existing = this.dailyReports.find(r => r.date === today);
        return existing || this.generateDailyReport(today);
    }

    /**
     * 获取所有对话记录
     */
    getConversations(): ConversationLog[] {
        return [...this.conversations];
    }

    getAssessments(limit: number = 40): CognitiveAssessmentItem[] {
        return this.assessments.slice(-limit);
    }

    /**
     * 获取最近N天的报告
     */
    getRecentReports(days: number = 7): DailyReport[] {
        return this.dailyReports.slice(-days);
    }

    /**
     * 生成家属摘要
     */
    generateFamilySummary(): string {
        const report = this.getTodayReport();
        const trend = this.getTrend();

        const levelText = {
            excellent: '优秀',
            good: '良好',
            moderate: '一般',
            concern: '需关注',
        };

        const trendText = {
            improving: '持续改善',
            stable: '保持稳定',
            declining: '有所下降',
        };

        let summary = `【今日认知评估】\n`;
        summary += `综合评分：${report.score.total}分（${levelText[report.score.level]}）\n`;
        summary += `对话次数：${report.conversationCount}次\n`;
        summary += `近期趋势：${trendText[trend.trend]}\n`;

        if (report.alerts.length > 0) {
            summary += `\n⚠️ 需要关注：\n`;
            report.alerts.forEach(alert => {
                summary += `- ${alert}\n`;
            });
        }

        if (report.highlights.length > 0) {
            summary += `\n💬 今日对话摘要：\n`;
            report.highlights.forEach(h => {
                summary += `"${h}"\n`;
            });
        }

        return summary;
    }
}

// 单例导出
export const cognitiveService = new CognitiveService();
