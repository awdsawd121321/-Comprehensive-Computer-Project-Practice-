import React, { useEffect, useState } from 'react';
import { AlertTriangle, Phone, MapPin, Home, X, Navigation } from 'lucide-react';
import { wanderingService, WanderingState, WanderingEvent } from '../services/wanderingService';
import { VoiceService } from '../services/api';

interface WanderingAlertProps {
    onNavigateHome?: () => void;
    onCallFamily?: () => void;
    onDismiss?: () => void;
}

/**
 * 游荡警报组件
 * 当检测到老人游荡时显示警报和帮助选项
 */
const WanderingAlert: React.FC<WanderingAlertProps> = ({
    onNavigateHome,
    onCallFamily,
    onDismiss,
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [wanderingState, setWanderingState] = useState<WanderingState | null>(null);
    const [countdown, setCountdown] = useState(30);

    // 订阅游荡事件
    useEffect(() => {
        const unsubscribe = wanderingService.subscribe((event: WanderingEvent) => {
            console.log('[WanderingAlert] 收到事件:', event.type);

            if (event.type === 'wandering_start' || event.type === 'left_safe_zone') {
                setWanderingState(event.state);
                setIsVisible(true);
                setCountdown(30);

                // 语音提醒
                const message = getAlertMessage(event.state);
                VoiceService.speak(message).catch(console.error);
            } else if (event.type === 'wandering_end' || event.type === 'returned_safe') {
                setIsVisible(false);
            }
        });

        return () => unsubscribe();
    }, []);

    // 自动呼叫家人倒计时
    useEffect(() => {
        if (!isVisible) return;

        const timer = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    // 自动呼叫家人
                    handleCallFamily();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [isVisible]);

    // 获取警报消息
    const getAlertMessage = (state: WanderingState): string => {
        switch (state.wanderingType) {
            case 'circling':
                return '张爷爷，您好像在原地打转，是不是迷路了？需要我帮您导航回家吗？';
            case 'pacing':
                return '张爷爷，我注意到您一直在来回走，有什么心事吗？要不要休息一下？';
            case 'lost':
                return `张爷爷，您已经离家${Math.round(state.distanceFromHome)}米了，需要我帮您导航回家吗？`;
            default:
                return '张爷爷，您离开了安全区域，需要帮助吗？';
        }
    };

    // 获取警报标题
    const getAlertTitle = (): string => {
        switch (wanderingState?.wanderingType) {
            case 'circling':
                return '检测到可能迷路';
            case 'pacing':
                return '检测到来回踱步';
            case 'lost':
                return '已离开安全区域';
            default:
                return '需要帮助吗？';
        }
    };

    // 处理导航回家
    const handleNavigateHome = () => {
        setIsVisible(false);
        onNavigateHome?.();
    };

    // 处理呼叫家人
    const handleCallFamily = () => {
        VoiceService.speak('正在联系您的家人...').catch(console.error);
        onCallFamily?.();
    };

    // 处理关闭
    const handleDismiss = () => {
        setIsVisible(false);
        onDismiss?.();
    };

    if (!isVisible || !wanderingState) return null;

    return (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in">
            <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden animate-scale-in">
                {/* 警报头部 */}
                <div className="bg-gradient-to-r from-orange-500 to-red-500 p-6 text-white relative">
                    <button
                        onClick={handleDismiss}
                        className="absolute top-4 right-4 w-8 h-8 bg-white/20 rounded-full flex items-center justify-center"
                    >
                        <X size={18} />
                    </button>

                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center animate-pulse">
                            <AlertTriangle size={32} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">{getAlertTitle()}</h2>
                            <p className="text-white/80 text-sm mt-1">
                                距家 {Math.round(wanderingState.distanceFromHome)} 米
                            </p>
                        </div>
                    </div>
                </div>

                {/* 警报内容 */}
                <div className="p-6">
                    <p className="text-slate-700 text-lg leading-relaxed mb-6">
                        {getAlertMessage(wanderingState)}
                    </p>

                    {/* 操作按钮 */}
                    <div className="space-y-3">
                        {/* 导航回家 */}
                        <button
                            onClick={handleNavigateHome}
                            className="w-full flex items-center justify-center gap-3 py-4 px-6 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-2xl font-bold text-lg shadow-lg hover:shadow-xl transition-shadow"
                        >
                            <Home size={24} />
                            帮我回家
                        </button>

                        {/* 呼叫家人 */}
                        <button
                            onClick={handleCallFamily}
                            className="w-full flex items-center justify-center gap-3 py-4 px-6 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-2xl font-bold text-lg shadow-lg hover:shadow-xl transition-shadow"
                        >
                            <Phone size={24} />
                            联系家人
                        </button>

                        {/* 我没事 */}
                        <button
                            onClick={handleDismiss}
                            className="w-full py-3 text-slate-500 font-medium"
                        >
                            我没事，继续走
                        </button>
                    </div>

                    {/* 自动呼叫倒计时 */}
                    <div className="mt-6 text-center">
                        <p className="text-slate-400 text-sm">
                            {countdown > 0
                                ? `${countdown}秒后将自动联系家人`
                                : '正在联系家人...'
                            }
                        </p>
                        <div className="mt-2 h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-orange-400 transition-all duration-1000"
                                style={{ width: `${(countdown / 30) * 100}%` }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* 动画样式 */}
            <style>{`
                @keyframes fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes scale-in {
                    from { transform: scale(0.9); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                .animate-fade-in {
                    animation: fade-in 0.3s ease-out;
                }
                .animate-scale-in {
                    animation: scale-in 0.3s ease-out;
                }
            `}</style>
        </div>
    );
};

export default WanderingAlert;
