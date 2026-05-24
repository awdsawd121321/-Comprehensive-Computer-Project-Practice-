import React, { useEffect, useState } from 'react';
import { healthStateService, AvatarState, HealthMetrics } from '../services/healthStateService';

interface SmartAvatarProps {
    customImageUrl?: string;          // 用户自定义头像图片
    metrics?: Partial<HealthMetrics>; // 健康数据
    isTalking?: boolean;              // 是否在说话
    isListening?: boolean;            // 是否在聆听
    isThinking?: boolean;             // 是否在思考（等 AI 回复）
    size?: 'small' | 'medium' | 'large';
    showStatus?: boolean;             // 是否显示状态信息
    onClick?: () => void;
    mode?: 'cartoon' | 'realistic';   // 模式：卡通/写实
}

/**
 * 智能3D/写实头像组件
 * 根据健康状态动态调整表情和动画
 */
const SmartAvatar: React.FC<SmartAvatarProps> = ({
    customImageUrl,
    metrics,
    isTalking = false,
    isListening = false,
    isThinking = false,
    size = 'medium',
    showStatus = true,
    onClick,
    mode = 'realistic', // 默认为写实模式 (孙辈形象)
}) => {
    const [avatarState, setAvatarState] = useState<AvatarState>(healthStateService.getAvatarState());

    // 默认写实头像 (孙辈)
    const DEFAULT_REALISTIC_AVATAR = '/avatar_grandchild.png';

    // 订阅健康状态变化
    useEffect(() => {
        const unsubscribe = healthStateService.subscribe(setAvatarState);
        // 启动模拟数据（演示用）
        const stopSimulation = healthStateService.startSimulation();
        return () => {
            unsubscribe();
            stopSimulation();
        };
    }, []);

    // 更新健康指标
    useEffect(() => {
        if (metrics) {
            healthStateService.updateMetrics(metrics);
        }
    }, [metrics]);

    // 尺寸映射
    const sizeMap = {
        small: { container: 'w-24 h-28', avatar: 'w-20 h-20', bpm: 'text-xs' },
        medium: { container: 'w-40 h-48', avatar: 'w-32 h-32', bpm: 'text-sm' },
        large: { container: 'w-64 h-72', avatar: 'w-56 h-56', bpm: 'text-base' }, // 稍微调大一点
    };

    const sizeClasses = sizeMap[size];

    // 获取肤色样式 (仅卡通模式)
    const getSkinToneClass = () => {
        switch (avatarState.skinTone) {
            case 'pale': return 'opacity-75 saturate-50';
            case 'flushed': return 'saturate-125 brightness-105';
            default: return '';
        }
    };

    // 获取心情对应的表情 (仅显示在状态栏)
    const getMoodEmoji = () => {
        // 对话情绪优先显示（数字人共情反馈）
        if (avatarState.conversationMood && (avatarState.conversationMoodIntensity ?? 0) > 0.15) {
            switch (avatarState.conversationMood) {
                case 'happy': return '😊';
                case 'sad': return '🥺';
                case 'anxious': return '😌';   // 数字人展示安抚
                case 'angry': return '😊';      // 数字人保持温和
                case 'confused': return '🤗';   // 数字人展示耐心
                case 'lonely': return '🤗';
                default: break;
            }
        }
        switch (avatarState.mood) {
            case 'happy': return '😊';
            case 'tired': return '😮‍💨';
            case 'worried': return '😟';
            case 'sleepy': return '😴';
            default: return '😌';
        }
    };

    // 获取警报级别颜色
    const getAlertColor = () => {
        switch (avatarState.alertLevel) {
            case 'critical': return 'bg-red-500 animate-pulse';
            case 'warning': return 'bg-amber-500';
            case 'attention': return 'bg-blue-500';
            default: return 'bg-emerald-500';
        }
    };

    // 写实模式动画样式
    const getRealisticStyle = () => {
        let transform = 'scale(1)';
        let filter = 'brightness(1)';

        // 呼吸动画
        const breathing = isTalking ? '' : 'animate-[breathing_3s_ease-in-out_infinite]';

        // 说话动画 (简单的缩放模拟)
        const talking = isTalking ? 'animate-[talking_0.2s_ease-in-out_infinite]' : '';

        // 状态滤镜
        if (avatarState.alertLevel === 'critical') filter = 'sepia(0.5) hue-rotate(-50deg) saturate(2)'; // 偏红

        return {
            className: `${breathing} ${talking}`,
            style: { filter }
        };
    };

    // 计算心率显示
    const heartRate = metrics?.heartRate || 72;
    const finalImageUrl = customImageUrl || (mode === 'realistic' ? DEFAULT_REALISTIC_AVATAR : null);

    return (
        <div
            className={`relative ${sizeClasses.container} flex flex-col items-center cursor-pointer select-none`}
            onClick={onClick}
        >
            {/* 主体容器 */}
            <div className={`relative ${sizeClasses.avatar} transition-all duration-500`}>

                {/* 写实模式 / 自定义图片 */}
                {finalImageUrl ? (
                    <div className="relative w-full h-full rounded-full overflow-hidden shadow-xl border-4 border-white ring-2 ring-slate-100">
                        <img
                            src={finalImageUrl}
                            alt="Avatar"
                            className={`w-full h-full object-cover transition-transform duration-300 ${getRealisticStyle().className}`}
                            style={getRealisticStyle().style}
                        />

                        {/* 聆听指示器 (光晕) */}
                        {isListening && (
                            <div className="absolute inset-0 rounded-full border-4 border-indigo-400 animate-pulse bg-indigo-500/10" />
                        )}

                        {/* 思考指示器 (Overlay) */}
                        {isThinking && !isListening && (
                            <div className="absolute inset-0 bg-white/30 flex items-center justify-center animate-pulse">
                                <span className="text-2xl">🤔</span>
                            </div>
                        )}
                    </div>
                ) : (
                    // 卡通模式 (原 SVG/CSS 实现)
                    <div
                        className={`relative w-full h-full rounded-[40%_40%_45%_45%] 
                        bg-gradient-to-br from-slate-100 via-slate-50 to-white
                        shadow-lg border border-slate-200/50 overflow-hidden transition-all duration-500
                        ${getSkinToneClass()}`}
                    >
                        {/* 默认表情 (绘制) */}
                        <>
                            {/* 眼睛 */}
                            <div className="absolute top-[35%] left-1/2 -translate-x-1/2 flex gap-4">
                                <div className="w-2 h-3 bg-slate-700 rounded-full" />
                                <div className="w-2 h-3 bg-slate-700 rounded-full" />
                            </div>

                            {/* 嘴巴 */}
                            <div
                                className={`absolute top-[55%] left-1/2 -translate-x-1/2 transition-all duration-300
                                ${isTalking ? 'w-4 h-4 rounded-full bg-slate-600 animate-[talk_0.15s_ease-in-out_infinite]' :
                                        avatarState.mood === 'happy' ? 'w-6 h-3 rounded-b-full border-b-2 border-slate-600' :
                                            'w-5 h-0.5 bg-slate-500 rounded-full'}`}
                            />
                        </>
                    </div>
                )}

                {/* 心率显示 */}
                <div
                    className={`absolute -bottom-6 left-1/2 -translate-x-1/2 
                    ${sizeClasses.bpm} font-mono text-rose-400 font-bold whitespace-nowrap
                    ${isTalking ? 'opacity-0' : 'opacity-100'} transition-opacity`}
                >
                    <span className="animate-pulse">❤️</span> {heartRate} BPM
                </div>

                {/* 状态指示点 */}
                <div className={`absolute top-0 right-0 w-4 h-4 ${getAlertColor()} rounded-full border-2 border-white shadow-sm z-10`} />
            </div>

            {/* 状态消息 */}
            {showStatus && avatarState.message && !isTalking && (
                <div className="absolute top-[-20px] left-1/2 -translate-x-1/2 px-3 py-1 bg-white/90 backdrop-blur-sm rounded-full shadow-md text-xs text-slate-600 whitespace-nowrap border border-slate-100">
                    {getMoodEmoji()} {avatarState.message}
                </div>
            )}

            {/* CSS动画定义 */}
            <style>{`
                @keyframes breathing {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.03); }
                }
                @keyframes talking {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.02); filter: brightness(1.05); }
                }
                @keyframes talk {
                    0%, 100% { transform: translate(-50%, 0) scaleY(1); }
                    50% { transform: translate(-50%, 0) scaleY(0.5); }
                }
            `}</style>
        </div>
    );
};

export default SmartAvatar;
