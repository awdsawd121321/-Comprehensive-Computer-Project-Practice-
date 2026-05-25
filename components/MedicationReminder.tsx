import React, { useEffect, useState } from 'react';
import { Pill, Clock, Check, AlarmClock, X, Droplets, AlertCircle } from 'lucide-react';
import { medicationService, MedicationReminder as ReminderType, MedicationEvent, Medication } from '../services/medicationService';

interface MedicationReminderProps {
    onTaken?: () => void;
    onSnooze?: () => void;
    onDismiss?: () => void;
}

/**
 * 服药提醒弹窗组件
 */
const MedicationReminder: React.FC<MedicationReminderProps> = ({
    onTaken,
    onSnooze,
    onDismiss,
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [reminder, setReminder] = useState<ReminderType | null>(null);
    const [showConfirmation, setShowConfirmation] = useState(false);

    // 订阅服药事件
    useEffect(() => {
        // 开始监控服药时间
        medicationService.startMonitoring();

        const unsubscribe = medicationService.subscribe((event: MedicationEvent) => {
            console.log('[MedicationReminder] 收到事件:', event.type);

            if (event.type === 'reminder') {
                setReminder({
                    medication: event.medication,
                    scheduledTime: event.scheduledTime,
                    isActive: true,
                    snoozeCount: 0,
                });
                setIsVisible(true);
                setShowConfirmation(false);
            } else if (event.type === 'taken') {
                setShowConfirmation(true);
                setTimeout(() => {
                    setIsVisible(false);
                    setShowConfirmation(false);
                }, 3000);
            } else if (event.type === 'snooze') {
                setIsVisible(false);
            }
        });

        return () => {
            unsubscribe();
            medicationService.stopMonitoring();
        };
    }, []);

    // 确认服药
    const handleTaken = () => {
        medicationService.confirmTaken();
        onTaken?.();
    };

    // 延后提醒
    const handleSnooze = () => {
        medicationService.snoozeReminder(10);
        onSnooze?.();
    };

    // 关闭
    const handleDismiss = () => {
        setIsVisible(false);
        onDismiss?.();
    };

    if (!isVisible || !reminder) return null;

    return (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in">
            <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden animate-scale-in">
                {/* 成功确认界面 */}
                {showConfirmation ? (
                    <div className="p-8 text-center">
                        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                            <Check className="w-10 h-10 text-green-500" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-800 mb-2">已记录服药</h2>
                        <p className="text-slate-500">记得多喝水哦~</p>
                    </div>
                ) : (
                    <>
                        {/* 头部 */}
                        <div className="bg-gradient-to-r from-indigo-500 to-purple-500 p-6 text-white relative">
                            <button
                                onClick={handleDismiss}
                                className="absolute top-4 right-4 w-8 h-8 bg-white/20 rounded-full flex items-center justify-center"
                            >
                                <X size={18} />
                            </button>

                            <div className="flex items-center gap-4">
                                <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
                                    <Pill size={32} className="animate-pulse" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold">该吃药啦</h2>
                                    <p className="text-white/80 text-sm flex items-center gap-1 mt-1">
                                        <Clock size={14} />
                                        {reminder.scheduledTime}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* 药物信息 */}
                        <div className="p-6">
                            <div className="bg-slate-50 rounded-2xl p-4 mb-4">
                                <div className="flex items-start gap-4">
                                    {reminder.medication.imageUrl ? (
                                        <img
                                            src={reminder.medication.imageUrl}
                                            alt={reminder.medication.name}
                                            className="w-16 h-16 rounded-xl object-cover"
                                        />
                                    ) : (
                                        <div className="w-16 h-16 bg-indigo-100 rounded-xl flex items-center justify-center">
                                            <Pill size={24} className="text-indigo-500" />
                                        </div>
                                    )}
                                    <div className="flex-1">
                                        <h3 className="text-lg font-bold text-slate-800">
                                            {reminder.medication.name}
                                        </h3>
                                        <p className="text-indigo-600 font-medium">
                                            {reminder.medication.dosage}
                                        </p>
                                        <p className="text-slate-500 text-sm mt-1">
                                            {reminder.medication.purpose}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* 服用说明 */}
                            <div className="flex items-start gap-2 mb-6 bg-amber-50 p-3 rounded-xl">
                                <AlertCircle size={18} className="text-amber-500 mt-0.5" />
                                <p className="text-amber-700 text-sm">
                                    {reminder.medication.instructions}
                                </p>
                            </div>

                            {/* 操作按钮 */}
                            <div className="space-y-3">
                                {/* 确认服药 */}
                                <button
                                    onClick={handleTaken}
                                    className="w-full flex items-center justify-center gap-3 py-4 px-6 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-2xl font-bold text-lg shadow-lg hover:shadow-xl transition-all active:scale-95"
                                >
                                    <Check size={24} />
                                    我已服药
                                </button>

                                {/* 延后提醒 */}
                                <button
                                    onClick={handleSnooze}
                                    className="w-full flex items-center justify-center gap-3 py-3 px-6 bg-slate-100 text-slate-700 rounded-2xl font-medium hover:bg-slate-200 transition-colors"
                                >
                                    <AlarmClock size={20} />
                                    10分钟后提醒
                                </button>
                            </div>

                            {/* 提醒喝水 */}
                            <div className="mt-4 flex items-center justify-center gap-2 text-blue-500 text-sm">
                                <Droplets size={16} />
                                <span>记得用温水送服</span>
                            </div>
                        </div>
                    </>
                )}
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

export default MedicationReminder;
