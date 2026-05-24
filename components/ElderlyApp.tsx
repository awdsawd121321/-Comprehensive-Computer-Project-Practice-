import React, { useEffect, useState, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { SimulationType, SystemStatus, MemoryPhoto } from '../types';
import { ALBUM_MEMORIES } from '../config/albumMemories';
import { FACE_RECOGNITION_CONFIG } from '../config/faceRecognition';
import { Mic, Battery, Wifi, Signal, Info, ChevronLeft, ChevronRight, Image as ImageIcon, Images, Volume2, X, CloudSun, Loader2, Navigation, ScanLine, Pill, CheckCircle, ArrowUp, ArrowLeft, ArrowRight, MapPin, Camera, User, ScanFace, Box, AlertCircle, MicOff, Sparkles, Settings, Keyboard, Send, Clock } from 'lucide-react';
import { speechService, SpeechRecognitionResult } from '../services/speechService';
import { mapService, RouteResult, RouteStep } from '../services/mapService';
import { memoryService, LocationEvent } from '../services/memoryService';
import { VoiceService } from '../services/api';
import { voiceSelectionService } from '../services/voiceSelectionService';
import { aiService, AIResponse } from '../services/aiService';
import { wanderingService } from '../services/wanderingService';
import { medicationService, Medication } from '../services/medicationService';
import { faceService, FaceData } from '../services/faceService';
import { cognitiveService, CognitiveAssessmentItem } from '../services/cognitiveService';
import { carePlanService, CarePlanItem } from '../services/carePlanService';
import { openclawSyncService } from '../services/openclawSyncService';
import { openclawActionService } from '../services/openclawActionService';
import { locationAutomationService } from '../services/locationAutomationService';
import { isGuardianOnlyBridgeMessage } from '../utils/openclawMessageGuards';
import { emotionService } from '../services/emotionService';
import { healthStateService } from '../services/healthStateService';
import {
    sundowningService,
    SundowningInterventionPlan,
    SundowningInterventionType,
    SundowningPushAlert,
    SundowningRiskSnapshot,
} from '../services/sundowningService';
import AvatarCreator from './AvatarCreator';
import AvatarVRM from './AvatarVRM';
import ARNavigationOverlay from './ARNavigationOverlay';
import WanderingAlert from './WanderingAlert';
import MedicationReminder from './MedicationReminder';
import CognitiveReport from './CognitiveReport';

interface ElderlyAppProps {
    status: SystemStatus;
    simulation: SimulationType;
    externalMessage?: {
        id: string;
        text: string;
        purpose?: string;
        timestamp?: number;
    } | null;
    externalAction?: {
        id: string;
        action: string;
        payload?: Record<string, unknown>;
        timestamp?: number;
    } | null;
}

// --- Video Avatar Component ---
const VideoAvatar = ({ isTalking, isListening }: { isTalking: boolean, isListening: boolean }) => {
    return (
        <div className={`relative w-[260px] h-[260px] rounded-[3rem] overflow-hidden shadow-2xl transition-all duration-500 flex items-center justify-center bg-slate-100
            ${isTalking ? "scale-105" : "scale-100"}
        `}>
            {/* Interaction Glow */}
            {isTalking && <div className="absolute inset-0 bg-indigo-400 rounded-[3rem] blur-2xl opacity-40 animate-pulse pointer-events-none z-20"></div>}
            {isListening && <div className="absolute inset-0 bg-emerald-400 rounded-[3rem] blur-2xl opacity-40 animate-pulse pointer-events-none z-20"></div>}

            {/* Video Player */}
            <video
                src="/avatar.mp4"
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover relative z-10"
                onError={(e) => {
                    e.currentTarget.parentElement.innerHTML = `<div class="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4 text-center bg-slate-50"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mb-2"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="m9 8 6 4-6 4Z"/></svg><p class="text-sm font-medium">请将视频重命名为<br/>avatar.mp4<br/>并上传到 public 文件夹</p></div>`;
                }}
            />
        </div>
    );
};

// VRM 模型路径与情感驱动服务地址
const VRM_MODEL_URL = '/models/granddaughter.vrm';
const EMOTION_DRIVING_WS_URL = import.meta.env.VITE_EMOTION_DRIVING_WS_URL || 'ws://localhost:10097';
// 默认启用 VRM 3D 数字人
const USE_VRM_AVATAR = import.meta.env.VITE_USE_VRM_AVATAR !== 'false';

/** 自适应数字人组件：根据配置切换 Video / VRM 模式，带错误边界 */
const AdaptiveAvatar = ({ isTalking, isListening, isThinking, emotion }: {
    isTalking: boolean;
    isListening: boolean;
    isThinking: boolean;
    emotion: 'happy' | 'sad' | 'anxious' | 'angry' | 'confused' | 'lonely' | 'calm' | 'neutral';
}) => {
    try {
        if (USE_VRM_AVATAR) {
            return (
                <AvatarVRM
                    modelUrl={VRM_MODEL_URL}
                    isTalking={isTalking}
                    isListening={isListening}
                    isThinking={isThinking}
                    emotion={emotion}
                    width={260}
                    height={260}
                    wsUrl={EMOTION_DRIVING_WS_URL}
                />
            );
        }
        return <VideoAvatar isTalking={isTalking} isListening={isListening} />;
    } catch (err) {
        // 兜底：任何崩溃都显示占位
        console.error('[AdaptiveAvatar] 渲染异常:', err);
        return (
            <div className="w-[260px] h-[260px] rounded-[3rem] bg-slate-100 flex items-center justify-center text-slate-400 text-sm text-center p-4">
                数字人加载失败<br />{String(err).slice(0, 60)}
            </div>
        );
    }
};

// --- Sub-Components (Full Screen Scenarios) ---

// 1. AR Navigation Scenario (Enhanced HUD with Real Route Data)
interface ARNavigationFlowProps {
    step: number;
    routeData?: RouteResult | null;
    destination?: string;
}

const ARNavigationFlow = ({ step, routeData, destination = '天安门广场' }: ARNavigationFlowProps) => {
    // 使用真实路线数据或回退到模拟数据
    const getStepIcon = (action: RouteStep['action'] | undefined) => {
        switch (action) {
            case 'left': return <ArrowLeft size={64} className="animate-bounce-left" />;
            case 'right': return <ArrowRight size={64} className="animate-bounce-right" />;
            case 'arrive': return <MapPin size={64} className="animate-bounce" />;
            case 'start': return <Navigation size={64} />;
            default: return <ArrowUp size={64} className="animate-bounce-up" />;
        }
    };

    // 使用真实路线数据构建指令
    const buildInstructions = () => {
        if (routeData?.success && routeData.steps.length > 0) {
            const steps = [
                { text: "正在规划路线...", sub: "请稍候", icon: <Loader2 className="animate-spin" size={64} /> },
                ...routeData.steps.slice(0, 4).map((s) => ({
                    text: s.instruction || `${s.action === 'left' ? '左转' : s.action === 'right' ? '右转' : '直行'}`,
                    sub: `距离 ${mapService.formatDistance(s.distance)}`,
                    icon: getStepIcon(s.action),
                })),
                { text: "即将到达目的地", sub: destination, icon: <MapPin size={64} className="animate-bounce" /> },
            ];
            return steps;
        }
        // 回退到默认模拟数据
        return [
            { text: "正在定位...", sub: "请扫描周围环境", icon: <Loader2 className="animate-spin" size={64} /> },
            { text: "前方路口左转", sub: "距离 50 米", icon: <ArrowLeft size={64} className="animate-bounce-left" /> },
            { text: "沿大路直行", sub: "距离 300 米", icon: <ArrowUp size={64} className="animate-bounce-up" /> },
            { text: "即将到达目的地", sub: destination, icon: <MapPin size={64} className="animate-bounce" /> },
        ];
    };

    const instructions = buildInstructions();
    const current = instructions[Math.min(step, instructions.length - 1)];
    const bgImage = step === 1
        ? "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?q=80&w=800&auto=format&fit=crop"
        : "https://images.unsplash.com/photo-1597022227183-49d7f646098b?q=80&w=800&auto=format&fit=crop";

    // 路线概览信息
    const routeInfo = routeData?.success ? {
        distance: mapService.formatDistance(routeData.distance),
        duration: mapService.formatDuration(routeData.duration),
    } : null;

    return (
        <div className="absolute inset-0 z-50 bg-black text-white flex flex-col relative overflow-hidden animate-fade-in font-sans">
            {/* AR Background */}
            <div className="absolute inset-0">
                <img src={bgImage} className="w-full h-full object-cover opacity-80" alt="AR View" />
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/60"></div>
            </div>

            {/* HUD Header */}
            <div className="relative z-10 px-6 pt-12 flex justify-between items-start">
                <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-xl border border-white/20">
                    <p className="text-[10px] text-white/70 uppercase">目的地</p>
                    <p className="font-bold text-lg">{destination}</p>
                    {routeInfo && (
                        <p className="text-xs text-white/60 mt-1">{routeInfo.distance} · {routeInfo.duration}</p>
                    )}
                </div>
                <div className="w-12 h-12 bg-emerald-500/20 backdrop-blur rounded-full flex items-center justify-center border border-emerald-400/50 animate-pulse">
                    <Navigation size={24} className="text-emerald-400" />
                </div>
            </div>

            {/* AR Elements (Center) */}
            <div className="relative z-10 flex-1 flex flex-col items-center justify-center">
                {step > 0 && (
                    <div className="bg-indigo-600/80 backdrop-blur p-6 rounded-[2rem] shadow-[0_0_50px_rgba(79,70,229,0.5)] border-4 border-white/30 transform transition-all duration-500">
                        {current.icon}
                    </div>
                )}

                {/* 3D Path visualization */}
                {step >= 1 && step < instructions.length - 1 && (
                    <div className="absolute bottom-0 w-32 h-64 bg-gradient-to-t from-indigo-500/50 to-transparent transform perspective-3d rotate-x-60"></div>
                )}
            </div>

            {/* Bottom Instruction Panel */}
            <div className="relative z-10 p-6 pb-12">
                <div className="bg-white/95 text-slate-900 p-6 rounded-3xl shadow-2xl animate-slide-up border border-white/50">
                    <div className="flex items-center gap-4">
                        <div className="flex-1">
                            <h2 className="text-3xl font-black mb-1">{current.text}</h2>
                            <p className="text-slate-500 font-bold flex items-center gap-2">
                                {step === 0 ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={18} className="text-indigo-600" />}
                                {current.sub}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
                .animate-bounce-left { animation: bounceLeft 1s infinite; }
                .animate-bounce-up { animation: bounceUp 1s infinite; }
                .animate-bounce-right { animation: bounceRight 1s infinite; }
                @keyframes bounceLeft { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-10px); } }
                @keyframes bounceUp { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
                @keyframes bounceRight { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(10px); } }
            `}</style>
        </div>
    );
};

// 2. 吃药引导：仅识别药盒 + 按家属端设置的服用数量和次数语音播报
const MedicationFlow = ({ step, onClose }: { step: number; onClose: () => void }) => {
    const [hasSpoken, setHasSpoken] = useState(false);
    // Step 0: 请拿出药盒 -> Step 1: 正在识别 -> Step 2: 识别成功 + 语音播报（家属端设置的用量、次数、时间）
    // 使用本地药盒识别照片：public/medication/盐酸奥司他韦.jpg（来自颐伴照片/药盒识别）
    const scanImage = "/medication/盐酸奥司他韦.jpg";
    const meds = medicationService.getMedications();
    const med = meds[0] || {
        name: '盐酸奥司他韦',
        dosage: '75mg，1粒',
        frequency: '每日2次',
        times: ['08:00', '20:00'],
        instructions: '与食物同服，用温水送服',
    };

    useEffect(() => {
        if (step === 2 && !hasSpoken) {
            setHasSpoken(true);
            const timesStr = med.times && med.times.length > 0
                ? med.times.map(t => t.replace(':', '点')).join('、')
                : '按家属设置的时间';
            const text = `这是${med.name}。家属为您设置的服用方式是：每次${med.dosage}，${med.frequency}，服用时间是${timesStr}。${med.instructions ? med.instructions + '。' : ''}`;
            VoiceService.speak(text, undefined, undefined, () => {}).catch(() => {});
        }
    }, [step, med.name, med.dosage, med.frequency, med.times, med.instructions, hasSpoken]);

    useEffect(() => () => VoiceService.stop(), []);

    let state = { text: "", sub: "", img: scanImage, overlay: null as React.ReactNode };

    if (step === 0) {
        state = {
            text: "请拿出药盒",
            sub: "将药盒正面放入框内",
            img: scanImage,
            overlay: (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border-2 border-white/50 rounded-2xl flex items-center justify-center">
                    <ScanLine className="text-white opacity-50" size={32} />
                </div>
            ),
        };
    } else if (step === 1) {
        state = {
            text: "正在识别...",
            sub: "保持药盒稳定",
            img: scanImage,
            overlay: (
                <div className="absolute inset-12 border-2 border-indigo-400 rounded-xl animate-pulse flex items-center justify-center bg-indigo-500/10">
                    <ScanLine className="text-indigo-400 w-full h-full opacity-80 animate-ping" />
                </div>
            ),
        };
    } else {
        state = {
            text: `识别成功：${med.name}`,
            sub: `${med.dosage}，${med.frequency}`,
            img: scanImage,
            overlay: (
                <div className="absolute top-1/3 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur px-4 py-2 rounded-xl border border-emerald-500 shadow-lg flex items-center gap-2">
                    <CheckCircle size={16} className="text-emerald-500" />
                    <span className="font-bold text-slate-800">匹配处方</span>
                </div>
            ),
        };
    }

    return (
        <div className="absolute inset-0 z-50 bg-slate-900 flex flex-col animate-fade-in font-sans">
            <div className="flex-1 relative overflow-hidden bg-black">
                <img src={state.img} className="w-full h-full object-cover opacity-90" alt="Camera" />
                <div className="absolute top-4 right-4 bg-black/50 backdrop-blur text-white px-3 py-1 rounded-full text-xs font-mono flex items-center gap-2 border border-white/10">
                    <Camera size={12} className="text-red-500 animate-pulse" /> AI Vision Active
                </div>
                {state.overlay}
            </div>

            <div className="bg-white rounded-t-[2.5rem] p-8 -mt-6 relative z-10 shadow-[0_-10px_40px_rgba(0,0,0,0.2)]">
                <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6" />
                <div className="flex items-start gap-4">
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 transition-colors duration-300 ${step === 2 ? 'bg-emerald-100 text-emerald-600' : 'bg-indigo-100 text-indigo-600'}`}>
                        {step === 2 ? <CheckCircle size={28} /> : <Pill size={28} />}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-2xl font-black text-slate-800 mb-1">{state.text}</h2>
                        <p className="text-slate-500 font-bold flex items-center gap-2">
                            <Volume2 size={16} className="text-indigo-500" />
                            {state.sub}
                        </p>
                        {step === 2 && med.times && med.times.length > 0 && (
                            <p className="text-slate-600 text-sm mt-2">服用时间：{med.times.join('、')}</p>
                        )}
                    </div>
                </div>

                <div className="flex gap-2 mt-6">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className={`h-2 rounded-full flex-1 transition-all duration-500 ${i <= step ? 'bg-indigo-600' : 'bg-slate-200'}`} />
                    ))}
                </div>

                {step === 2 && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="mt-6 w-full py-3.5 rounded-2xl bg-indigo-600 text-white font-bold text-base hover:bg-indigo-700 active:scale-[0.98] transition-all"
                    >
                        完成
                    </button>
                )}
            </div>
        </div>
    );
};

// 3. Face Recognition Flow (人脸识别 - 帮助老人回忆亲属)
const FaceRecognitionFlow = ({ step, onClose }: { step: number; onClose: () => void }) => {
    const selectedFaceRef = useRef(FACE_RECOGNITION_CONFIG[Math.floor(Math.random() * FACE_RECOGNITION_CONFIG.length)]);
    const face = selectedFaceRef.current;
    const faceImageUrl = `/faces/${face.file}`;
    const [hasSpoken, setHasSpoken] = useState(false);

    useEffect(() => {
        if (step === 3 && !hasSpoken) {
            setHasSpoken(true);
            const identity = `张爷爷，这是您的${face.relation}${face.name ? ` ${face.name}` : ''}。`;
            const contactAndStory = [face.contact, face.story].filter(Boolean).join(' ');
            const fullText = contactAndStory ? `${identity}${face.description}。${contactAndStory}` : `${identity}${face.description}`;
            VoiceService.speak(fullText, undefined, undefined, () => {}).catch(() => {});
        }
    }, [step, face.description, face.relation, face.name, face.contact, face.story, hasSpoken]);

    useEffect(() => () => VoiceService.stop(), []);

    if (step === 0) {
        return (
            <div className="absolute inset-0 z-50 bg-slate-900 flex flex-col animate-fade-in font-sans">
                <div className="flex-1 flex flex-col items-center justify-center text-white">
                    <div className="w-24 h-24 rounded-full bg-indigo-500/30 flex items-center justify-center mb-6 animate-pulse">
                        <Camera size={48} className="text-indigo-300" />
                    </div>
                    <p className="text-xl font-bold mb-2">正在打开摄像头...</p>
                    <p className="text-slate-400 text-sm">请将镜头对准需要识别的人</p>
                </div>
                <button onClick={onClose} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white z-10">
                    <X size={20} />
                </button>
            </div>
        );
    }

    if (step === 1) {
        return (
            <div className="absolute inset-0 z-50 bg-black flex flex-col animate-fade-in font-sans">
                <div className="flex-1 relative overflow-hidden">
                    <img src={faceImageUrl} className="w-full h-full object-cover" alt="摄像头画面" />
                    <div className="absolute inset-0 border-4 border-indigo-400/50 rounded-lg m-4 pointer-events-none">
                        <div className="absolute top-4 left-4 bg-black/60 text-white px-3 py-1 rounded-full text-sm flex items-center gap-2">
                            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                            正在拍摄...
                        </div>
                    </div>
                </div>
                <button onClick={onClose} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white z-10">
                    <X size={20} />
                </button>
            </div>
        );
    }

    if (step === 2) {
        return (
            <div className="absolute inset-0 z-50 bg-slate-900 flex flex-col animate-fade-in font-sans">
                <div className="flex-1 flex flex-col items-center justify-center text-white">
                    <div className="w-32 h-32 rounded-full border-4 border-indigo-400 flex items-center justify-center mb-6 animate-spin" style={{ animationDuration: '2s' }}>
                        <ScanFace size={64} className="text-indigo-400" />
                    </div>
                    <p className="text-xl font-bold mb-2">正在识别人脸...</p>
                    <p className="text-slate-400 text-sm">AI 正在分析面部特征</p>
                </div>
                <button onClick={onClose} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white z-10">
                    <X size={20} />
                </button>
            </div>
        );
    }

    // Step 3: 识别结果
    return (
        <div className="absolute inset-0 z-50 bg-slate-900 flex flex-col animate-fade-in font-sans">
            <div className="flex-1 flex flex-col items-center justify-center p-6">
                <div className="relative w-48 h-48 rounded-2xl overflow-hidden border-4 border-emerald-400 shadow-2xl mb-6">
                    <img src={faceImageUrl} className="w-full h-full object-cover" alt={face.relation} />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
                        <p className="text-2xl font-black">{face.name ? `${face.relation} ${face.name}` : face.relation}</p>
                        <p className="text-sm text-white/80">识别成功</p>
                    </div>
                </div>
                <div className="bg-white/95 rounded-2xl p-6 w-full max-w-sm shadow-xl max-h-[50vh] overflow-y-auto">
                    <div className="flex items-center gap-3 mb-4">
                        <CheckCircle size={32} className="text-emerald-500 shrink-0" />
                        <div>
                            <p className="text-lg font-bold text-slate-800">张爷爷，这是您的{face.relation}{face.name ? ` ${face.name}` : ''}</p>
                            <p className="text-slate-500 text-sm">正在为您播报...</p>
                        </div>
                    </div>
                    <p className="text-slate-600 leading-relaxed mb-3">{face.description}</p>
                    {(face.contact || face.story) && (
                        <div className="mt-3 pt-3 border-t border-slate-200 space-y-2 text-slate-600 text-sm">
                            {face.contact && <p><span className="font-semibold text-indigo-600">联系：</span>{face.contact}</p>}
                            {face.story && <p><span className="font-semibold text-amber-600">回忆：</span>{face.story}</p>}
                        </div>
                    )}
                </div>
            </div>
            <button onClick={onClose} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white z-10">
                <X size={20} />
            </button>
        </div>
    );
};

// 4. Immersive Memories Scenario (时光相册 - 手动切换模式)
const MemoriesFlow = ({ step, onClose, onPrev, onNext }: { step: number; onClose: () => void; onPrev: () => void; onNext: () => void }) => {
    // Loop through photos based on step
    const photoIndex = step % ALBUM_MEMORIES.length;
    const photo = ALBUM_MEMORIES[photoIndex];
    const [isSpeaking, setIsSpeaking] = useState(false);

    // 播放当前照片的语音（给爷爷回忆照片内容的讲述风格）
    const playNarration = useCallback(() => {
        setIsSpeaking(true);
        const textToSpeak = `张爷爷，让我帮您回忆一下这张照片。${photo.location}。${photo.story}`;
        VoiceService.speak(textToSpeak, undefined, undefined, () => setIsSpeaking(false)).catch(() => setIsSpeaking(false));
    }, [photo]);

    // 初次进入时自动播放第一张（先停止其他语音，延迟后再播，避免重复/重叠）
    useEffect(() => {
        VoiceService.stop();
        const timer = setTimeout(() => playNarration(), 400);
        return () => {
            clearTimeout(timer);
            VoiceService.stop();
        };
    }, []);

    // 切换照片时停止当前语音
    const handlePrev = () => {
        VoiceService.stop();
        setIsSpeaking(false);
        onPrev();
        setTimeout(() => {
            const prevIndex = (step - 1 + ALBUM_MEMORIES.length) % ALBUM_MEMORIES.length;
            const prevPhoto = ALBUM_MEMORIES[prevIndex];
            setIsSpeaking(true);
            VoiceService.speak(`张爷爷，让我帮您回忆一下这张照片。${prevPhoto.location}。${prevPhoto.story}`, undefined, undefined, () => setIsSpeaking(false)).catch(() => setIsSpeaking(false));
        }, 300);
    };

    const handleNext = () => {
        VoiceService.stop();
        setIsSpeaking(false);
        onNext();
        setTimeout(() => {
            const nextIndex = (step + 1) % ALBUM_MEMORIES.length;
            const nextPhoto = ALBUM_MEMORIES[nextIndex];
            setIsSpeaking(true);
            VoiceService.speak(`张爷爷，让我帮您回忆一下这张照片。${nextPhoto.location}。${nextPhoto.story}`, undefined, undefined, () => setIsSpeaking(false)).catch(() => setIsSpeaking(false));
        }, 300);
    };

    return (
        <div className="absolute inset-0 z-50 bg-black animate-fade-in font-sans">
            {/* 照片区域：绝对定位，top-14 bottom-[280px] 可单独调整照片上下位置 */}
            <div className="absolute top-14 left-0 right-0 bottom-[260px] flex items-center justify-center">
                <div className="scale-110 max-w-full max-h-full flex items-center justify-center">
                    <img
                        key={photo.id}
                        src={photo.url}
                        className="max-w-full max-h-full object-contain"
                        alt="Memory"
                    />
                </div>
            </div>

            {/* Close Button */}
            <div className="absolute top-4 right-4 z-[80] pointer-events-auto">
                <button
                    onClick={onClose}
                    type="button"
                    className="w-11 h-11 bg-black/55 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20 text-white hover:bg-white/20 transition-colors shadow-lg touch-manipulation"
                    aria-label="关闭时光相册"
                >
                    <X size={20} />
                </button>
            </div>

            {/* 左右切换按钮：z-30 确保可点击，pt-32 控制按钮上下位置（值越大越靠下） */}
            <div className="absolute inset-x-0 top-0 bottom-0 z-30 flex items-start justify-between px-4 pt-[80%]">
                <button
                    onClick={handlePrev}
                    className="w-12 h-12 bg-black/20 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/15 text-white/90 hover:bg-black/30 transition-colors active:scale-95"
                >
                    <ChevronLeft size={24} />
                </button>
                <button
                    onClick={handleNext}
                    className="w-12 h-12 bg-black/20 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/15 text-white/90 hover:bg-black/30 transition-colors active:scale-95"
                >
                    <ChevronRight size={24} />
                </button>
            </div>

            {/* 文字区域：绝对定位在底部，top-[calc(100%-280px)] 或 bottom-0 h-[280px] 可单独调整 */}
            <div className="absolute bottom-0 left-0 right-0 z-10 h-[390px] pt-8 px-8 pb-20 bg-gradient-to-t from-black/90 via-black/50 to-transparent overflow-hidden">
                <div className="mb-4 flex flex-wrap gap-2">
                    {photo.tags.map(tag => (
                        <span key={tag} className="bg-indigo-500/80 backdrop-blur px-2 py-1 rounded-md text-white text-[10px] font-bold shadow-sm">
                            #{tag}
                        </span>
                    ))}
                    <span className="text-white/60 text-xs font-mono ml-auto self-center">{photo.date}</span>
                </div>
                <h2 className="text-3xl font-black text-white mb-2 leading-tight drop-shadow-lg">{photo.location}</h2>

                {/* Narration Box */}
                <div className="bg-white/10 backdrop-blur-lg border border-white/20 p-4 rounded-2xl mt-4">
                    <p className="text-white/90 text-lg font-medium leading-relaxed drop-shadow-md">
                        "{photo.story}"
                    </p>
                    <div className="mt-4 flex items-center gap-3">
                        <button
                            onClick={playNarration}
                            disabled={isSpeaking}
                            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isSpeaking ? 'bg-indigo-500' : 'bg-white/20 hover:bg-white/30'}`}
                        >
                            <Volume2 size={16} className={`text-white ${isSpeaking ? 'animate-pulse' : ''}`} />
                        </button>
                        <div className="flex-1 h-8 flex items-center gap-0.5">
                            {/* Fake Waveform */}
                            {[...Array(20)].map((_, i) => (
                                <div
                                    key={i}
                                    className={`w-1 rounded-full ${isSpeaking ? 'bg-white/60 animate-wave' : 'bg-white/30'}`}
                                    style={{
                                        height: isSpeaking ? Math.random() * 20 + 5 + 'px' : '8px',
                                        animationDelay: i * 0.05 + 's'
                                    }}
                                ></div>
                            ))}
                        </div>
                        <span className="text-white/50 text-xs">{isSpeaking ? '播放中...' : '点击播放'}</span>
                    </div>
                </div>
            </div>

            <style>{`
                .animate-ken-burns { animation: kenBurns 15s ease-out infinite alternate; }
                .animate-wave { animation: wave 1s ease-in-out infinite; }
                @keyframes kenBurns { 0% { transform: scale(1); } 100% { transform: scale(1.15) translate(-2%, -2%); } }
                @keyframes wave { 0%, 100% { height: 30%; opacity: 0.5; } 50% { height: 100%; opacity: 1; } }
            `}</style>
        </div>
    );
};
/** 与 carePlanService.simulateVoicePlan 内置文案一致，用于控制台展示「预设输入」 */
const VOICE_CARE_PRESETS = {
    medication: '每天晚上8点在餐桌旁吃二甲双胍500mg一片，饭后服用',
    hydration: '每天下午3点提醒我喝水',
    sleep: '每天晚上9点半提醒我睡觉',
    followup: '明天上午9点去静安区中心医院复诊',
} as const;

const COGNITIVE_SIM_TURNS: [string, string][] = [
    ['今天星期几？我是不是忘记吃药了？', '今天是星期三，您晚饭后的药还没吃，我会提醒您。'],
    ['我现在在哪里？', '您现在在家里，客厅很安全。'],
];

const FAMILY_CONSOLE_CAPTURE_SCENARIOS = {
    S1_health_alert: {
        title: 'S1 健康异常提醒',
        presetInput: '预设输入：血氧偏低（89%）+ 心率偏高（112），触发健康关注提醒。',
        expectedUi: [
            '老人端主消息区域出现健康异常提醒文案',
            '控制台出现「已模拟健康异常提醒」',
            '可截图老人端消息 + 控制台操作结果',
        ],
    },
    S2_wandering_alert: {
        title: 'S2 异常轨迹/迷路提醒',
        presetInput: '预设输入：游走类型=lost，距离家约1500米，触发迷路告警。',
        expectedUi: [
            '老人端出现游走告警弹窗（如已离开安全区域）',
            '控制台出现「已模拟游走迷路告警」',
            '可截图告警弹窗 + 控制台结果',
        ],
    },
    S3_face_recognition: {
        title: 'S3 忘记眼前人/人脸识别',
        presetInput: '预设输入：触发 face 场景，展示识别流程与身份说明。',
        expectedUi: [
            '老人端进入人脸识别流程页面（face场景）',
            '控制台出现「已触发人脸识别场景」',
            '可截图识别流程页 + 控制台结果',
        ],
    },
    S4_home_album: {
        title: 'S4 到家后播放时光相册',
        presetInput: '预设输入：模拟到家联动后，自动打开在家时光相册。',
        expectedUi: [
            '控制台出现「已模拟到家并打开时光相册」',
            '老人端进入 memory 相册场景',
            '可截图相册场景 + 控制台结果',
        ],
    },
    S5_medication_pending: {
        title: 'S5 忘记吃药/到点提醒',
        presetInput: '预设输入：到点未服药，触发药物提醒弹层。',
        expectedUi: [
            '老人端出现 MedicationReminder 弹层（该吃药啦）',
            '控制台出现「已触发未服药提醒」',
            '可截图弹层药名/时间 + 控制台结果',
        ],
    },
    S6_sundowning_alert: {
        title: 'S6 黄昏综合征异常',
        presetInput: '预设输入：进入黄昏守护高风险模拟，触发干预卡片。',
        expectedUi: [
            '老人端底部出现黄昏守护风险卡片（中/高风险）',
            '控制台出现「已触发黄昏异常守护场景」',
            '可截图风险指数/干预状态 + 控制台结果',
        ],
    },
    S7_cognitive_and_report: {
        title: 'S7 认知评估+健康日报',
        presetInput: '预设输入：记录认知问答后打开认知健康报告弹窗。',
        expectedUi: [
            '控制台出现认知记录写入结果',
            '老人端出现认知健康报告弹窗',
            '可截图认知报告页 + 控制台结果',
        ],
    },
    S8_daily_chat: {
        title: 'S8 日常数字人聊天',
        presetInput: '预设输入：张爷爷，今天状态怎么样？陪我聊聊天。',
        expectedUi: [
            '老人端主消息区域更新为数字人日常对话回复',
            '控制台出现「已模拟日常聊天场景」',
            '可截图对话文案 + 控制台结果',
        ],
    },
} as const;

function formatFamilyConsoleClock(input: number | Date = new Date()): string {
    const date = input instanceof Date ? input : new Date(input);
    return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

function formatFamilyConsoleMonthDayTime(input: number | Date = new Date()): string {
    const date = input instanceof Date ? input : new Date(input);
    return date.toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

// --- Main Component ---

const ElderlyApp: React.FC<ElderlyAppProps> = ({ status, simulation, externalMessage, externalAction }) => {
    const EXTERNAL_COMMAND_MAX_AGE_MS = 15000;
    const [time, setTime] = useState<string>('');
    const [dateStr, setDateStr] = useState<string>('');

    // Scenario Flow State
    const [activeScenario, setActiveScenario] = useState<'none' | 'nav' | 'meds' | 'memory' | 'face'>('none');
    const [step, setStep] = useState(0);
    const [voiceInputDisplay, setVoiceInputDisplay] = useState<string | null>(null);

    // Avatar State
    const [isTalking, setIsTalking] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [aiMessage, setAiMessage] = useState("张爷爷，我在呢。有什么想聊的吗？");

    // 语音识别状态
    const [isRecording, setIsRecording] = useState(false);
    const [speechError, setSpeechError] = useState<string | null>(null);
    const [interimText, setInterimText] = useState<string>('');

    // 导航状态
    const [routeData, setRouteData] = useState<RouteResult | null>(null);
    const [navDestination, setNavDestination] = useState<string>('天安门广场');
    const [arModeActive, setArModeActive] = useState(false);  // AR实景导航模式

    // AIGC头像状态
    const [showAvatarCreator, setShowAvatarCreator] = useState(false);
    const [customAvatarUrl, setCustomAvatarUrl] = useState<string | null>(null);

    // 记忆唤醒状态
    const [memoryEvent, setMemoryEvent] = useState<LocationEvent | null>(null);

    // 认知报告状态
    const [showCognitiveReport, setShowCognitiveReport] = useState(false);

    // 黄昏守护状态
    const [sundowningSnapshot, setSundowningSnapshot] = useState<SundowningRiskSnapshot>(sundowningService.getCurrentSnapshot());
    const [sundowningAlerts, setSundowningAlerts] = useState<SundowningPushAlert[]>(sundowningService.getAlerts(3));
    const [activeSundowningPlan, setActiveSundowningPlan] = useState<SundowningInterventionPlan | null>(sundowningService.getActiveIntervention());
    const [showBreathingGuide, setShowBreathingGuide] = useState(false);
    const [breathingGuideIndex, setBreathingGuideIndex] = useState(0);

    /** 家属联动控制台 · 照护计划与认知趋势（与 Dashboard 同源服务） */
    const [carePanelItems, setCarePanelItems] = useState<CarePlanItem[]>(() => carePlanService.getUpcomingItems(3));
    const [carePanelTrend, setCarePanelTrend] = useState(() => carePlanService.getTrend());
    const [carePanelAssessments, setCarePanelAssessments] = useState<CognitiveAssessmentItem[]>(() => cognitiveService.getAssessments(4));
    const [cognitiveTrendAverage, setCognitiveTrendAverage] = useState(() => cognitiveService.getTrend().average);
    const [careConsoleFlash, setCareConsoleFlash] = useState<string | null>(null);
    const [careConsolePresetText, setCareConsolePresetText] = useState<string | null>(null);
    const [careConsoleNotifyHint, setCareConsoleNotifyHint] = useState<string | null>(null);
    const [careConsoleScenarioTitle, setCareConsoleScenarioTitle] = useState<string | null>(null);
    const [careConsoleScenarioExpectedUi, setCareConsoleScenarioExpectedUi] = useState<string[]>([]);

    // 输入模式：voice=长按说话, keyboard=键盘输入
    const [useKeyboardInput, setUseKeyboardInput] = useState(false);
    const [textInputValue, setTextInputValue] = useState('');

    // 人脸识别状态 (Face Album Feature)
    const [showFaceRecognition, setShowFaceRecognition] = useState(false);
    const [recognizedFace, setRecognizedFace] = useState<FaceData | null>(null);
    const lastExternalMessageIdRef = useRef<string | null>(null);
    const lastExternalActionIdRef = useRef<string | null>(null);
    // Auto-scroll ref
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const recentVoiceInputsRef = useRef<string[]>([]);
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [aiMessage, voiceInputDisplay, isTalking]);

    useEffect(() => {
        if (!externalMessage?.id || !externalMessage.text) return;
        if (lastExternalMessageIdRef.current === externalMessage.id) return;
        lastExternalMessageIdRef.current = externalMessage.id;
        const messageAge = externalMessage.timestamp ? Date.now() - externalMessage.timestamp : 0;
        if (messageAge > EXTERNAL_COMMAND_MAX_AGE_MS) {
            console.info('[ElderlyApp] 忽略过期老人消息:', externalMessage.id);
            return;
        }

        if (isGuardianOnlyBridgeMessage(externalMessage)) {
            console.warn('[ElderlyApp] 忽略家属专属消息，未向老人端播报:', externalMessage.purpose);
            return;
        }

        VoiceService.stop();
        setActiveScenario('none');
        setStep(0);
        setVoiceInputDisplay(null);
        setIsListening(false);
        setIsThinking(false);
        setAiMessage(externalMessage.text);
        setIsTalking(true);

        VoiceService.speak(externalMessage.text, undefined, undefined, () => {
            setIsTalking(false);
        }).catch(() => {
            setIsTalking(false);
        });
    }, [externalMessage]);

    // Edge 预生成：确认音「嗯」等
    useEffect(() => {
        // EdgeTTS 已移除，不再预加载
    }, []);

    // 进入老人端：预拉常用句 + 延迟一次打招呼（仅播一次，避免 React Strict Mode 双挂载导致重复）
    useEffect(() => {
        let cancelled = false;
        let greetingTimeoutId: ReturnType<typeof setTimeout> | null = null;

        const initTTSAndGreeting = async () => {
            try {
                const available = await VoiceService.checkAvailability();
                if (cancelled) return;
                if (available) {
                    console.log('[ElderlyApp] Edge TTS 可用，预加载常用句');
                    VoiceService.preloadClonePhrases();
                    const greeting = '张爷爷，我是您的数字人助手。今天身体怎么样？';

                    setAiMessage(greeting);
                    greetingTimeoutId = setTimeout(() => {
                        if (cancelled) return;
                        VoiceService.speak(greeting, undefined, undefined, undefined).catch(() => { });
                    }, 1000);
                } else {
                    console.warn('[ElderlyApp] TTS 服务不可用，请确保 edge_tts_server 已启动');
                }
            } catch (e) {
                if (!cancelled) console.error('[ElderlyApp] TTS 初始化失败:', e);
            }
        };
        initTTSAndGreeting();

        return () => {
            cancelled = true;
            if (greetingTimeoutId) clearTimeout(greetingTimeoutId);
        };
    }, []);

    // Clock
    useEffect(() => {
        const updateTime = () => {
            const now = new Date();
            setTime(now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }));
            setDateStr(now.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }));
        };
        updateTime();
        const timer = setInterval(updateTime, 1000);
        return () => clearInterval(timer);
    }, []);

    // 记忆唤醒服务订阅
    useEffect(() => {
        const unsubscribe = memoryService.subscribe((event) => {
            setMemoryEvent(event);
            const dialogue = memoryService.generateMemoryDialogue(event.anchor, '小明');
            setAiMessage(dialogue);
            setIsTalking(true);

            // 使用TTS播报
            VoiceService.speak(dialogue).catch(console.error);

            // 3秒后清除事件
            setTimeout(() => {
                setMemoryEvent(null);
                setIsTalking(false);
            }, 5000);
        });

        // 开始位置监控（可选）
        // memoryService.startWatching();

        return () => {
            unsubscribe();
            // memoryService.stopWatching();
        };
    }, []);

    // 黄昏守护订阅：风险快照、预警推送、主动干预
    useEffect(() => {
        const unsubscribeSnapshot = sundowningService.subscribe((snapshot) => {
            setSundowningSnapshot(snapshot);
        });

        const unsubscribeAlerts = sundowningService.subscribeAlerts((alert) => {
            setSundowningAlerts(sundowningService.getAlerts(3));
        });

        const unsubscribeIntervention = sundowningService.subscribeInterventions((plan) => {
            setActiveSundowningPlan(plan);
            if (!plan || plan.status !== 'running') return;

            setVoiceInputDisplay(null);
            setIsListening(false);
            setIsThinking(false);
            setAiMessage(plan.script);
            setIsTalking(true);

            if (plan.type === 'breathing_exercise') {
                setShowBreathingGuide(true);
                setBreathingGuideIndex(0);
            } else {
                setShowBreathingGuide(false);
            }

            VoiceService.stop();
            VoiceService.speakSegments(plan.script, undefined, undefined, () => {
                setIsTalking(false);
                if (plan.type !== 'breathing_exercise') {
                    sundowningService.completeActiveIntervention('done');
                }
            });

            if (plan.type === 'family_album_story') {
                setTimeout(() => {
                    setActiveScenario('memory');
                    setStep(0);
                }, 900);
            }
        });

        const riskTimer = setInterval(() => {
            sundowningService.evaluateRisk();
        }, 20000);

        return () => {
            unsubscribeSnapshot();
            unsubscribeAlerts();
            unsubscribeIntervention();
            clearInterval(riskTimer);
        };
    }, []);

    const refreshFamilyCarePanel = useCallback(() => {
        setCarePanelItems(carePlanService.getUpcomingItems(3));
        setCarePanelTrend(carePlanService.getTrend());
        setCarePanelAssessments(cognitiveService.getAssessments(4));
        setCognitiveTrendAverage(cognitiveService.getTrend().average);
    }, []);

    useEffect(() => {
        const unsubCare = carePlanService.subscribe(() => {
            refreshFamilyCarePanel();
        });
        const unsubMed = medicationService.subscribe(() => {
            refreshFamilyCarePanel();
        });
        return () => {
            unsubCare();
            unsubMed();
        };
    }, [refreshFamilyCarePanel]);

    // 呼吸练习引导：吸气 4 秒 -> 停 2 秒 -> 呼气 6 秒
    const breathingGuideSteps = ['吸气 4 秒', '屏息 2 秒', '呼气 6 秒'];
    useEffect(() => {
        if (!showBreathingGuide) return;

        const cycleTimer = setInterval(() => {
            setBreathingGuideIndex((prev) => (prev + 1) % breathingGuideSteps.length);
        }, 3000);

        const finishTimer = setTimeout(() => {
            setShowBreathingGuide(false);
            sundowningService.completeActiveIntervention('calmed');
        }, 24000);

        return () => {
            clearInterval(cycleTimer);
            clearTimeout(finishTimer);
        };
    }, [showBreathingGuide]);

    // --- Logic: Handle External Simulations & Voice Triggers ---
    useEffect(() => {
        if (simulation === SimulationType.NONE) {
            sundowningService.stopSimulation();
            setActiveScenario('none');
            setStep(0);
            setVoiceInputDisplay(null);
            setAiMessage("张爷爷，我在呢。今天天气不错。");
            return;
        }

        // Handle Voice Command Scenarios
        if (simulation === SimulationType.VOICE_NAV_START) {
            triggerVoiceCommand("我要去天安门", 'nav', "好的，正在为您开启 AR 导航。");
        } else if (simulation === SimulationType.VOICE_MEMORY_START) {
            triggerVoiceCommand("听听照片回忆", 'memory', "没问题，让我们一起翻翻老照片。");
        } else if (simulation === SimulationType.VOICE_MEDS_START) {
            triggerVoiceCommand("这药怎么吃？", 'meds', "我来帮您看看。请把药盒拿出来。");
        } else if (simulation === SimulationType.SUNDOWNING) {
            sundowningService.startSimulation();
            setAiMessage('已进入黄昏守护模式，我会更主动地陪伴您。');
        }
        // Handle Emergency Scenarios (Existing)
        else if (simulation === SimulationType.FALL || simulation === SimulationType.WANDERING || simulation === SimulationType.MEDICATION) {
            sundowningService.stopSimulation();
            setActiveScenario('none');
        }

    }, [simulation]);

    // 解析语音命令，识别意图
    const parseVoiceCommand = useCallback((text: string): {
        intent: 'nav' | 'meds' | 'memory' | 'chat' | 'unknown';
        destination?: string;
        response?: string;
    } => {
        const lowerText = text.toLowerCase();
        const now = new Date();

        // 导航意图
        const navKeywords = ['去', '到', '导航', '怎么走', '带我去', '想去'];
        if (navKeywords.some(k => lowerText.includes(k))) {
            const destinations = ['天安门', '医院', '超市', '公园', '银行', '药店', '家', '儿子家', '女儿家'];
            const found = destinations.find(d => lowerText.includes(d));
            return { intent: 'nav', destination: found || '天安门广场' };
        }

        // 药物意图
        const medKeywords = ['药', '吃药', '服药', '怎么吃', '用药'];
        if (medKeywords.some(k => lowerText.includes(k))) {
            return { intent: 'meds' };
        }

        // 肯定回复意图（用于到家询问时光相册的回复）
        // 如 "好"、"要"、"打开"、"可以"、"行" 等
        const affirmativeKeywords = ['好', '要', '打开', '可以', '行', '看看', '好的', '嗯', '是', '对'];
        if (affirmativeKeywords.some(k => lowerText.includes(k)) && lowerText.length <= 10) {
            // 短促的肯定回复视为同意打开相册
            console.log('[ElderlyApp] 检测到肯定回复，打开时光相册');
            return { intent: 'memory' };
        }

        // 回忆意图
        const memoryKeywords = ['照片', '回忆', '以前', '老照片'];
        if (memoryKeywords.some(k => lowerText.includes(k))) {
            return { intent: 'memory' };
        }

        // === 日常对话意图 ===

        // 日期/星期相关
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        const weekday = weekdays[now.getDay()];
        if (lowerText.includes('星期') || lowerText.includes('周几') || lowerText.includes('礼拜')) {
            return {
                intent: 'chat',
                response: `今天是星期${weekday}，${now.getMonth() + 1}月${now.getDate()}号。`
            };
        }
        if (lowerText.includes('几号') || lowerText.includes('日期') || lowerText.includes('今天')) {
            return {
                intent: 'chat',
                response: `今天是${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}号，星期${weekday}。`
            };
        }

        // 时间相关
        if (lowerText.includes('几点') || lowerText.includes('时间') || lowerText.includes('现在')) {
            const hours = now.getHours();
            const minutes = now.getMinutes();
            const timeStr = `${hours}点${minutes > 0 ? minutes + '分' : '整'}`;
            return {
                intent: 'chat',
                response: `现在是${timeStr}。`
            };
        }

        // 天气相关
        if (lowerText.includes('天气') || lowerText.includes('冷') || lowerText.includes('热') || lowerText.includes('下雨')) {
            return {
                intent: 'chat',
                response: '今天天气不错，24度，晴朗。出门记得戴帽子防晒哦~'
            };
        }

        // 问候相关
        if (lowerText.includes('你好') || lowerText.includes('早上好') || lowerText.includes('晚上好')) {
            const hour = now.getHours();
            const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
            return {
                intent: 'chat',
                response: `${greeting}，张爷爷！今天状态怎么样？`
            };
        }

        // 吃饭相关
        if (lowerText.includes('吃') || lowerText.includes('饭') || lowerText.includes('饿')) {
            const hour = now.getHours();
            if (hour >= 11 && hour <= 13) {
                return { intent: 'chat', response: '到中午了，该吃午饭啦！要不要我提醒儿子给您送饭？' };
            } else if (hour >= 17 && hour <= 19) {
                return { intent: 'chat', response: '到晚饭时间了，今天想吃什么？' };
            }
            return { intent: 'chat', response: '好的，我帮您记着，到饭点提醒您吃饭。' };
        }

        // 身体状态相关
        if (lowerText.includes('累') || lowerText.includes('困') || lowerText.includes('不舒服')) {
            return {
                intent: 'chat',
                response: '您累了就休息一下吧。要不要我帮您联系家人？'
            };
        }

        // 感谢相关
        if (lowerText.includes('谢谢') || lowerText.includes('多谢')) {
            return {
                intent: 'chat',
                response: '不客气，能帮到您是我的荣幸！'
            };
        }

        return { intent: 'unknown' };
    }, []);

    const clampScore = (v: number) => Math.max(0, Math.min(100, v));

    // 语音输入 -> 黄昏风险行为信号（困惑、重复提问、步态异常线索、焦虑）
    const buildSundowningSignalFromText = useCallback((text: string) => {
        const normalized = text.replace(/[，。！？?.!\s]/g, '');
        if (!normalized) {
            return {
                confusionScore: 12,
                repeatedQuestions: 0,
                stepAnomalyScore: 20,
                agitationScore: 15,
                source: 'voice' as const,
            };
        }

        recentVoiceInputsRef.current.push(normalized);
        if (recentVoiceInputsRef.current.length > 8) {
            recentVoiceInputsRef.current = recentVoiceInputsRef.current.slice(-8);
        }

        const duplicateCount = recentVoiceInputsRef.current.filter((t) => t === normalized).length - 1;
        const repeatedQuestions = Math.max(0, duplicateCount);

        const confusionKeywords = ['我在哪', '这是哪里', '找不到', '迷路', '怎么回家', '回不去', '不认识'];
        const agitationKeywords = ['着急', '焦虑', '慌', '害怕', '紧张', '烦躁', '不安'];
        const movementKeywords = ['乱走', '一直走', '走来走去', '出门', '找路', '回家'];

        const confusionByIntent = parseVoiceCommand(text).intent === 'unknown' ? 25 : 0;
        const confusionByKeyword = confusionKeywords.some(k => text.includes(k)) ? 45 : 10;
        const agitationByKeyword = agitationKeywords.some(k => text.includes(k)) ? 45 : 15;
        const stepAnomaly = movementKeywords.some(k => text.includes(k)) ? 60 : 22;

        return {
            confusionScore: clampScore(confusionByIntent + confusionByKeyword + repeatedQuestions * 10),
            repeatedQuestions,
            stepAnomalyScore: clampScore(stepAnomaly + repeatedQuestions * 5),
            agitationScore: clampScore(agitationByKeyword + repeatedQuestions * 8),
            source: 'voice' as const,
        };
    }, [parseVoiceCommand]);

    const triggerSundowningIntervention = useCallback((type: SundowningInterventionType) => {
        sundowningService.triggerIntervention(type, 'manual');
    }, []);

    // 保存所有中间识别结果（用于整合处理）
    const interimResultsRef = useRef<string[]>([]);
    const lastRecognitionResultRef = useRef<SpeechRecognitionResult | null>(null);
    const finalResultTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isProcessingRef = useRef<boolean>(false); // 防止重复处理
    const holdRecordingRef = useRef<boolean>(false); // 长按说话：是否由按住手势触发的录音
    /** 长按延迟定时器：只有按住超过该时间才开麦，避免误触或一点就开麦 */
    const holdStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** 是否已进入“长按录音”状态（已开麦），松开时仅在此为 true 时执行停止 */
    const holdConfirmedRef = useRef<boolean>(false);

    // 整合识别结果：智能合并所有中间结果，选择最完整、最准确的句子
    const consolidateResults = useCallback((results: string[]): string => {
        if (results.length === 0) return '';

        // 去重并过滤空结果
        const uniqueResults = Array.from(new Set(results.filter(r => r && r.trim())));
        if (uniqueResults.length === 0) return '';

        // 如果只有一个结果，直接返回
        if (uniqueResults.length === 1) {
            console.log('[ElderlyApp] 📝 整合识别结果: 只有一个结果，直接使用');
            return uniqueResults[0];
        }

        // 按长度排序，优先考虑较长的结果（通常更完整）
        const sorted = uniqueResults.sort((a, b) => b.length - a.length);

        // 智能选择策略：
        // 1. 优先选择包含标点符号的结果（更可能是完整句子）
        // 2. 优先选择最长的结果
        // 3. 如果多个结果相似，选择最完整的

        let bestResult = sorted[0];
        let bestScore = 0;

        for (const result of sorted) {
            let score = result.length; // 基础分数：长度

            // 加分项：
            // 1. 包含标点符号（句号、问号、感叹号）- 表示完整句子
            if (/[。！？]/.test(result)) {
                score += 50;
            }

            // 2. 包含常见疑问词（更可能是完整问题）
            if (/[怎么|什么|哪里|哪个|为什么|如何]/.test(result)) {
                score += 30;
            }

            // 3. 包含常见动词（更可能是完整表达）
            if (/[是|有|在|去|来|说|看|听|想|做]/.test(result)) {
                score += 20;
            }

            // 4. 不包含明显的截断（不以常见截断词结尾）
            if (!/[的|了|呢|啊|吧]$/.test(result)) {
                score += 10;
            }

            // 5. 检查是否包含其他结果的关键内容（更完整）
            let containsOthers = 0;
            for (const other of sorted) {
                if (result !== other && result.includes(other)) {
                    containsOthers += other.length;
                }
            }
            score += containsOthers * 0.5;

            if (score > bestScore) {
                bestScore = score;
                bestResult = result;
            }
        }

        // 清理结果：移除重复的标点符号，统一标点
        bestResult = bestResult
            .replace(/[。]{2,}/g, '。')  // 多个句号合并为一个
            .replace(/[！]{2,}/g, '！')    // 多个感叹号合并为一个
            .replace(/[？]{2,}/g, '？')    // 多个问号合并为一个
            .trim();

        console.log('[ElderlyApp] 📝 整合识别结果:');
        console.log('[ElderlyApp]   所有中间结果:', uniqueResults);
        console.log('[ElderlyApp]   选择最完整结果:', bestResult);
        console.log('[ElderlyApp]   结果长度:', bestResult.length, '字符');
        console.log('[ElderlyApp]   评分:', bestScore.toFixed(1));

        return bestResult;
    }, []);

    // 处理最终识别结果（提取为独立函数，处理 AI 调用和语音播放）
    const processFinalResult = useCallback(async (result: SpeechRecognitionResult) => {
        // 防止重复处理
        if (isProcessingRef.current) {
            console.log('[ElderlyApp] ⚠️ 正在处理中，忽略重复的最终结果');
            return;
        }
        isProcessingRef.current = true;
        // 最终结果
        console.log('='.repeat(60));
        console.log(`[ElderlyApp] ✅ 最终识别结果: "${result.text}"`);
        console.log('='.repeat(60));

        // 验证识别结果
        if (!result.text || !result.text.trim()) {
            console.error('[ElderlyApp] ❌ 识别结果为空，无法处理');
            return;
        }

        setInterimText('');
        setIsListening(false);

        // 清除超时定时器（已收到最终结果）
        if (finalResultTimeoutRef.current) {
            clearTimeout(finalResultTimeoutRef.current);
            finalResultTimeoutRef.current = null;
        }

        // 清空中间结果数组（已处理完成）
        interimResultsRef.current = [];

        // 收到最终结果，停止识别
        console.log('[ElderlyApp] 收到最终结果，停止识别并处理...');
        setIsRecording(false);
        speechService.stopRecognition();

        setVoiceInputDisplay(result.text);
        setIsThinking(true);

        // 情绪识别：分析用户输入的情绪并驱动数字人状态变化
        const emotionResult = emotionService.analyze(result.text);
        console.log('[ElderlyApp] 🎭 情绪识别:', emotionResult);
        // 触发 healthStateService 重新计算 AvatarState（融合对话情绪）
        healthStateService.updateMetrics({});

        // 记录黄昏行为信号：用于“时间窗口 + 行为趋势”综合风险判断
        const sundowningSignal = buildSundowningSignalFromText(result.text);
        sundowningService.recordBehavior(sundowningSignal);

        console.log('[ElderlyApp] 正在调用 AI 服务处理:', result.text);
        // EdgeTTS 已移除，不再播放确认音

        try {
            console.log('[ElderlyApp] ============================================================');
            console.log('[ElderlyApp] 调用 AI 服务，输入:', result.text);
            console.log('[ElderlyApp] ============================================================');

            // --- Voice Command Interception for Face Recognition ---
            // 优先使用子女端添加的人脸；若未添加则使用预设配置（public/faces/）
            const getFacesForRecognition = (): FaceData[] => {
                const stored = faceService.getFaces();
                if (stored.length > 0) return stored;
                return FACE_RECOGNITION_CONFIG.map(c => ({
                    id: c.file,
                    name: c.name,
                    relation: c.relation,
                    imageUrl: `/faces/${c.file}`,
                    description: c.description || '',
                    contact: c.contact,
                    story: c.story,
                    createdAt: 0,
                }));
            };

            if (result.text.includes('人脸') || result.text.includes('认人') || result.text.includes('是谁') || result.text.includes('照片')) {
                console.log('[ElderlyApp] 🛡️ 拦截到人脸识别指令');
                const allFaces = getFacesForRecognition();
                const reply = "好的，正在为您开启人脸识别。请将摄像头对准面前的人。";

                setAiMessage(reply);
                setIsThinking(false);
                setIsTalking(true);

                VoiceService.speakSegments(reply, undefined, undefined, () => {
                    setIsTalking(false);
                    setShowFaceRecognition(true);
                    setRecognizedFace(null);

                    // Simulate recognition after 3 seconds if faces exist
                    if (allFaces.length > 0) {
                        setTimeout(() => {
                            const randomFace = allFaces[Math.floor(Math.random() * allFaces.length)];
                            setRecognizedFace(randomFace);
                            const identity = `这是您的${randomFace.relation}${randomFace.name ? `，${randomFace.name}` : ''}。`;
                            const contactAndStory = [randomFace.contact, randomFace.story].filter(Boolean).join(' ');
                            const fullText = contactAndStory ? `${identity}${contactAndStory}` : identity;
                            openclawSyncService.syncFaceEvent({
                                type: randomFace.relation.includes('儿') || randomFace.relation.includes('女') || randomFace.relation.includes('家属')
                                    ? 'family_arrived'
                                    : 'recognized',
                                timestamp: new Date().toISOString(),
                                face: randomFace,
                                message: identity,
                            });
                            VoiceService.speakSegments(fullText);
                        }, 3000);
                    } else {
                        setTimeout(() => {
                            openclawSyncService.syncFaceEvent({
                                type: 'unknown',
                                timestamp: new Date().toISOString(),
                                message: 'face_not_found',
                            });
                            VoiceService.speakSegments("相册中暂无照片，请让家属先要在后台添加照片哦。");
                        }, 2000);
                    }
                });
                setVoiceInputDisplay(null);
                isProcessingRef.current = false;
                return;
            }
            // -----------------------------------------------------

            // 检查 AI 服务是否配置
            if (!aiService.isConfigured()) {
                console.warn('[ElderlyApp] ⚠️ AI 服务未配置 API Key，将使用本地回复');
            }

            // 确保识别文本不为空
            if (!result.text || !result.text.trim()) {
                console.error('[ElderlyApp] ❌ 识别结果为空，无法调用 AI 服务');
                throw new Error('识别结果为空');
            }

            const voicePlan = carePlanService.createFromVoice(result.text);
            if (voicePlan) {
                setVoiceInputDisplay(null);
                setAiMessage(voicePlan.reply);
                setIsThinking(false);
                setIsTalking(true);
                cognitiveService.recordConversation(result.text, voicePlan.reply);
                await VoiceService.speak(
                    voicePlan.reply,
                    undefined,
                    undefined,
                    () => setIsTalking(false)
                );
                isProcessingRef.current = false;
                return;
            }

            console.log('[ElderlyApp] 开始调用 aiService.chat()...');
            const response = await aiService.chat(result.text);
            console.log('[ElderlyApp] ✅ AI 服务响应:', response);
            console.log('[ElderlyApp] AI 回复文本:', response?.text);

            if (!response) {
                console.error('[ElderlyApp] ❌ AI 服务返回 null 或 undefined');
                throw new Error('AI 服务返回 null');
            }

            if (!response.text || !response.text.trim()) {
                console.error('[ElderlyApp] ❌ AI 服务返回空文本');
                console.error('[ElderlyApp] 完整响应对象:', JSON.stringify(response, null, 2));
                throw new Error('AI 服务返回空文本');
            }

            console.log('[ElderlyApp] ✅ AI 服务调用成功，回复:', response.text);

            setVoiceInputDisplay(null);
            setAiMessage(response.text);
            setIsThinking(false);
            setIsTalking(true);

            console.log('[ElderlyApp] 开始播放 AI 回复:', response.text);
            console.log('[ElderlyApp] 检查语音服务状态...');

            // 检查语音服务（Edge TTS）
            const ttsAvailable = await VoiceService.checkAvailability();
            console.log('[ElderlyApp] 语音服务状态:', ttsAvailable ? '✅ 可用' : '❌ 不可用');

            if (!ttsAvailable) {
                console.warn('[ElderlyApp] ⚠️ 语音服务不可用，请确保 edge_tts_server 已启动');
            }

            // 播放语音：整段播放避免按句拆分导致“两个声音”
            try {
                await VoiceService.speak(
                    response.text,
                    undefined,
                    undefined,
                    () => {
                        console.log('[ElderlyApp] ✅ 语音播放完成');
                        setIsTalking(false);
                    }
                );
                console.log('[ElderlyApp] ✅ 语音播放已启动');
            } catch (speakError) {
                console.error('[ElderlyApp] ❌ 语音播放失败:', speakError);
                setIsTalking(false);
                // 即使语音播放失败，也要显示文本回复
            }

            // 记录对话用于认知评估
            cognitiveService.recordConversation(result.text, response.text);

            if (response.shouldTriggerAction) {
                setTimeout(() => {
                    VoiceService.stop();
                    switch (response.shouldTriggerAction) {
                        case 'nav':
                            const destMatch = result.text.match(/去(.+?)(?:怎么走|$)/);
                            const destination = destMatch?.[1] || '天安门广场';
                            setNavDestination(destination);
                            mapService.planWalkingRoute('北京市', destination).then(setRouteData);
                            setActiveScenario('nav');
                            setStep(0);
                            break;
                        case 'meds':
                            setActiveScenario('meds');
                            setStep(0);
                            break;
                        case 'memory':
                            setActiveScenario('memory');
                            setStep(0);
                            break;
                        case 'face':
                            setActiveScenario('face');
                            setStep(0);
                            break;
                    }
                }, 2500);
            }
        } catch (error) {
            console.error('[ElderlyApp] ❌ AI服务错误:', error);
            console.error('[ElderlyApp] 错误详情:', {
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });

            setIsThinking(false);
            setVoiceInputDisplay(null);

            const errorMessage = '抱歉，我没太听清楚，您能再说一遍吗？';
            setAiMessage(errorMessage);
            setIsTalking(true);

            // 尝试播放错误提示
            VoiceService.speakSegments(
                errorMessage,
                undefined,
                undefined,
                () => setIsTalking(false)
            ).catch((speakErr) => {
                console.error('[ElderlyApp] ❌ 播放错误提示也失败:', speakErr);
                setIsTalking(false);
            });
        } finally {
            // 处理完成后重置标志
            isProcessingRef.current = false;
        }
    }, [buildSundowningSignalFromText]);

    // 处理语音识别结果 - 使用AI大模型
    const handleSpeechResult = useCallback(async (result: SpeechRecognitionResult) => {
        // 详细日志输出
        console.log('[ElderlyApp] ============================================================');
        console.log('[ElderlyApp] 📥 收到识别结果:', {
            text: result.text,
            isFinal: result.isFinal,
            confidence: result.confidence,
        });
        console.log('[ElderlyApp] ============================================================');

        // 保存最后一个结果（包括中间结果）
        if (result.text && result.text.trim()) {
            lastRecognitionResultRef.current = result;
        }

        if (!result.isFinal) {
            // 收集中间结果
            if (result.text && result.text.trim()) {
                interimResultsRef.current.push(result.text.trim());
                console.log('[ElderlyApp] 🔄 中间结果（已收集，等待用户停止说话）:', result.text);
                console.log('[ElderlyApp]   当前已收集', interimResultsRef.current.length, '个中间结果');
            }
            setInterimText(result.text);

            // 清除之前的超时定时器
            if (finalResultTimeoutRef.current) {
                clearTimeout(finalResultTimeoutRef.current);
            }

            // 改进的超时机制：只在用户停止说话后（2秒内没有新的中间结果）才处理
            // 增加等待时间，确保用户真正停止说话，避免在用户说话过程中触发
            finalResultTimeoutRef.current = setTimeout(() => {
                // 检查是否还在处理中，避免重复处理
                if (isProcessingRef.current) {
                    console.log('[ElderlyApp] ⚠️ 已在处理中，忽略超时触发');
                    return;
                }

                // 整合所有中间结果
                if (interimResultsRef.current.length > 0) {
                    const consolidatedText = consolidateResults(interimResultsRef.current);
                    if (consolidatedText) {
                        console.log('[ElderlyApp] ⚠️ 用户停止说话（2秒内无新结果），整合并处理结果');
                        console.log('[ElderlyApp]   整合后的文本:', consolidatedText);
                        // 处理整合后的结果
                        processFinalResult({
                            text: consolidatedText,
                            isFinal: true,
                            confidence: undefined,
                        });
                    }
                }
            }, 2000); // 增加到2秒，确保用户真正停止说话

            return;
        }

        // 清除超时定时器（已收到最终结果）
        if (finalResultTimeoutRef.current) {
            clearTimeout(finalResultTimeoutRef.current);
            finalResultTimeoutRef.current = null;
        }

        // 如果服务器发送了最终结果，优先使用它
        // 但也可以整合中间结果和最终结果，选择最完整的
        let finalText = result.text;
        if (interimResultsRef.current.length > 0) {
            // 将最终结果也加入整合列表
            interimResultsRef.current.push(result.text.trim());
            const consolidatedText = consolidateResults(interimResultsRef.current);
            if (consolidatedText && consolidatedText.length > finalText.length) {
                console.log('[ElderlyApp] 📝 使用整合后的结果（比服务器最终结果更完整）');
                finalText = consolidatedText;
            }
        }

        // 处理最终结果（中间结果会在processFinalResult中清空）
        processFinalResult({
            ...result,
            text: finalText,
        });
    }, [processFinalResult, consolidateResults]);

    // 开始/停止语音识别
    const toggleRecording = useCallback(async () => {
        if (isRecording) {
            console.log('[ElderlyApp] 用户手动停止录音');

            // 清除超时定时器（停止自动处理）
            if (finalResultTimeoutRef.current) {
                clearTimeout(finalResultTimeoutRef.current);
                finalResultTimeoutRef.current = null;
            }

            // 先停止识别，等待服务器发送最终结果
            setIsRecording(false);
            setIsListening(false);
            speechService.stopRecognition();

            // 等待服务器发送最终结果（最多等待10秒）
            // 服务器处理音频可能需要5-10秒（特别是长音频），所以增加等待时间
            // 如果10秒内没有收到最终结果，整合所有中间结果
            setTimeout(() => {
                // 检查是否已经在处理中
                if (isProcessingRef.current) {
                    console.log('[ElderlyApp] 已在处理最终结果，无需使用中间结果');
                    return;
                }

                // 整合所有中间结果（作为后备方案）
                if (interimResultsRef.current.length > 0) {
                    const consolidatedText = consolidateResults(interimResultsRef.current);
                    if (consolidatedText) {
                        console.log('[ElderlyApp] ⚠️ 等待10秒后未收到最终结果，整合并处理中间结果');
                        console.log('[ElderlyApp]   整合后的文本:', consolidatedText);
                        processFinalResult({
                            text: consolidatedText,
                            isFinal: true,
                            confidence: undefined,
                        });
                    }
                } else if (!lastRecognitionResultRef.current) {
                    console.log('[ElderlyApp] ⚠️ 没有识别结果，无法处理');
                    console.log('[ElderlyApp] 提示：服务器可能仍在处理音频，请稍候...');
                }
            }, 10000); // 等待10秒让服务器发送最终结果（支持长音频处理）

            return;
        }

        try {
            setSpeechError(null);
            setIsRecording(true);
            setIsListening(true);
            isProcessingRef.current = false; // 重置处理标志
            lastRecognitionResultRef.current = null; // 重置最后一个结果
            interimResultsRef.current = []; // 清空中间结果数组

            await speechService.startRecognition(
                handleSpeechResult,
                (error) => {
                    console.error('语音识别错误:', error);
                    setSpeechError(error.message);
                    setIsRecording(false);
                    setIsListening(false);
                    speechService.stopRecognition();
                }
            );
        } catch (error) {
            console.error('启动语音识别失败:', error);
            setSpeechError('无法启动语音识别');
            setIsRecording(false);
            setIsListening(false);
        }
    }, [isRecording, handleSpeechResult]);

    // 长按说话：只有按住超过约 250ms 才开麦，松开立即停止，避免界面一直占用麦克风
    const HOLD_DELAY_MS = 250;
    const handleHoldStart = useCallback(() => {
        holdRecordingRef.current = true;
        holdConfirmedRef.current = false;
        if (holdStartTimerRef.current) {
            clearTimeout(holdStartTimerRef.current);
            holdStartTimerRef.current = null;
        }
        holdStartTimerRef.current = setTimeout(() => {
            holdStartTimerRef.current = null;
            if (!holdRecordingRef.current) return; // 已松开，不再开麦
            holdConfirmedRef.current = true;
            if (!isRecording) toggleRecording();
        }, HOLD_DELAY_MS);
    }, [isRecording, toggleRecording]);

    const handleHoldEnd = useCallback(() => {
        if (holdStartTimerRef.current) {
            clearTimeout(holdStartTimerRef.current);
            holdStartTimerRef.current = null;
        }
        if (!holdRecordingRef.current) return;
        holdRecordingRef.current = false;

        if (!holdConfirmedRef.current) return; // 未超过长按时间，未开麦，无需停止
        holdConfirmedRef.current = false;

        console.log('[ElderlyApp] 长按松开，停止录音');
        if (finalResultTimeoutRef.current) {
            clearTimeout(finalResultTimeoutRef.current);
            finalResultTimeoutRef.current = null;
        }
        setIsRecording(false);
        setIsListening(false);
        speechService.stopRecognition();
        setTimeout(() => {
            if (isProcessingRef.current) return;
            if (interimResultsRef.current.length > 0) {
                const consolidatedText = consolidateResults(interimResultsRef.current);
                if (consolidatedText) {
                    processFinalResult({ text: consolidatedText, isFinal: true, confidence: undefined });
                }
            } else if (!lastRecognitionResultRef.current) {
                console.log('[ElderlyApp] 没有识别结果');
            }
        }, 10000);
    }, [consolidateResults, processFinalResult]);

    // 键盘输入提交
    const handleTextSubmit = useCallback(() => {
        const text = textInputValue.trim();
        if (!text) return;
        setTextInputValue('');
        processFinalResult({ text, isFinal: true, confidence: undefined });
    }, [textInputValue, processFinalResult]);

    // 打开相册（时光回忆录）
    const openAlbum = useCallback(() => {
        VoiceService.stop();
        setAiMessage("好的，让我们一起翻翻老照片。");
        setIsTalking(true);
        setTimeout(() => {
            setIsTalking(false);
            setActiveScenario('memory');
        }, 800);
    }, []);

    const getMedicationSimulationTarget = useCallback((): { medication: Medication; scheduledTime: string } | null => {
        const simulatedTime = formatFamilyConsoleClock();
        const activeReminder = medicationService.getActiveReminder();
        if (activeReminder) {
            return {
                medication: activeReminder.medication,
                scheduledTime: activeReminder.scheduledTime,
            };
        }

        const nextMedication = medicationService.getNextMedicationTime();
        if (nextMedication) {
            return {
                medication: nextMedication.medication,
                scheduledTime: simulatedTime,
            };
        }

        const fallbackMedication = medicationService.getMedications()[0];
        if (!fallbackMedication) return null;
        return {
            medication: fallbackMedication,
            scheduledTime: simulatedTime,
        };
    }, []);

    const sendGuardianFromFamilyConsole = useCallback(
        async ({
            title,
            message,
            purpose,
            metadata = {},
        }: {
            title: string;
            message: string;
            purpose: string;
            metadata?: Record<string, unknown>;
        }) => {
            if (!openclawActionService.isConfigured()) {
                setCareConsoleNotifyHint('家属飞书通知：Bridge 未配置，仅本地已模拟。');
                return;
            }

            try {
                const result = await openclawActionService.notifyGuardians({
                    elderId: openclawSyncService.getElderId(),
                    message,
                    purpose,
                    metadata,
                });

                if (result?.skipped) {
                    setCareConsoleNotifyHint(`家属通知已冷却：${result.reason || '同类提醒短时间内已发送'}`);
                    return;
                }

                const targetText =
                    Array.isArray(result?.targets) && result.targets.length > 0
                        ? result.targets.join('、')
                        : '已配置家属目标';
                setCareConsoleNotifyHint(`已尝试推送家属：${targetText}`);
            } catch (error) {
                setCareConsoleNotifyHint(error instanceof Error ? error.message : '推送家属失败');
            }
        },
        [],
    );

    const simulateVoiceCareFlowFromConsole = useCallback(
        (kind: 'medication' | 'hydration' | 'sleep' | 'followup') => {
            const preset = VOICE_CARE_PRESETS[kind];
            setCareConsoleNotifyHint(null);
            setCareConsolePresetText(`预设老人语音：「${preset}」`);
            setVoiceInputDisplay(preset);
            setIsListening(true);

            window.setTimeout(() => {
                setIsListening(false);
                setVoiceInputDisplay(null);
                const result = carePlanService.simulateVoicePlan(kind);
                setCareConsoleFlash(`已创建：${result.item.title}（${result.item.time}）`);
                openclawSyncService.emitScenarioSignal(
                    'simulation.voice_care_plan',
                    {
                        kind,
                        item: result.item,
                        reply: result.reply,
                        source: 'elder_family_console',
                    },
                    'info',
                );
                refreshFamilyCarePanel();

                setAiMessage(result.reply);
                setIsTalking(true);
                VoiceService.speak(result.reply, undefined, undefined, () => {
                    setIsTalking(false);
                }).catch(() => setIsTalking(false));
            }, 700);
        },
        [refreshFamilyCarePanel],
    );

    const simulateCognitiveCaptureFromConsole = useCallback(() => {
        setCareConsoleNotifyHint(null);
        const lines = COGNITIVE_SIM_TURNS.map(([q]) => `「${q}」`).join(' ');
        setCareConsolePresetText(`预设老人提问：${lines}`);

        COGNITIVE_SIM_TURNS.forEach(([userMsg, aiReply]) => {
            cognitiveService.recordConversation(userMsg, aiReply);
        });

        setCareConsoleFlash('已记录一组认知问答与重复提问信号。');
        openclawSyncService.emitScenarioSignal(
            'simulation.cognitive_capture',
            {
                assessments: cognitiveService.getAssessments(3),
                trend: cognitiveService.getTrend(),
            },
            'warn',
        );
        refreshFamilyCarePanel();

        const summaryReply =
            '刚刚记下了您的两条问答，我会继续关注时间和方位方面的表现，也会提醒您按时服药。';
        setAiMessage(summaryReply);
        setIsTalking(true);
        VoiceService.speak(summaryReply, undefined, undefined, () => {
            setIsTalking(false);
        }).catch(() => setIsTalking(false));
    }, [refreshFamilyCarePanel]);

    const simulateMedicationFromConsole = useCallback(
        async (mode: 'pending' | 'taken') => {
            setCareConsoleNotifyHint(null);
            const target = getMedicationSimulationTarget();
            if (!target) {
                setCareConsoleFlash('暂无可用药物配置，无法模拟服药提醒。');
                return;
            }

            if (mode === 'pending') {
                setCareConsolePresetText(
                    `预设场景：已到 ${target.scheduledTime}，老人尚未确认服药，触发未服药提醒与老人端弹窗。`,
                );
                medicationService.triggerReminder(target.medication, target.scheduledTime);
                refreshFamilyCarePanel();
                setCareConsoleFlash(`已触发未服药提醒：${target.medication.name}（${target.scheduledTime}）`);
                await sendGuardianFromFamilyConsole({
                    title: '未服药提醒',
                    message: `【未服药提醒】张爷爷计划于${target.scheduledTime}服用${target.medication.name}（${target.medication.dosage}），当前仍未确认服药。系统已在老人端发起语音提醒：${target.medication.instructions}。建议家属稍后电话确认。`,
                    purpose: 'medication_pending_alert',
                    metadata: {
                        medicationId: target.medication.id,
                        medicationName: target.medication.name,
                        scheduledTime: target.scheduledTime,
                        dedupeKey: `medication:pending:${target.medication.id}:${target.scheduledTime}`,
                        dedupeMinutes: 30,
                    },
                });
                return;
            }

            setCareConsolePresetText('预设动作：老人确认已服药，写入用药日志并刷新依从率。');
            let activeReminder = medicationService.getActiveReminder();
            if (!activeReminder) {
                medicationService.triggerReminder(target.medication, target.scheduledTime);
                activeReminder = medicationService.getActiveReminder();
            }
            if (!activeReminder) {
                setCareConsoleFlash('服药确认失败，未能生成提醒上下文。');
                return;
            }

            medicationService.confirmTaken(activeReminder.medication.id);
            refreshFamilyCarePanel();
            setCareConsoleFlash(`已记录服药完成：${activeReminder.medication.name}`);
            await sendGuardianFromFamilyConsole({
                title: '已服药确认',
                message: `【已服药提醒】张爷爷已于${formatFamilyConsoleClock()}完成${activeReminder.medication.name}服用，计划时间${activeReminder.scheduledTime}，剂量为${activeReminder.medication.dosage}。系统已记录本次服药完成，请家属放心。`,
                purpose: 'medication_taken_update',
                metadata: {
                    medicationId: activeReminder.medication.id,
                    medicationName: activeReminder.medication.name,
                    scheduledTime: activeReminder.scheduledTime,
                    dedupeKey: `medication:taken:${activeReminder.medication.id}:${new Date().toISOString().slice(0, 10)}`,
                    dedupeMinutes: 30,
                },
            });
        },
        [getMedicationSimulationTarget, refreshFamilyCarePanel, sendGuardianFromFamilyConsole],
    );

    const simulateHomeLinkageFromConsole = useCallback(async () => {
        setCareConsoleNotifyHint(null);
        setCareConsolePresetText('预设定位：进入家庭围栏，触发「到家」编排与家属简报。');
        locationAutomationService.simulateArrivalHome();
        setCareConsoleFlash('已模拟到家联动。');
        const state = locationAutomationService.getState();
        refreshFamilyCarePanel();
        await sendGuardianFromFamilyConsole({
            title: '到家提醒',
            message: `【到家提醒】张爷爷已于${formatFamilyConsoleMonthDayTime()}安全到家，当前定位显示在${state.currentLabel}，系统将继续保持在家守护。`,
            purpose: 'location_arrived_home_update',
            metadata: {
                locationLabel: state.currentLabel,
                distanceMeters: state.lastDistanceMeters,
                dedupeKey: 'location:arrived_home',
                dedupeMinutes: 10,
            },
        });
    }, [refreshFamilyCarePanel, sendGuardianFromFamilyConsole]);

    const executeFamilyControlAction = useCallback((action: string, payload: Record<string, unknown> = {}) => {
        const speech = String(payload.text || payload.message || '').trim();

        setActiveScenario('none');
        setStep(0);

        if (action === 'open_memory_album') {
            openAlbum();
            return;
        }

        if (action === 'start_breathing') {
            const line = speech || '张爷爷，我们一起做一个呼吸放松练习，慢慢吸气，再慢慢呼气。';
            setShowBreathingGuide(true);
            setBreathingGuideIndex(0);
            setAiMessage(line);
            setIsTalking(true);
            VoiceService.speak(line, undefined, undefined, () => {
                setIsTalking(false);
            }).catch(() => setIsTalking(false));
            return;
        }

        if (action === 'show_medication') {
            const line = speech || '张爷爷，我来带您看看今天的用药安排，按时吃药身体会更稳一点。';
            setAiMessage(line);
            setActiveScenario('meds');
            setIsTalking(true);
            VoiceService.speak(line, undefined, undefined, () => {
                setIsTalking(false);
            }).catch(() => setIsTalking(false));
            return;
        }

        if (action === 'show_care_plan') {
            const line = speech || '张爷爷，我帮您过一遍今天的照护安排，有什么不舒服也可以随时跟我说。';
            setAiMessage(line);
            setIsTalking(true);
            VoiceService.speak(line, undefined, undefined, () => {
                setIsTalking(false);
            }).catch(() => setIsTalking(false));
            return;
        }

        // 主动关怀：早安/午间/晚间/睡前关心 —— 不需要家属说话，由数字人先开口
        if (action === 'proactive_morning_check') {
            const line = speech || '早上好张爷爷，我已经帮您检查了今天的天气和用药安排，早餐吃得还好吗？一会儿记得按时吃药，我会提醒您的。';
            setAiMessage(line);
            setIsTalking(true);
            VoiceService.speak(line, undefined, undefined, () => {
                setIsTalking(false);
            }).catch(() => setIsTalking(false));
            return;
        }

        if (action === 'proactive_noon_check') {
            const line = speech || '张爷爷，中午好，我来陪您聊一会儿。午饭吃得怎么样？如果有想去的地方或者想联系的家人，可以跟我说。';
            setAiMessage(line);
            setIsTalking(true);
            VoiceService.speak(line, undefined, undefined, () => {
                setIsTalking(false);
            }).catch(() => setIsTalking(false));
            return;
        }

        if (action === 'proactive_evening_check') {
            const line = speech || '张爷爷，晚上好，我来看看您今天的状态。今天走路有没有累到？晚上的药我会再提醒您，睡前我们可以简单回顾一下今天的事情。';
            setAiMessage(line);
            setIsTalking(true);
            VoiceService.speak(line, undefined, undefined, () => {
                setIsTalking(false);
            }).catch(() => setIsTalking(false));
            return;
        }

        if (action === 'proactive_sleep_check') {
            const line = speech || '张爷爷，现在已经不早了，我来陪您做几个深呼吸，然后慢慢准备休息。有什么担心的事情也可以跟我说，我会帮您记下来提醒家人。';
            setAiMessage(line);
            setIsTalking(true);
            VoiceService.speak(line, undefined, undefined, () => {
                setIsTalking(false);
            }).catch(() => setIsTalking(false));
            return;
        }

        if (action === 'speak_text' && speech) {
            setAiMessage(speech);
            setIsTalking(true);
            VoiceService.speak(speech, undefined, undefined, () => {
                setIsTalking(false);
            }).catch(() => setIsTalking(false));
        }
    }, [openAlbum]);

    const setFamilyScenarioGuide = useCallback(
        (scenarioKey: keyof typeof FAMILY_CONSOLE_CAPTURE_SCENARIOS) => {
            const scenario = FAMILY_CONSOLE_CAPTURE_SCENARIOS[scenarioKey];
            setCareConsoleScenarioTitle(scenario.title);
            setCareConsoleScenarioExpectedUi([...scenario.expectedUi]);
            setCareConsolePresetText(`预设输入：${scenario.presetInput}`);
        },
        [],
    );

    const runFamilyCaptureScenario = useCallback(
        async (scenarioKey: keyof typeof FAMILY_CONSOLE_CAPTURE_SCENARIOS) => {
            setFamilyScenarioGuide(scenarioKey);
            switch (scenarioKey) {
                case 'S1_health_alert':
                    setAiMessage('健康提醒：检测到您当前血氧偏低、心率偏高，请先坐下休息并喝温水，若持续不适我将联系家属。');
                    setIsTalking(true);
                    setCareConsoleFlash('已模拟健康异常提醒（血氧/心率异常）。');
                    VoiceService.speak('健康提醒：检测到您当前血氧偏低、心率偏高，请先坐下休息并喝温水。', undefined, undefined, () => {
                        setIsTalking(false);
                    }).catch(() => setIsTalking(false));
                    break;
                case 'S2_wandering_alert':
                    wanderingService.simulateWandering('lost');
                    setCareConsoleFlash('已模拟游走迷路告警（异常轨迹）。');
                    break;
                case 'S3_face_recognition':
                    setActiveScenario('face');
                    setStep(0);
                    setAiMessage('张爷爷，我来帮您识别一下眼前的人。');
                    setCareConsoleFlash('已触发人脸识别场景。');
                    break;
                case 'S4_home_album':
                    await simulateHomeLinkageFromConsole();
                    executeFamilyControlAction('open_memory_album', { text: '张爷爷，您已经到家了，我们来看看在家的时光相册。' });
                    setCareConsoleFlash('已模拟到家并打开时光相册。');
                    break;
                case 'S5_medication_pending':
                    await simulateMedicationFromConsole('pending');
                    break;
                case 'S6_sundowning_alert':
                    sundowningService.startSimulation();
                    setAiMessage('检测到黄昏时段情绪与行为波动，我会陪伴您并启动安抚干预。');
                    setCareConsoleFlash('已触发黄昏异常守护场景。');
                    break;
                case 'S7_cognitive_and_report':
                    simulateCognitiveCaptureFromConsole();
                    setShowCognitiveReport(true);
                    setCareConsoleFlash('已模拟认知评估并打开认知健康报告。');
                    break;
                case 'S8_daily_chat':
                    setActiveScenario('none');
                    setStep(0);
                    setAiMessage('我今天状态不错呢，刚刚还提醒了吃药。您想先聊聊今天的计划，还是看看家里的老照片？');
                    setIsTalking(true);
                    setCareConsoleFlash('已模拟日常聊天场景。');
                    VoiceService.speak('我今天状态不错呢，您想先聊聊今天的计划，还是看看家里的老照片？', undefined, undefined, () => {
                        setIsTalking(false);
                    }).catch(() => setIsTalking(false));
                    break;
                default:
                    break;
            }
        },
        [
            executeFamilyControlAction,
            setFamilyScenarioGuide,
            simulateCognitiveCaptureFromConsole,
            simulateMedicationFromConsole,
            simulateHomeLinkageFromConsole,
        ],
    );

    useEffect(() => {
        if (!externalAction?.id || !externalAction.action) return;
        if (lastExternalActionIdRef.current === externalAction.id) return;
        lastExternalActionIdRef.current = externalAction.id;
        const actionAge = externalAction.timestamp ? Date.now() - externalAction.timestamp : 0;
        if (actionAge > EXTERNAL_COMMAND_MAX_AGE_MS) {
            console.info('[ElderlyApp] 忽略过期联动动作:', externalAction.id, externalAction.action);
            return;
        }

        executeFamilyControlAction(externalAction.action, externalAction.payload || {});
    }, [externalAction, executeFamilyControlAction]);

    // Helper to trigger voice command flow (used by both real recognition and simulation)
    const triggerVoiceCommand = useCallback((userText: string, targetScenario: 'nav' | 'meds' | 'memory', aiResponse: string) => {
        // 1. Reset
        setActiveScenario('none');
        setStep(0);
        setIsRecording(false);
        speechService.stopRecognition();

        // 2. Display User Voice Input
        setVoiceInputDisplay(userText);
        setIsListening(true);

        // 3. AI Processes (Reduced delay)
        setTimeout(() => {
            setIsListening(false);
            setVoiceInputDisplay(null);
            setAiMessage(aiResponse);
            setIsTalking(true);

            // 4. AI Finishes talking and Switches UI (Reduced delay)
            setTimeout(() => {
                setIsTalking(false);
                setActiveScenario(targetScenario);
            }, 800); // Reduced from 2000
        }, 600); // Reduced from 1500
    }, []);

    // 录音中时：在文档上监听 pointerup/pointercancel，松开任意位置都会停止（防止滑出按钮未触发 onPointerUp）
    useEffect(() => {
        if (!isRecording) return;
        const onDocPointerUp = () => handleHoldEnd();
        document.addEventListener('pointerup', onDocPointerUp, true);
        document.addEventListener('pointercancel', onDocPointerUp, true);
        return () => {
            document.removeEventListener('pointerup', onDocPointerUp, true);
            document.removeEventListener('pointercancel', onDocPointerUp, true);
        };
    }, [isRecording, handleHoldEnd]);

    // --- Logic: Scenario Auto-Progression (meds 只到 step 2 即识别+播报，不再往后) ---
    useEffect(() => {
        let interval: any;
        if (activeScenario !== 'none' && activeScenario !== 'memory') {
            interval = setInterval(() => {
                setStep((prev) => {
                    if (activeScenario === 'meds' && prev >= 2) return prev;
                    return prev + 1;
                });
            }, 3500);
        }
        return () => clearInterval(interval);
    }, [activeScenario]);


    // --- Render ---

    return (
        <div className="flex h-full items-center justify-center gap-6 px-6 py-8 xl:flex-row flex-col">
            <div className="relative w-[360px] h-[720px] bg-black rounded-[3rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] border-[8px] border-slate-800 overflow-hidden ring-1 ring-slate-900/5 select-none font-sans">

                {/* Status Bar */}
                <div className="absolute top-0 left-0 right-0 h-10 z-[60] flex items-center justify-between px-6 pt-2 text-white text-xs font-medium pointer-events-none mix-blend-difference">
                    <span>{time}</span>
                    <div className="flex items-center gap-1.5"><Signal size={12} /><Wifi size={12} /><Battery size={14} /></div>
                </div>

                {/* Face Recognition Overlay */}
                {showFaceRecognition && (
                    <div className="absolute inset-0 z-[100] bg-black flex flex-col items-center justify-center font-sans select-none animate-fade-in">
                        <div className="absolute top-6 right-6 z-10 pointer-events-auto">
                            <button onClick={() => { setShowFaceRecognition(false); setRecognizedFace(null); }} className="bg-white/20 p-3 rounded-full text-white backdrop-blur-md hover:bg-white/30 transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="w-full px-6 text-center mt-[-40px]">
                            <h2 className="text-2xl text-white/90 font-bold mb-8 animate-pulse">正在识别面前的人...</h2>

                            <div className="relative aspect-[3/4] w-full max-w-[280px] mx-auto bg-slate-800 rounded-3xl overflow-hidden border-4 border-indigo-500 shadow-[0_0_50px_rgba(99,102,241,0.5)]">
                                {/* Simulated Camera Feed */}
                                <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
                                    {!recognizedFace && <Camera size={48} className="text-slate-600 opacity-50" />}
                                    {recognizedFace && <img src={recognizedFace.imageUrl} className="w-full h-full object-cover animate-fade-in" />}
                                </div>

                                {/* Scanning Effect */}
                                {!recognizedFace && (
                                    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-indigo-500/20 to-transparent w-full h-full animate-[scan_2s_ease-in-out_infinite]" />
                                )}

                                {recognizedFace && (
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm p-4 text-white animate-slide-up max-h-[50%] overflow-y-auto">
                                        <h3 className="text-2xl font-bold mb-1">{recognizedFace.name || recognizedFace.relation}</h3>
                                        <p className="text-lg text-indigo-300 font-bold">{recognizedFace.relation}</p>
                                        {(recognizedFace.contact || recognizedFace.story) && (
                                            <div className="mt-2 pt-2 border-t border-white/20 text-sm text-white/90 space-y-1">
                                                {recognizedFace.contact && <p><span className="text-indigo-200">联系：</span>{recognizedFace.contact}</p>}
                                                {recognizedFace.story && <p><span className="text-indigo-200">回忆：</span>{recognizedFace.story}</p>}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {!recognizedFace && <p className="text-slate-400 mt-6 text-sm">请将摄像头对准面部</p>}
                        </div>
                    </div>
                )}

                {/* --- SCENARIO LAYERS --- */}
                {activeScenario === 'nav' && <ARNavigationFlow step={step} routeData={routeData} destination={navDestination} />}
                {activeScenario === 'meds' && (
                    <MedicationFlow
                        step={Math.min(step, 2)}
                        onClose={() => {
                            VoiceService.stop();
                            setActiveScenario('none');
                            setStep(0);
                        }}
                    />
                )}
                {activeScenario === 'face' && (
                    <FaceRecognitionFlow
                        step={Math.min(step, 3)}
                        onClose={() => {
                            VoiceService.stop();
                            setActiveScenario('none');
                            setStep(0);
                        }}
                    />
                )}
                {activeScenario === 'memory' && (
                    <MemoriesFlow
                        step={step}
                        onClose={() => {
                            setStep(0);
                            setActiveScenario('none');
                            VoiceService.stop();
                        }}
                        onPrev={() => setStep(prev => Math.max(0, prev - 1))}
                        onNext={() => setStep(prev => prev + 1)}
                    />
                )}

                {/* --- HOME SCREEN (2D Avatar) --- */}
                <div className={`w-full h-full flex flex-col relative transition-all duration-700 overflow-hidden bg-gradient-to-b from-indigo-50 to-white ${activeScenario !== 'none' ? 'opacity-0 pointer-events-none scale-95' : 'opacity-100 scale-100'}`}>

                    {/* Header */}
                    <div className="w-full px-8 pt-14 pb-2 flex justify-between items-end relative z-10 animate-fade-in-up shrink-0">
                        <div className="flex flex-col">
                            <span className="text-5xl font-black text-slate-800 tracking-tighter leading-none">{time}</span>
                            <span className="text-sm font-bold text-slate-500 mt-2 pl-1 tracking-widest uppercase">{dateStr}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-3xl font-black text-slate-800">24°</span>
                            <CloudSun size={32} className="text-amber-500" />
                        </div>
                    </div>

                    {/* 单个动态 2D 数字人居中（仅此一处渲染，无静态重复） */}
                    <div className="flex-1 flex items-center justify-center relative min-h-0 -mt-8 overflow-hidden">
                        <div className="relative flex items-center justify-center group cursor-pointer" onClick={() => setShowAvatarCreator(true)}>
                            <div className="transform scale-90 shrink-0">
                                <AdaptiveAvatar
                                    isTalking={isTalking}
                                    isListening={isListening}
                                    isThinking={isThinking}
                                    emotion={emotionService.getCurrentEmotion().primary as any}
                                />
                            </div>
                            {/* Platform Shadow */}
                            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-40 h-8 bg-black/10 rounded-[100%] blur-md transform scale-x-150 z-[-1] animate-shadow-breath" />
                        </div>

                        {/* 警告状态指示 */}
                        {status === SystemStatus.WARNING && (
                            <div className="absolute top-4 right-6 w-6 h-6 bg-amber-500 rounded-full flex items-center justify-center animate-pulse z-50">
                                <AlertCircle size={14} className="text-white" />
                            </div>
                        )}

                        {/* 记忆唤醒提示 */}
                        {memoryEvent && (
                            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-indigo-500 text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg animate-bounce whitespace-nowrap z-50">
                                📍 {memoryEvent.anchor.name}
                            </div>
                        )}
                    </div>

                    {/* 黄昏守护卡片：仅在中/高风险或干预进行时显示 */}
                    {activeScenario === 'none' && (sundowningSnapshot.riskLevel !== 'low' || activeSundowningPlan?.status === 'running' || showBreathingGuide) && (
                        <div className="shrink-0 px-4 pb-2 relative z-10">
                            <div className={`rounded-2xl border p-3 backdrop-blur-sm ${
                                sundowningSnapshot.riskLevel === 'high'
                                    ? 'bg-rose-50/90 border-rose-200'
                                    : sundowningSnapshot.riskLevel === 'medium'
                                        ? 'bg-amber-50/90 border-amber-200'
                                        : 'bg-white/70 border-slate-200'
                            }`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[12px] font-bold text-slate-700">黄昏守护</span>
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                            sundowningSnapshot.riskLevel === 'high'
                                                ? 'bg-rose-100 text-rose-700'
                                                : sundowningSnapshot.riskLevel === 'medium'
                                                    ? 'bg-amber-100 text-amber-700'
                                                    : 'bg-emerald-100 text-emerald-700'
                                        }`}>
                                            {sundowningSnapshot.riskLevel === 'high' ? '高风险' : sundowningSnapshot.riskLevel === 'medium' ? '中风险' : '低风险'}
                                        </span>
                                    </div>
                                    <span className="text-[10px] text-slate-500">风险指数 {sundowningSnapshot.riskScore}</span>
                                </div>

                                <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full transition-all duration-500 ease-out ${
                                            sundowningSnapshot.riskLevel === 'high'
                                                ? 'bg-rose-500'
                                                : sundowningSnapshot.riskLevel === 'medium'
                                                    ? 'bg-amber-500'
                                                    : 'bg-emerald-500'
                                        }`}
                                        style={{ width: `${Math.max(6, sundowningSnapshot.riskScore)}%` }}
                                    />
                                </div>

                                <p className="mt-2 text-[10px] text-slate-600">
                                    {sundowningSnapshot.keyFactors.slice(0, 2).join('；')}
                                </p>

                                {activeSundowningPlan?.status === 'running' && (
                                    <p className="mt-1 text-[10px] font-medium text-indigo-600">
                                        正在干预：{activeSundowningPlan.title}
                                    </p>
                                )}

                                {showBreathingGuide && (
                                    <div className="mt-2 rounded-xl bg-sky-50 border border-sky-100 px-2.5 py-2">
                                        <p className="text-[11px] font-semibold text-sky-700">
                                            呼吸训练：{breathingGuideSteps[breathingGuideIndex]}
                                        </p>
                                    </div>
                                )}

                                {sundowningAlerts[0] && (
                                    <p className="mt-1 text-[10px] text-slate-500">
                                        推送：{sundowningAlerts[0].title}
                                    </p>
                                )}

                                <div className="mt-2 grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => triggerSundowningIntervention('family_voice_story')}
                                        className="h-8 rounded-xl bg-indigo-500 text-white text-[11px] font-semibold"
                                    >
                                        家属安抚
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => triggerSundowningIntervention('breathing_exercise')}
                                        className="h-8 rounded-xl bg-sky-500 text-white text-[11px] font-semibold"
                                    >
                                        呼吸放松
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* AI 消息展示区域（紧凑） */}
                    {(voiceInputDisplay || aiMessage) && (
                        <div className="shrink-0 px-4 pb-1 relative z-10 min-h-0">
                            <div className="bg-white/60 backdrop-blur-sm py-2 px-3 rounded-xl text-center">
                                {voiceInputDisplay ? (
                                    <p className="text-slate-800 text-sm font-bold truncate">"{voiceInputDisplay}"</p>
                                ) : (
                                    <p className="text-slate-600 text-sm font-medium truncate">{aiMessage}</p>
                                )}
                                <div ref={messagesEndRef} />
                            </div>
                        </div>
                    )}
                    {/* 输入框：左侧键盘 | 中间语音/文字 | 右侧相册 — 固定在底部 */}
                    <div className="shrink-0 px-3 pb-6 pt-2 relative z-10">
                        <div
                            className="bg-[#F7F7F7] rounded-[2rem] min-h-[68px] flex items-center justify-between px-4 py-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] select-none"
                            style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
                        >
                            {/* 左侧：键盘输入（点击切换键盘/语音模式） */}
                            <button
                                type="button"
                                onClick={() => setUseKeyboardInput(prev => !prev)}
                                className={`w-12 h-12 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${useKeyboardInput ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-slate-400/60 text-slate-600 hover:bg-slate-100'}`}
                                title={useKeyboardInput ? '切换为语音输入' : '使用键盘输入'}
                            >
                                <Keyboard size={24} strokeWidth={2} />
                            </button>
                            {/* 中央：键盘模式=文字输入框，语音模式=长按说话 */}
                            {useKeyboardInput ? (
                                <div className="flex-1 flex items-center gap-2 min-w-0 mx-3">
                                    <input
                                        type="text"
                                        value={textInputValue}
                                        onChange={(e) => setTextInputValue(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleTextSubmit(); }}
                                        placeholder="输入文字发送..."
                                        className="flex-1 min-w-0 h-12 px-4 rounded-2xl bg-white border border-slate-200 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        onClick={handleTextSubmit}
                                        disabled={!textInputValue.trim()}
                                        className="w-12 h-12 rounded-full bg-indigo-500 flex items-center justify-center text-white flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <Send size={20} strokeWidth={2} />
                                    </button>
                                </div>
                            ) : (
                                <div
                                    className="flex-1 flex items-center justify-center min-h-[48px] min-w-0 mx-3 cursor-pointer active:opacity-80 transition-opacity"
                                    onPointerDown={handleHoldStart}
                                    onPointerUp={handleHoldEnd}
                                    onPointerLeave={handleHoldEnd}
                                    onPointerCancel={handleHoldEnd}
                                    onContextMenu={(e) => e.preventDefault()}
                                >
                                    <span className="text-slate-600 font-medium text-lg">
                                        {isListening ? '正在聆听...' : isThinking ? '思考中...' : '长按说话'}
                                    </span>
                                </div>
                            )}
                            {/* 右侧：相册（时光回忆录） */}
                            <button
                                type="button"
                                onClick={openAlbum}
                                className="w-12 h-12 rounded-full border-2 border-slate-400/60 flex items-center justify-center flex-shrink-0 text-slate-600 hover:bg-slate-100 transition-colors"
                                title="打开相册"
                            >
                                <Images size={26} strokeWidth={2} />
                            </button>
                        </div>
                    </div>

                </div> {/* Close HomeScreen */}

                {/* AIGC Avatar Creator Overlay */}
                {showAvatarCreator && (
                    <AvatarCreator
                        onAvatarCreated={(imageUrl) => {
                            setCustomAvatarUrl(imageUrl);
                            setAiMessage('哇，新形象真好看！我喜欢这个样子~');
                            setIsTalking(true);
                            setTimeout(() => setIsTalking(false), 2000);
                        }}
                        onClose={() => setShowAvatarCreator(false)}
                    />
                )}

                {/* AR实景导航叠加层 */}
                <ARNavigationOverlay
                    isActive={arModeActive}
                    steps={routeData?.steps || []}
                    destination={navDestination}
                    onClose={() => {
                        setArModeActive(false);
                        setActiveScenario('none');
                    }}
                />

                {/* 游荡警报 */}
                <WanderingAlert
                    onNavigateHome={() => {
                        // 导航回家
                        mapService.planWalkingRoute('当前位置', '家').then(route => {
                            setRouteData(route);
                            setNavDestination('家');
                            setActiveScenario('nav');
                        });
                    }}
                    onCallFamily={() => {
                        setAiMessage('正在联系您的家人...');
                        setIsTalking(true);
                        setTimeout(() => setIsTalking(false), 3000);
                    }}
                />

                {/* 服药提醒 */}
                <MedicationReminder
                    onTaken={() => {
                        setAiMessage('好的，已记录您服药了。记得多喝水~');
                        setIsTalking(true);
                        setTimeout(() => setIsTalking(false), 2000);
                    }}
                />

                {/* 认知报告 */}
                <CognitiveReport
                    isOpen={showCognitiveReport}
                    onClose={() => setShowCognitiveReport(false)}
                />

            </div>

            <div className="w-full max-w-[380px] shrink-0">
                <div className="rounded-[2rem] border border-slate-200 bg-white/95 p-4 shadow-[0_20px_45px_-20px_rgba(15,23,42,0.35)] backdrop-blur-sm">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <p className="text-sm font-bold text-slate-800">家属联动控制台</p>
                            <p className="text-xs text-slate-500">含语音建提醒、认知记录与照护趋势（演示）</p>
                        </div>
                        <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[10px] font-semibold text-indigo-700 shrink-0">
                            演示控制
                        </span>
                    </div>

                    <div className="mt-3 max-h-[min(78vh,720px)] overflow-y-auto space-y-4 pr-0.5">
                        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 mb-2">重点场景一键截图</p>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => void runFamilyCaptureScenario('S1_health_alert')}
                                    className="rounded-xl bg-indigo-600 px-2.5 py-2 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    S1 健康异常
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void runFamilyCaptureScenario('S2_wandering_alert')}
                                    className="rounded-xl bg-rose-600 px-2.5 py-2 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    S2 迷路告警
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void runFamilyCaptureScenario('S3_face_recognition')}
                                    className="rounded-xl bg-violet-600 px-2.5 py-2 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    S3 人脸识别
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void runFamilyCaptureScenario('S4_home_album')}
                                    className="rounded-xl bg-fuchsia-600 px-2.5 py-2 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    S4 到家相册
                                </button>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => void runFamilyCaptureScenario('S5_medication_pending')}
                                    className="rounded-xl bg-amber-500 px-2.5 py-2 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    S5 未服药提醒
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void runFamilyCaptureScenario('S6_sundowning_alert')}
                                    className="rounded-xl bg-orange-600 px-2.5 py-2 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    S6 黄昏异常
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void runFamilyCaptureScenario('S7_cognitive_and_report')}
                                    className="rounded-xl bg-slate-700 px-2.5 py-2 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    S7 认知日报
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void runFamilyCaptureScenario('S8_daily_chat')}
                                    className="rounded-xl bg-cyan-600 px-2.5 py-2 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    S8 日常聊天
                                </button>
                            </div>
                            {careConsoleScenarioTitle && (
                                <div className="mt-2 rounded-xl bg-white px-3 py-2 text-[10px] text-slate-700 leading-relaxed">
                                    <div className="font-bold text-slate-800">当前场景：{careConsoleScenarioTitle}</div>
                                    <div className="mt-1 text-slate-500">截图验收点：</div>
                                    <ul className="mt-1 space-y-1">
                                        {careConsoleScenarioExpectedUi.map((item) => (
                                            <li key={item}>- {item}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>

                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">家属反控老人端</p>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => executeFamilyControlAction('speak_text', { text: '张爷爷，张明刚刚在飞书里说晚上会给您打电话。' })}
                                    className="rounded-xl bg-indigo-500 px-3 py-2.5 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    播报家属消息
                                </button>
                                <button
                                    type="button"
                                    onClick={() => executeFamilyControlAction('open_memory_album', { text: '张爷爷，我们来看看家人的照片。' })}
                                    className="rounded-xl bg-fuchsia-500 px-3 py-2.5 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    打开时光相册
                                </button>
                                <button
                                    type="button"
                                    onClick={() => executeFamilyControlAction('show_medication', { text: '张爷爷，我来提醒您看看今晚的用药安排。' })}
                                    className="rounded-xl bg-emerald-500 px-3 py-2.5 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    打开用药引导
                                </button>
                                <button
                                    type="button"
                                    onClick={() => executeFamilyControlAction('start_breathing', { text: '张爷爷，我们先慢慢吸气，再慢慢呼气。' })}
                                    className="rounded-xl bg-orange-500 px-3 py-2.5 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    启动呼吸放松
                                </button>
                            </div>
                            <div className="mt-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-2.5 py-2">
                                <p className="text-[10px] font-bold text-slate-700 mb-1">数字人 24 小时主动关怀</p>
                                <p className="text-[10px] text-slate-500 mb-2">
                                    通过固定话术按钮，模拟数字人在早晨、中午、晚上和睡前主动发起家居陪伴与状态关心。
                                </p>
                                <div className="grid grid-cols-2 gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => executeFamilyControlAction('proactive_morning_check', {
                                            text: '早上好张爷爷，我已经帮您检查了今天的天气和用药安排，早餐吃得还好吗？一会儿记得按时吃药，我会提醒您的。',
                                        })}
                                        className="rounded-xl bg-sky-500 px-2 py-2 text-left text-[10px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                    >
                                        ☀️ 早安关怀
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => executeFamilyControlAction('proactive_noon_check', {
                                            text: '张爷爷，中午好，我来陪您聊一会儿。午饭吃得怎么样？如果有想去的地方或者想联系的家人，可以跟我说。',
                                        })}
                                        className="rounded-xl bg-emerald-500 px-2 py-2 text-left text-[10px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                    >
                                        🍚 午间问候
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => executeFamilyControlAction('proactive_evening_check', {
                                            text: '张爷爷，晚上好，我来看看您今天的状态。今天走路有没有累到？晚上的药我会再提醒您，睡前我们可以简单回顾一下今天的事情。',
                                        })}
                                        className="rounded-xl bg-indigo-500 px-2 py-2 text-left text-[10px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                    >
                                        🌆 晚间关心
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => executeFamilyControlAction('proactive_sleep_check', {
                                            text: '张爷爷，现在已经不早了，我来陪您做几个深呼吸，然后慢慢准备休息。有什么担心的事情也可以跟我说，我会帮您记下来提醒家人。',
                                        })}
                                        className="rounded-xl bg-slate-700 px-2 py-2 text-left text-[10px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                    >
                                        🌙 睡前陪伴
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="border-t border-slate-200 pt-3">
                            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 mb-2">
                                <Clock size={14} className="shrink-0" /> 语音建提醒与认知记录
                            </h3>
                            {careConsolePresetText && (
                                <div className="mb-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-2.5 py-2 text-[10px] leading-relaxed text-slate-600">
                                    {careConsolePresetText}
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => simulateVoiceCareFlowFromConsole('medication')}
                                    className="rounded-xl bg-blue-500 px-2.5 py-2.5 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    💊 语音建用药
                                </button>
                                <button
                                    type="button"
                                    onClick={() => simulateVoiceCareFlowFromConsole('followup')}
                                    className="rounded-xl bg-cyan-500 px-2.5 py-2.5 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    🏥 语音建复诊
                                </button>
                                <button
                                    type="button"
                                    onClick={() => simulateVoiceCareFlowFromConsole('hydration')}
                                    className="rounded-xl bg-sky-500 px-2.5 py-2.5 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    💧 喝水提醒
                                </button>
                                <button
                                    type="button"
                                    onClick={() => simulateVoiceCareFlowFromConsole('sleep')}
                                    className="rounded-xl bg-violet-500 px-2.5 py-2.5 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    🌙 睡眠提醒
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={simulateCognitiveCaptureFromConsole}
                                className="mt-2 w-full rounded-xl bg-slate-800 px-3 py-2.5 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                            >
                                🧠 模拟认知问答记录
                            </button>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => void simulateMedicationFromConsole('pending')}
                                    className="rounded-xl bg-amber-500 px-2.5 py-2.5 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    ⏰ 未服药提醒
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void simulateMedicationFromConsole('taken')}
                                    className="rounded-xl bg-emerald-500 px-2.5 py-2.5 text-left text-[11px] font-bold text-white shadow-sm active:scale-[0.98] transition-transform"
                                >
                                    ✅ 已服药确认
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={() => void simulateHomeLinkageFromConsole()}
                                className="mt-2 w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-[11px] font-bold text-emerald-800 shadow-sm active:scale-[0.98] transition-transform"
                            >
                                🏠 模拟到家联动
                            </button>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-slate-700">7天照护趋势</span>
                                <span className="text-indigo-600 font-semibold shrink-0">认知 {cognitiveTrendAverage} 分</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center">
                                <div className="rounded-xl bg-slate-50 px-1 py-2">
                                    <div className="text-[10px] text-slate-500">提醒完成率</div>
                                    <div className="text-sm font-bold text-slate-800">{carePanelTrend.completionRate}%</div>
                                </div>
                                <div className="rounded-xl bg-slate-50 px-1 py-2">
                                    <div className="text-[10px] text-slate-500">服药依从</div>
                                    <div className="text-sm font-bold text-slate-800">
                                        {medicationService.getStatistics(7).adherenceRate}%
                                    </div>
                                </div>
                                <div className="rounded-xl bg-slate-50 px-1 py-2">
                                    <div className="text-[10px] text-slate-500">黄昏峰值</div>
                                    <div className="text-sm font-bold text-slate-800">{sundowningSnapshot.riskScore}</div>
                                </div>
                            </div>
                            {carePanelAssessments.length > 0 && (
                                <div className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800 leading-relaxed">
                                    最新认知记录：{carePanelAssessments[carePanelAssessments.length - 1].prompt} ·{' '}
                                    {carePanelAssessments[carePanelAssessments.length - 1].response}
                                </div>
                            )}
                            {carePanelItems[0] && (
                                <div className="rounded-xl bg-sky-50 px-3 py-2 text-[11px] text-sky-800 leading-relaxed">
                                    下一提醒：{carePanelItems[0].title} · {carePanelItems[0].time}
                                </div>
                            )}
                            {careConsoleFlash && (
                                <div className="rounded-xl bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700 leading-relaxed">
                                    {careConsoleFlash}
                                </div>
                            )}
                            {careConsoleNotifyHint && (
                                <div className="rounded-xl bg-violet-50 px-3 py-2 text-[10px] text-violet-800 leading-relaxed">
                                    {careConsoleNotifyHint}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes shadowBreath { 0%, 100% { transform: translateX(-50%) scaleX(1.5) scaleY(1); opacity: 0.1; } 50% { transform: translateX(-50%) scaleX(1.4) scaleY(0.9); opacity: 0.05; } }
                @keyframes waveMic { 0%, 100% { height: 8px; } 50% { height: 24px; } }
                @keyframes beat { 0%, 100% { transform: scale(1); opacity: 0.5; } 50% { transform: scale(1.3); opacity: 0.8; } }
                .animate-shadow-breath { animation: shadowBreath 5s ease-in-out infinite; }
                .animate-wave-mic { animation: waveMic 1s ease-in-out infinite; }
                .animate-beat { animation: beat 1s ease-in-out infinite; }
                .animate-fade-in-up { animation: fadeInUp 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
                .perspective-1000 { perspective: 1000px; }
                @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
};

export default ElderlyApp;
