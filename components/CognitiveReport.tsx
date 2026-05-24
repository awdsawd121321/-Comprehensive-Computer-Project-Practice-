import React, { useEffect, useState } from 'react';
import { Brain, TrendingUp, TrendingDown, Minus, MessageSquare, Clock, Heart, MapPin, Users, AlertTriangle, ChevronDown, X, Calendar, Pill, Activity } from 'lucide-react';
import { cognitiveService, DailyReport, CognitiveScore, CognitiveTrend } from '../services/cognitiveService';

interface CognitiveReportProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * 认知评估报告组件
 */
const CognitiveReport: React.FC<CognitiveReportProps> = ({ isOpen, onClose }) => {
    const [report, setReport] = useState<DailyReport | null>(null);
    const [trend, setTrend] = useState<CognitiveTrend | null>(null);
    const [selectedTab, setSelectedTab] = useState<'today' | 'trend'>('today');

    useEffect(() => {
        if (isOpen) {
            setReport(cognitiveService.getTodayReport());
            setTrend(cognitiveService.getTrend(7));
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const getLevelColor = (level: CognitiveScore['level']) => {
        switch (level) {
            case 'excellent': return 'text-green-500 bg-green-50';
            case 'good': return 'text-blue-500 bg-blue-50';
            case 'moderate': return 'text-amber-500 bg-amber-50';
            case 'concern': return 'text-red-500 bg-red-50';
        }
    };

    const getLevelText = (level: CognitiveScore['level']) => {
        switch (level) {
            case 'excellent': return '优秀';
            case 'good': return '良好';
            case 'moderate': return '一般';
            case 'concern': return '需关注';
        }
    };

    const getTrendIcon = (t: CognitiveTrend['trend']) => {
        switch (t) {
            case 'improving': return <TrendingUp className="text-green-500" size={20} />;
            case 'declining': return <TrendingDown className="text-red-500" size={20} />;
            default: return <Minus className="text-slate-400" size={20} />;
        }
    };

    const getDimensionIcon = (dimension: string) => {
        switch (dimension) {
            case 'memory': return <Brain size={18} />;
            case 'language': return <MessageSquare size={18} />;
            case 'orientation': return <Clock size={18} />;
            case 'emotion': return <Heart size={18} />;
            case 'social': return <Users size={18} />;
            default: return <Brain size={18} />;
        }
    };

    const dimensions = [
        { key: 'memory', label: '记忆力', value: report?.score.memory || 0 },
        { key: 'language', label: '语言能力', value: report?.score.language || 0 },
        { key: 'orientation', label: '定向力', value: report?.score.orientation || 0 },
        { key: 'emotion', label: '情绪稳定', value: report?.score.emotion || 0 },
        { key: 'social', label: '社交互动', value: report?.score.social || 0 },
    ];

    return (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden animate-scale-in">
                {/* 头部 */}
                <div className="bg-gradient-to-r from-purple-500 to-indigo-500 p-6 text-white relative">
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 w-8 h-8 bg-white/20 rounded-full flex items-center justify-center"
                    >
                        <X size={18} />
                    </button>

                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
                            <Brain size={32} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">认知健康报告</h2>
                            <p className="text-white/80 text-sm flex items-center gap-1 mt-1">
                                <Calendar size={14} />
                                {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
                            </p>
                        </div>
                    </div>

                    {/* 综合评分 */}
                    <div className="mt-6 flex items-end justify-between">
                        <div>
                            <div className="text-5xl font-black">{report?.score.total || '--'}</div>
                            <div className="text-white/60 text-sm">综合评分</div>
                        </div>
                        <div className={`px-4 py-2 rounded-full text-sm font-bold ${getLevelColor(report?.score.level || 'good')}`}>
                            {getLevelText(report?.score.level || 'good')}
                        </div>
                    </div>
                </div>

                {/* Tab切换 */}
                <div className="flex border-b border-slate-100">
                    <button
                        onClick={() => setSelectedTab('today')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${selectedTab === 'today'
                            ? 'text-indigo-600 border-b-2 border-indigo-600'
                            : 'text-slate-400'
                            }`}
                    >
                        今日详情
                    </button>
                    <button
                        onClick={() => setSelectedTab('trend')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${selectedTab === 'trend'
                            ? 'text-indigo-600 border-b-2 border-indigo-600'
                            : 'text-slate-400'
                            }`}
                    >
                        趋势分析
                    </button>
                </div>

                {/* 内容区域 */}
                <div className="p-4 overflow-y-auto max-h-[50vh]">
                    {selectedTab === 'today' ? (
                        <div className="space-y-4">
                            {/* 五维度评分 */}
                            <div className="bg-slate-50 rounded-2xl p-4">
                                <h3 className="text-sm font-bold text-slate-700 mb-3">五维度评分</h3>
                                <div className="space-y-3">
                                    {dimensions.map(dim => (
                                        <div key={dim.key} className="flex items-center gap-3">
                                            <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-500">
                                                {getDimensionIcon(dim.key)}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex justify-between text-sm mb-1">
                                                    <span className="text-slate-600">{dim.label}</span>
                                                    <span className="font-bold text-slate-800">{dim.value}/20</span>
                                                </div>
                                                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-indigo-400 to-purple-500 rounded-full transition-all duration-500"
                                                        style={{ width: `${(dim.value / 20) * 100}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* 今日统计 */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="bg-blue-50 rounded-xl p-3 text-center">
                                    <MessageSquare className="w-5 h-5 text-blue-500 mx-auto mb-1" />
                                    <div className="text-lg font-bold text-blue-700">{report?.conversationCount || 0}</div>
                                    <div className="text-xs text-blue-500">对话次数</div>
                                </div>
                                <div className="bg-amber-50 rounded-xl p-3 text-center">
                                    <Activity className="w-5 h-5 text-amber-500 mx-auto mb-1" />
                                    <div className="text-lg font-bold text-amber-700">{report?.repetitionCount || 0}</div>
                                    <div className="text-xs text-amber-500">重复询问</div>
                                </div>
                                <div className="bg-green-50 rounded-xl p-3 text-center">
                                    <Pill className="w-5 h-5 text-green-500 mx-auto mb-1" />
                                    <div className="text-lg font-bold text-green-700">{report?.medicationAdherence || 100}%</div>
                                    <div className="text-xs text-green-500">服药率</div>
                                </div>
                            </div>

                            {/* 异常提醒 */}
                            {report?.alerts && report.alerts.length > 0 && (
                                <div className="bg-red-50 rounded-2xl p-4">
                                    <h3 className="text-sm font-bold text-red-700 mb-2 flex items-center gap-2">
                                        <AlertTriangle size={16} />
                                        需要关注
                                    </h3>
                                    <ul className="space-y-1">
                                        {report.alerts.map((alert, i) => (
                                            <li key={i} className="text-sm text-red-600">• {alert}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* 对话摘要 */}
                            {report?.highlights && report.highlights.length > 0 && (
                                <div className="bg-slate-50 rounded-2xl p-4">
                                    <h3 className="text-sm font-bold text-slate-700 mb-2">对话摘要</h3>
                                    <div className="space-y-2">
                                        {report.highlights.map((h, i) => (
                                            <div key={i} className="text-sm text-slate-600 bg-white p-2 rounded-lg">
                                                "{h}"
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* 趋势概览 */}
                            <div className="bg-slate-50 rounded-2xl p-4">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-bold text-slate-700">近7天趋势</h3>
                                    <div className="flex items-center gap-1">
                                        {getTrendIcon(trend?.trend || 'stable')}
                                        <span className="text-sm text-slate-600">
                                            {trend?.trend === 'improving' ? '改善中' :
                                                trend?.trend === 'declining' ? '下降中' : '保持稳定'}
                                        </span>
                                    </div>
                                </div>

                                {/* 简易图表 */}
                                <div className="flex items-end gap-2 h-24">
                                    {(trend?.scores || []).map((score, i) => (
                                        <div key={i} className="flex-1 flex flex-col items-center">
                                            <div
                                                className="w-full bg-gradient-to-t from-indigo-400 to-purple-400 rounded-t transition-all duration-300"
                                                style={{ height: `${score}%` }}
                                            />
                                            <div className="text-xs text-slate-400 mt-1">
                                                {trend?.dates?.[i]?.slice(5) || ''}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* 平均分 */}
                            <div className="bg-indigo-50 rounded-2xl p-4 text-center">
                                <div className="text-3xl font-black text-indigo-600">{trend?.average || '--'}</div>
                                <div className="text-sm text-indigo-500">7天平均分</div>
                            </div>
                        </div>
                    )}
                </div>

                {/* 动画样式 */}
                <style>{`
                    @keyframes fade-in {
                        from { opacity: 0; }
                        to { opacity: 1; }
                    }
                    @keyframes scale-in {
                        from { transform: scale(0.95); opacity: 0; }
                        to { transform: scale(1); opacity: 1; }
                    }
                    .animate-fade-in { animation: fade-in 0.3s ease-out; }
                    .animate-scale-in { animation: scale-in 0.3s ease-out; }
                `}</style>
            </div>
        </div>
    );
};

export default CognitiveReport;
