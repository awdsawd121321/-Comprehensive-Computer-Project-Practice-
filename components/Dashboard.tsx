
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { SimulationType, SystemStatus, LogEntry, DashboardTab } from '../types';
import AvatarStatus3D from './AvatarStatus3D';
import AvatarVRM from './AvatarVRM';
import { VoiceService, AvatarService } from '../services/api';
import { aiService, type CognitiveBrief, type ElderlyProfile } from '../services/aiService';
import { voiceSelectionService } from '../services/voiceSelectionService';
import { blobToWav, getAudioDurationSeconds } from '../utils/audioUtils';
import { healthStateService, HealthMetrics, HEALTHY_VITALS, SUBHEALTHY_VITALS, AvatarState } from '../services/healthStateService';
import { mapService } from '../services/mapService';
import { medicationService, Medication } from '../services/medicationService';
import { faceService, FaceData } from '../services/faceService';
import { locationAutomationService, LocationAutomationEvent, LocationAutomationState } from '../services/locationAutomationService';
import { wanderingService } from '../services/wanderingService';
import { ALBUM_MEMORIES } from '../config/albumMemories';
import { FACE_RECOGNITION_CONFIG } from '../config/faceRecognition';
import {
    sundowningService,
    SundowningInterventionPlan,
    SundowningPushAlert,
    SundowningRiskSnapshot,
} from '../services/sundowningService';
import { openclawSyncService } from '../services/openclawSyncService';
import { openclawActionService } from '../services/openclawActionService';
import { publishLocalUiCommand } from '../services/localUiCommandBus';
import { getOpenClawBridgeBaseUrl } from '../utils/runtimeConfig';
import { ShieldCheck, MapPin, Heart, Pill, AlertTriangle, Phone, Activity, Clock, User, Calendar, LayoutGrid, FileText, Settings, ChevronRight, Eye, Brain, Layers, Play, Pause, SkipBack, SkipForward, History, AlertCircle, Signal, Wifi, Battery, Moon, Footprints, Sun, Cloud, ArrowLeft, Mic, Upload, Sparkles, CheckCircle, Volume2, ToggleRight, Loader2, ScanFace, Box, Wand2, Plus, X, Users, Camera, TrendingUp, BookOpen, MessageCircle, MessageSquare, Link2, ArrowUpRight } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, AreaChart, Area, BarChart, Bar, CartesianGrid } from 'recharts';
import ReactMarkdown from 'react-markdown';

interface DashboardProps {
    status: SystemStatus;
    simulation: SimulationType;
    logs: LogEntry[];
}

/** 小节标题关键词，解析后从前端展示内容中移除，只保留「整体评估」「需要留意」「亲情建议」作为 UI 标题 */
const BRIEF_SECTION_TITLE_PATTERNS = [
    /^今日关键结论\s*[\n\r]*/,
    /^今日数据\s*[\n\r]*/,
    /^详细指标解读\s*[\n\r]*/,
    /^分析与建议\s*[\n\r]*/,
    /^子女照护建议\s*[\n\r]*/,
];

function stripSectionTitleFromBody(text: string): string {
    let s = text.trim();
    for (const re of BRIEF_SECTION_TITLE_PATTERNS) {
        s = s.replace(re, '');
    }
    return s.trim();
}

/** 从健康日报 Markdown 中解析出「整体评估 / 需要留意 / 亲情建议」三块简版内容，且不包含原始小节标题文字 */
function parseHealthBriefSections(md: string): { overall: string; pointsToNote: string; familySuggestions: string } {
    const sections: Record<string, string> = {};
    const parts = md.split(/\n(?=##\s+)/);
    for (const part of parts) {
        const titleMatch = part.match(/^##\s+(.+?)(?:\s*[\n\r]|$)/);
        if (!titleMatch) continue;
        const title = titleMatch[1].trim();
        const rawBody = part.replace(/^##\s+.+?[\n\r]*/, '').trim();
        const body = stripSectionTitleFromBody(rawBody);
        if (/今日关键结论|今日数据/.test(title)) sections.overall = body;
        else if (/详细指标解读/.test(title)) sections.pointsToNote = body;
        else if (/分析与建议/.test(title)) {
            if (!sections.pointsToNote) sections.pointsToNote = body;
            else if (!sections.familySuggestions) sections.familySuggestions = body;
        } else if (/子女照护建议/.test(title)) sections.familySuggestions = body;
    }
    return {
        overall: sections.overall ?? '',
        pointsToNote: sections.pointsToNote ?? '',
        familySuggestions: sections.familySuggestions ?? '',
    };
}

type GuardianNoticeTone = 'success' | 'warn' | 'error';

interface GuardianNoticeCard {
    title: string;
    message: string;
    status: string;
    tone: GuardianNoticeTone;
    timestamp: number;
}

function formatMonthDayTime(input: number | Date = new Date()): string {
    const date = input instanceof Date ? input : new Date(input);
    return date.toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

function formatClockLabel(input: number | Date = new Date()): string {
    const date = input instanceof Date ? input : new Date(input);
    return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

function getRiskLevelLabel(level: 'low' | 'medium' | 'high'): string {
    if (level === 'high') return '高风险';
    if (level === 'medium') return '中风险';
    return '低风险';
}

/** 定位 Tab 内容：独立组件保证引用稳定，避免父组件重渲染时卸载导致地图容器被销毁 */
interface LocationTabContentProps {
    mapContainerRef: React.RefObject<HTMLDivElement | null>;
    historyData: { lat: number; lng: number; time: Date; event?: { type: string; title: string; desc?: string } }[];
    historyIndex: number;
    setHistoryIndex: (v: number | ((prev: number) => number)) => void;
    isPlaying: boolean;
    setIsPlaying: (v: boolean) => void;
    trajectoryLoading: boolean;
    simulateNormalPath: () => void;
    simulateLostPath: () => void;
    resetToCurrentLocation: () => void;
    playbackIntervalRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
    POINT_INTERVAL_SEC: number;
    simulation: SimulationType;
    displayAddress: string;
    addressLoading?: boolean;
    /** 经纬度文案：有轨迹时为当前点，无轨迹时为预设模拟位置（与紫色点一致） */
    latLngText: string;
    /** 当前位置相关照片：多模态环境感知（不显示地图），与当前地址/POI 关联 */
    locationPhotoItems: { url: string; caption?: string }[];
    /** 是否使用 JS API 交互地图（可缩放、平移）；null=尚未尝试，true=使用 JS 地图，false=使用静态图 */
    useJsMap: boolean | null;
    /** 上方静态地图图片 URL（高德 Web 服务，仅 useJsMap=false 时显示） */
    topMapStaticUrl: string;
    /** 静态图中心（与 topMapStaticUrl 一致），用于叠加层坐标转换 */
    staticMapCenter: { lng: number; lat: number };
    /** 安全中心（电子围栏圆心）[lng, lat] */
    homePos: [number, number];
    /** 电子围栏半径（度，约 100m） */
    geofenceRadiusDeg: number;
    /** 环境语义分析（Groq）：老人周边安全与地理位置描述 */
    environmentAnalysis: string;
    environmentAnalysisLoading?: boolean;
}

const LocationTabContent: React.FC<LocationTabContentProps> = ({
    mapContainerRef,
    historyData,
    historyIndex,
    setHistoryIndex,
    isPlaying,
    setIsPlaying,
    trajectoryLoading,
    simulateNormalPath,
    simulateLostPath,
    resetToCurrentLocation,
    playbackIntervalRef,
    POINT_INTERVAL_SEC,
    simulation,
    displayAddress,
    addressLoading = false,
    latLngText,
    locationPhotoItems,
    useJsMap,
    topMapStaticUrl,
    staticMapCenter,
    homePos,
    geofenceRadiusDeg,
    environmentAnalysis,
    environmentAnalysisLoading = false,
}) => {
    const STATIC_MAP_ZOOM = 16;
    const STATIC_MAP_W = 800;
    const STATIC_MAP_H = 400;
    const toPx = (lng: number, lat: number) =>
        mapService.latLngToStaticMapPx(lng, lat, staticMapCenter.lng, staticMapCenter.lat, STATIC_MAP_ZOOM, STATIC_MAP_W, STATIC_MAP_H);
    const currentPos = historyData.length > 0 && historyData[historyIndex]
        ? { lng: historyData[historyIndex].lng, lat: historyData[historyIndex].lat }
        : { lng: homePos[0] + 0.00025, lat: homePos[1] + 0.0002 };
    const homePx = toPx(homePos[0], homePos[1]);
    const radiusPx = Math.abs(toPx(homePos[0], homePos[1] + geofenceRadiusDeg).y - homePx.y);
    const pastPath = historyData.length > 0 && historyIndex >= 0
        ? historyData.slice(0, historyIndex + 1).map((p) => toPx(p.lng, p.lat))
        : [];
    const futurePath = historyData.length > 0 && historyIndex < historyData.length - 1
        ? historyData.slice(historyIndex).map((p) => toPx(p.lng, p.lat))
        : [];
    const currentPx = toPx(currentPos.lng, currentPos.lat);

    return (
        <div className="flex flex-col h-full bg-slate-50">
            <div className="h-[55%] w-full relative group">
                <div id="guardian-map-container" ref={mapContainerRef} className="w-full h-full min-h-[280px] z-0 bg-slate-200 overflow-hidden relative">
                    {useJsMap === false && topMapStaticUrl ? (
                        <>
                            <img src={topMapStaticUrl} alt="当前位置地图" className="w-full h-full min-h-[280px] object-cover object-center" referrerPolicy="no-referrer" />
                            <div className="absolute inset-0 w-full h-full pointer-events-none" style={{ aspectRatio: `${STATIC_MAP_W}/${STATIC_MAP_H}` }}>
                                <svg className="w-full h-full" viewBox={`0 0 ${STATIC_MAP_W} ${STATIC_MAP_H}`} preserveAspectRatio="xMidYMid slice">
                                    {/* 电子围栏（绿色虚线圆） */}
                                    <circle cx={homePx.x} cy={homePx.y} r={radiusPx} fill="#34d399" fillOpacity="0.15" stroke="#10b981" strokeWidth="2" strokeDasharray="5 5" />
                                    {/* 历史轨迹（已走过） */}
                                    {pastPath.length >= 2 && (
                                        <polyline points={pastPath.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#94a3b8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                                    )}
                                    {/* 历史轨迹（未走） */}
                                    {futurePath.length >= 2 && (
                                        <polyline points={futurePath.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 4" />
                                    )}
                                    {/* 当前位置点 */}
                                    <circle cx={currentPx.x} cy={currentPx.y} r="10" fill="#6366f1" stroke="white" strokeWidth="3" />
                                    <circle cx={currentPx.x} cy={currentPx.y} r="16" fill="none" stroke="#6366f1" strokeWidth="2" opacity="0.5" />
                                </svg>
                            </div>
                        </>
                    ) : null}
                </div>
                <div className="absolute top-4 left-4 z-[400] bg-white/90 backdrop-blur-sm p-2 rounded-lg shadow-sm border border-slate-200">
                    <div className="text-[10px] space-y-1 text-slate-600 font-medium">
                        <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> 电子围栏
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div> 实时位置
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400">
                            <div className="w-1.5 h-1.5 rounded-full bg-slate-400"></div> 历史轨迹
                        </div>
                    </div>
                </div>
                <div className="absolute bottom-4 left-4 right-4 z-[400] bg-white/95 backdrop-blur-md p-3 rounded-xl shadow-lg border border-slate-200/60">
                    <div className="flex items-center gap-3 mb-1">
                        <button
                            type="button"
                            onClick={() => {
                                if (historyData.length === 0) return;
                                if (isPlaying && playbackIntervalRef.current) {
                                    clearInterval(playbackIntervalRef.current);
                                    playbackIntervalRef.current = null;
                                }
                                setIsPlaying(!isPlaying);
                            }}
                            disabled={historyData.length === 0}
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 shadow-md transition-colors"
                        >
                            {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
                        </button>
                        <div className="flex-1">
                            <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
                                <span className="text-slate-400">
                                    {historyData.length > 0 ? historyData[0].time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--'}
                                </span>
                                <span className="text-indigo-600">
                                    {historyData.length > 0 && historyData[historyIndex]
                                        ? historyData[historyIndex].time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                                        : '--'}
                                </span>
                                {historyData.length > 0 && historyIndex === historyData.length - 1 && (
                                    <span className="px-1 py-0.5 bg-red-100 text-red-600 rounded text-[9px]">LIVE</span>
                                )}
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={Math.max(0, historyData.length - 1)}
                                value={historyData.length ? Math.min(historyIndex, historyData.length - 1) : 0}
                                onChange={(e) => {
                                    if (playbackIntervalRef.current) {
                                        clearInterval(playbackIntervalRef.current);
                                        playbackIntervalRef.current = null;
                                    }
                                    setIsPlaying(false);
                                    setHistoryIndex(Number(e.target.value));
                                }}
                                disabled={historyData.length === 0}
                                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 disabled:opacity-50"
                            />
                            {historyData.length > 0 && (
                                <p className="text-[9px] text-slate-400 mt-0.5">
                                    共 {historyData.length} 点 · 每点 {POINT_INTERVAL_SEC} 秒 · 回溯 12 小时
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 pb-20 space-y-4">
                <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <MapPin size={14} /> 地理编码解析
                    </h3>
                    <div className="mb-3">
                        <p className="text-lg font-bold text-slate-800 leading-tight">
                            {displayAddress}
                            {addressLoading && <span className="text-slate-400 font-normal text-sm ml-1">(解析中…)</span>}
                        </p>
                        <p className="text-xs text-slate-500 font-mono mt-1">
                            {latLngText}
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="bg-slate-50 p-2 rounded-xl text-center">
                            <p className="text-[10px] text-slate-400">海拔</p>
                            <p className="font-bold text-slate-700">12m</p>
                        </div>
                        <div className="bg-slate-50 p-2 rounded-xl text-center">
                            <p className="text-[10px] text-slate-400">移动速度</p>
                            <p className="font-bold text-slate-700">{isPlaying ? '4.2 km/h' : '0 km/h'}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm overflow-hidden relative">
                    <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                        <Brain size={14} /> 多模态环境感知
                    </h3>
                    <p className="text-[10px] text-slate-500 mb-2 flex items-center gap-1">
                        <Eye size={10} /> 当前位置周边照片（与上方地址一致）
                    </p>
                    <div className="w-full flex gap-2 overflow-x-auto pb-1 no-scrollbar mb-3">
                        {locationPhotoItems.length > 0 ? locationPhotoItems.map((item, i) => (
                            <div key={i} className="flex-shrink-0 w-28 h-24 rounded-xl overflow-hidden bg-slate-100 relative group">
                                <img
                                    src={item.url}
                                    alt={item.caption || `位置照片 ${i + 1}`}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                        e.currentTarget.src = "https://images.unsplash.com/photo-1484154218962-a1c002085d2f?q=80&w=400&auto=format&fit=crop";
                                    }}
                                />
                                {item.caption ? (
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-1 py-0.5 truncate">{item.caption}</div>
                                ) : null}
                            </div>
                        )) : (
                            <div className="flex gap-2 flex-shrink-0">
                                <div className="w-28 h-24 rounded-xl overflow-hidden bg-slate-100">
                                    <img src="https://images.unsplash.com/photo-1484154218962-a1c002085d2f?q=80&w=400&auto=format&fit=crop" alt="位置照片" className="w-full h-full object-cover" />
                                </div>
                                <div className="w-28 h-24 rounded-xl overflow-hidden bg-slate-100">
                                    <img src="https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?q=80&w=400&auto=format&fit=crop" alt="位置照片" className="w-full h-full object-cover" />
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <div className="w-1 bg-indigo-500 rounded-full shrink-0"></div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-400 font-bold mb-1">环境语义分析 (Groq)</p>
                            {environmentAnalysisLoading ? (
                                <p className="text-sm text-slate-500">分析中…</p>
                            ) : environmentAnalysis ? (
                                <div className="text-sm text-slate-700 leading-relaxed report-markdown [&_h2]:font-bold [&_h2]:text-sm [&_h2]:mt-3 [&_h2]:mb-1 [&_h2:first-child]:mt-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-2 [&_li]:my-0.5 [&_p]:my-1 [&_strong]:font-semibold [&_strong]:text-slate-800">
                                    <ReactMarkdown>{environmentAnalysis}</ReactMarkdown>
                                </div>
                            ) : (
                                <p className="text-sm text-slate-500">暂无分析</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Mock Data - 使用 healthStateService 的基准心率（用于睡眠阶段示意）
const mockSleepData = [
    { name: '深睡', hours: 2.5, fill: '#3730A3' },
    { name: '浅睡', hours: 4.5, fill: '#818CF8' },
    { name: '清醒', hours: 1, fill: '#C4B5FD' },
];

const MIN_VOICE_SAMPLE_SECONDS = 10;

const buildRealtimeSeries = (baseBpm: number, basePressure: number, baseSpo2: number) => {
    const initial: { time: string; bpm: number; pressure: number; spo2: number }[] = [];
    const now = new Date();
    for (let i = 60; i >= 0; i--) {
        const t = new Date(now.getTime() - i * 1000);
        initial.push({
            time: t.toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            }),
            bpm: Math.round(baseBpm + Math.sin((now.getTime() - i * 1000) / 5000) * 6 + (Math.random() * 4 - 2)),
            pressure: Math.round(basePressure + Math.sin((now.getTime() - i * 1000) / 8000) * 8 + (Math.random() * 4 - 2)),
            spo2: Math.round(baseSpo2 + Math.sin((now.getTime() - i * 1000) / 7000) * 1.2 + (Math.random() * 1.5 - 0.75)),
        });
    }
    return initial;
};

function formatRealtimeTickLabel(value: string): string {
    const parts = value.split(':');
    if (parts.length >= 3) return `${parts[1]}:${parts[2]}`;
    return value;
}

function getRealtimeAxisTicks(data: { time: string }[]): string[] {
    if (data.length <= 1) return data.map((item) => item.time);
    const desiredSegments = 4;
    const step = Math.max(1, Math.round((data.length - 1) / desiredSegments));
    const tickIndexes = new Set<number>([0, data.length - 1]);
    for (let index = step; index < data.length - 1; index += step) {
        tickIndexes.add(index);
    }
    return Array.from(tickIndexes)
        .sort((a, b) => a - b)
        .map((index) => data[index]?.time)
        .filter((value): value is string => Boolean(value));
}

const RealTimeHealthCharts: React.FC<{ metrics: HealthMetrics }> = ({ metrics }) => {
    const [activeChart, setActiveChart] = useState<'heart' | 'bp' | 'spo2'>('heart');
    const [data, setData] = useState(() =>
        buildRealtimeSeries(
            metrics.heartRate,
            metrics.bloodPressure.systolic,
            metrics.bloodOxygen
        )
    );
    const [chartReady, setChartReady] = useState(false);

    const xAxisTicks = useMemo(() => getRealtimeAxisTicks(data), [data]);

    // 等布局稳定后再挂图表，避免 ResponsiveContainer 在首次测量时拿到 -1。
    useEffect(() => {
        setChartReady(false);
        let frame1 = 0;
        let frame2 = 0;
        frame1 = requestAnimationFrame(() => {
            frame2 = requestAnimationFrame(() => setChartReady(true));
        });
        return () => {
            cancelAnimationFrame(frame1);
            cancelAnimationFrame(frame2);
        };
    }, [activeChart]);

    // 当右侧控制面板调整生命体征时，重置曲线基线
    useEffect(() => {
        setData(
            buildRealtimeSeries(
                metrics.heartRate,
                metrics.bloodPressure.systolic,
                metrics.bloodOxygen
            )
        );
    }, [metrics.heartRate, metrics.bloodPressure.systolic, metrics.bloodOxygen]);

    useEffect(() => {
        const interval = setInterval(() => {
            setData((prevData) => {
                const now = new Date();
                const newPoint = {
                    time: now.toLocaleTimeString('en-US', {
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                    }),
                    bpm: Math.round(
                        metrics.heartRate +
                            Math.sin(now.getTime() / 5000) * 6 +
                            (Math.random() * 4 - 2)
                    ),
                    pressure: Math.round(
                        metrics.bloodPressure.systolic +
                            Math.sin(now.getTime() / 8000) * 8 +
                            (Math.random() * 4 - 2)
                    ),
                    spo2: Math.round(
                        metrics.bloodOxygen +
                            Math.sin(now.getTime() / 7000) * 1.2 +
                            (Math.random() * 1.5 - 0.75)
                    ),
                };
                return [...prevData.slice(1), newPoint];
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [metrics.heartRate, metrics.bloodPressure.systolic, metrics.bloodOxygen]);

    const latestBpm = data[data.length - 1]?.bpm ?? metrics.heartRate;
    const latestPressure = data[data.length - 1]?.pressure ?? metrics.bloodPressure.systolic;
    const latestSpo2 = data[data.length - 1]?.spo2 ?? metrics.bloodOxygen;

    const isHeartNormal = latestBpm >= 60 && latestBpm <= 100;
    const isPressureNormal = latestPressure >= 90 && latestPressure <= 140;
    const isSpo2Normal = latestSpo2 >= 95;

    const currentValue =
        activeChart === 'heart'
            ? latestBpm
            : activeChart === 'bp'
                ? latestPressure
                : latestSpo2;

    const currentUnit =
        activeChart === 'heart'
            ? 'bpm'
            : activeChart === 'bp'
                ? 'mmHg (收缩压)'
                : '%';

    const currentStatusNormal =
        activeChart === 'heart'
            ? isHeartNormal
            : activeChart === 'bp'
                ? isPressureNormal
                : isSpo2Normal;

    return (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex border-b border-slate-100">
                <button
                    onClick={() => setActiveChart('heart')}
                    className={`flex-1 py-3.5 text-sm font-semibold flex items-center justify-center gap-1.5 transition-all ${
                        activeChart === 'heart'
                            ? 'text-rose-600 border-b-2 border-rose-500 bg-rose-50/60'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50/50'
                    }`}
                >
                    <Heart size={15} /> 心率
                </button>
                <button
                    onClick={() => setActiveChart('bp')}
                    className={`flex-1 py-3.5 text-sm font-semibold flex items-center justify-center gap-1.5 transition-all ${
                        activeChart === 'bp'
                            ? 'text-indigo-600 border-b-2 border-indigo-500 bg-indigo-50/60'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50/50'
                    }`}
                >
                    <Activity size={15} /> 血压
                </button>
                <button
                    onClick={() => setActiveChart('spo2')}
                    className={`flex-1 py-3.5 text-sm font-semibold flex items-center justify-center gap-1.5 transition-all ${
                        activeChart === 'spo2'
                            ? 'text-sky-600 border-b-2 border-sky-500 bg-sky-50/60'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50/50'
                    }`}
                >
                    <Signal size={15} /> 血氧
                </button>
            </div>

            <div className="p-5">
                <div className="flex items-end gap-2 mb-4">
                    <span
                        className={`text-3xl font-bold tabular-nums ${
                            activeChart === 'heart'
                                ? 'text-rose-600'
                                : activeChart === 'bp'
                                    ? 'text-indigo-600'
                                    : 'text-sky-600'
                        }`}
                    >
                        {currentValue}
                    </span>
                    <span className="text-sm text-slate-400 mb-1">
                        {currentUnit}
                    </span>
                    <div
                        className={`ml-auto px-2.5 py-1 rounded-full text-xs font-medium border ${
                            currentStatusNormal ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                    >
                        {currentStatusNormal ? '正常' : '注意'}
                    </div>
                </div>

                <div className="h-52 min-w-0">
                    {chartReady ? (
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={208}>
                            <AreaChart data={data}>
                                <defs>
                                    <linearGradient id="heartGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.15} />
                                        <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="bpGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.15} />
                                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="spo2Grad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.18} />
                                        <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis
                                    dataKey="time"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                                    tickFormatter={formatRealtimeTickLabel}
                                    ticks={xAxisTicks}
                                    interval={0}
                                    tickMargin={8}
                                    minTickGap={20}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                                    domain={
                                        activeChart === 'heart'
                                            ? [60, 110]
                                            : activeChart === 'bp'
                                                ? [90, 150]
                                                : [90, 100]
                                    }
                                    width={30}
                                />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: '12px',
                                        border: 'none',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                                        fontSize: '12px',
                                    }}
                                    labelFormatter={(value) => `时间 ${formatRealtimeTickLabel(String(value))}`}
                                />
                                <Area
                                    type="monotone"
                                    dataKey={activeChart === 'heart' ? 'bpm' : activeChart === 'bp' ? 'pressure' : 'spo2'}
                                    stroke={
                                        activeChart === 'heart'
                                            ? '#f43f5e'
                                            : activeChart === 'bp'
                                                ? '#6366f1'
                                                : '#0ea5e9'
                                    }
                                    strokeWidth={2.5}
                                    fill={
                                        activeChart === 'heart'
                                            ? 'url(#heartGrad)'
                                            : activeChart === 'bp'
                                                ? 'url(#bpGrad)'
                                                : 'url(#spo2Grad)'
                                    }
                                    dot={false}
                                    activeDot={{ r: 4, stroke: 'white', strokeWidth: 2 }}
                                    isAnimationActive={false}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-full w-full rounded-2xl bg-slate-50 animate-pulse" />
                    )}
                </div>

                <div className="flex items-center justify-between mt-3 px-1">
                    <span className="text-xs text-slate-400">
                        {activeChart === 'heart'
                            ? '正常范围：60-100 bpm'
                            : activeChart === 'bp'
                                ? '正常范围：90-140 mmHg'
                                : '正常范围：≥95%'}
                    </span>
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Signal size={10} /> 实时
                    </span>
                </div>
            </div>
        </div>
    );
};

interface DashboardSettingsViewProps {
    onClose: () => void;
}

interface DashboardHealthTabProps {
    currentMetrics: HealthMetrics;
    activeAiTab: 'report' | 'cognitive';
    setActiveAiTab: (tab: 'report' | 'cognitive') => void;
    reportLoading: boolean;
    reportContent: string | null;
    generateReport: () => Promise<void>;
    cognitiveLoading: boolean;
    cognitiveBrief: CognitiveBrief | null;
    cognitiveContent: string | null;
    showHealthReportModal: boolean;
    setShowHealthReportModal: (value: boolean) => void;
    showCognitiveReportModal: boolean;
    setShowCognitiveReportModal: (value: boolean) => void;
}

const DashboardSettingsView: React.FC<DashboardSettingsViewProps> = ({ onClose }) => {
    const [cloneStep, setCloneStep] = useState<'idle' | 'recording' | 'processing' | 'done'>('idle');
    const [voiceProgress, setVoiceProgress] = useState(0);
    const [clonedVoiceName, setClonedVoiceName] = useState<string>('');
    const [clonedVoiceId, setClonedVoiceId] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordedAudio, setRecordedAudio] = useState<Blob | null>(null);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const recordingSecondsRef = useRef(0);
    const [allVoices, setAllVoices] = useState<{ id: string; name: string; isCloned?: boolean }[]>([]);
    const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(() =>
        voiceSelectionService.getSelectedVoiceId()
    );
    const [openclawStatus, setOpenclawStatus] = useState<{
        syncEnabled: boolean;
        elderId?: string;
        bridgeBaseUrl?: string;
        bridgeHealthy?: boolean;
        gatewayConfigured?: boolean;
        loading: boolean;
        error?: string;
    }>({
        syncEnabled: openclawSyncService.isEnabled(),
        elderId: openclawSyncService.getElderId(),
        bridgeBaseUrl: getOpenClawBridgeBaseUrl(),
        bridgeHealthy: undefined,
        gatewayConfigured: undefined,
        loading: false,
        error: undefined,
    });
    const [profile, setProfile] = useState<ElderlyProfile | null>(() => aiService.getProfile());
    const [savingProfile, setSavingProfile] = useState(false);
    const [profileHint, setProfileHint] = useState<string | null>(null);

    const loadVoices = async () => {
        const all = await VoiceService.getAllVoices();
        setAllVoices(all.map((v) => ({ id: v.id, name: v.name, isCloned: v.isCloned })));
    };

    useEffect(() => {
        loadVoices();
        const unsub = voiceSelectionService.subscribe((id) => setSelectedVoiceId(id));
        return unsub;
    }, []);

    useEffect(() => {
        const syncEnabled = openclawSyncService.isEnabled();
        const elderId = openclawSyncService.getElderId();
        const bridgeBaseUrl = getOpenClawBridgeBaseUrl();
        setOpenclawStatus((prev) => ({
            ...prev,
            syncEnabled,
            elderId,
            bridgeBaseUrl,
            loading: syncEnabled && !!bridgeBaseUrl,
            error: undefined,
        }));

        if (!syncEnabled || !bridgeBaseUrl) {
            return;
        }

        (async () => {
            try {
                const res = await fetch(`${bridgeBaseUrl}/healthz`, {
                    headers: {
                        ...(import.meta.env.VITE_OPENCLAW_BRIDGE_TOKEN
                            ? { 'x-emobit-bridge-token': import.meta.env.VITE_OPENCLAW_BRIDGE_TOKEN as string }
                            : {}),
                    },
                });
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const json = await res.json();
                setOpenclawStatus((prev) => ({
                    ...prev,
                    loading: false,
                    bridgeHealthy: !!json.ok,
                    gatewayConfigured: !!json.gatewayConfigured,
                }));
            } catch (error) {
                console.warn('[Settings] OpenClaw bridge health check failed:', error);
                setOpenclawStatus((prev) => ({
                    ...prev,
                    loading: false,
                    bridgeHealthy: false,
                    gatewayConfigured: false,
                    error: '无法连接到颐伴 Bridge，请检查 `npm run openclaw:bridge` 是否已启动以及 Token 配置。',
                }));
            }
        })();
    }, []);

    const handleGuardianFieldChange = (index: number, field: 'name' | 'relation' | 'phone', value: string) => {
        setProfile((prev) => {
            if (!prev) return prev;
            const nextMembers = [...prev.familyMembers];
            const current = nextMembers[index] || { name: '', relation: '家属', phone: '' };
            nextMembers[index] = { ...current, [field]: value };
            return { ...prev, familyMembers: nextMembers };
        });
    };

    const handleAddGuardian = () => {
        setProfile((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                familyMembers: [
                    ...prev.familyMembers,
                    { name: '', relation: '家属', phone: '' },
                ],
            };
        });
    };

    const handleRemoveGuardian = (index: number) => {
        setProfile((prev) => {
            if (!prev) return prev;
            const nextMembers = prev.familyMembers.filter((_, i) => i !== index);
            return { ...prev, familyMembers: nextMembers };
        });
    };

    const handleSaveGuardians = () => {
        if (!profile) return;
        setSavingProfile(true);
        try {
            aiService.setProfile(profile);
            setProfileHint('已保存家属联系人，并同步到 OpenClaw bridge。');
            setTimeout(() => setProfileHint(null), 2500);
        } finally {
            setSavingProfile(false);
        }
    };

    const handleStartRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mr = new MediaRecorder(stream);
            mediaRecorderRef.current = mr;
            audioChunksRef.current = [];
            recordingSecondsRef.current = 0;
            setRecordingSeconds(0);

            mr.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            mr.onstop = async () => {
                stream.getTracks().forEach((t) => t.stop());
                const raw = new Blob(audioChunksRef.current, {
                    type: mr.mimeType || 'audio/webm',
                });
                try {
                    const wav = await blobToWav(raw);
                    setRecordedAudio(wav);
                } catch (e) {
                    console.error('转 WAV 失败', e);
                    setRecordedAudio(raw);
                }
            };

            mr.start();
            setIsRecording(true);
            setCloneStep('recording');
            recordingTimerRef.current = setInterval(() => {
                recordingSecondsRef.current += 1;
                setRecordingSeconds(recordingSecondsRef.current);
            }, 1000);
        } catch (err) {
            console.error('录音失败:', err);
            alert('无法访问麦克风，请检查权限设置');
        }
    };

    const handleStopRecording = () => {
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }
        if (mediaRecorderRef.current && isRecording) {
            const secs = recordingSecondsRef.current;
            if (secs < MIN_VOICE_SAMPLE_SECONDS) {
                alert(`请至少录制 ${MIN_VOICE_SAMPLE_SECONDS} 秒。当前 ${secs} 秒。`);
                recordingSecondsRef.current = 0;
                setRecordingSeconds(0);
                return;
            }
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            recordingSecondsRef.current = 0;
            setRecordingSeconds(0);
            setCloneStep('idle');
        }
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('audio/')) {
            alert('请选择音频文件（WAV/MP3 等）');
            return;
        }
        try {
            const dur = await getAudioDurationSeconds(file);
            if (dur < MIN_VOICE_SAMPLE_SECONDS) {
                alert(`音频时长至少 ${MIN_VOICE_SAMPLE_SECONDS} 秒，当前约 ${dur.toFixed(1)} 秒。`);
                event.target.value = '';
                return;
            }
        } catch (e) {
            console.warn('无法解析音频时长，仍允许使用', e);
        }
        try {
            const wav = await blobToWav(file);
            setRecordedAudio(wav);
        } catch (e) {
            console.error('转 WAV 失败', e);
            setRecordedAudio(file);
        }
        setCloneStep('idle');
        event.target.value = '';
    };

    const handleSetAsCurrent = (id: string | null) => {
        voiceSelectionService.setSelectedVoiceId(id);
        setSelectedVoiceId(id);
        VoiceService.preloadClonePhrases(id ?? undefined);
    };

    const handleStartVoiceClone = async () => {
        if (!recordedAudio) {
            fileInputRef.current?.click();
            return;
        }

        console.log('[克隆] 开始流程, 音频大小:', recordedAudio.size);
        setCloneStep('processing');
        setVoiceProgress(0);

        let progressInterval: ReturnType<typeof setInterval> | null = null;
        try {
            const voiceName = clonedVoiceName || `子女声音_${new Date().toLocaleDateString()}`;
            progressInterval = setInterval(() => {
                setVoiceProgress((prev) => {
                    if (prev >= 90) return 90;
                    return prev + 10;
                });
            }, 300);

            console.log('[克隆] 调用 VoiceService.cloneVoice...');
            const result = await VoiceService.cloneVoice(recordedAudio, voiceName);

            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
            setVoiceProgress(100);
            console.log('[克隆] 结果', result);

            if (result.status === 'ready' && result.isCloned) {
                setClonedVoiceId(result.id);
                setCloneStep('done');
                await loadVoices();
                voiceSelectionService.setSelectedVoiceId(result.id);
                setSelectedVoiceId(result.id);
                VoiceService.preloadClonePhrases(result.id);
                console.log('[克隆] 完成，已切换为当前音色');
            } else if (result.status === 'failed') {
                throw new Error('克隆失败');
            } else {
                console.warn('[克隆] 服务不可用，使用预设音色');
                setCloneStep('idle');
                setVoiceProgress(0);
            }
        } catch (e) {
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
            const msg = e instanceof Error ? e.message : '未知错误';
            console.error('[克隆] 失败', e);
            alert(`语音克隆失败：${msg}\n\n请确认：\n1. 已启动语音克隆服务 (./scripts/start_voice_clone.sh)\n2. 浏览器控制台与服务器日志中的报错信息`);
            setCloneStep('idle');
            setVoiceProgress(0);
        }
    };

    const handlePreviewVoice = async () => {
        if (!clonedVoiceId) return;

        try {
            await VoiceService.speak('你好，我是你的数字人助手', clonedVoiceId);
        } catch (error) {
            console.error('试听失败:', error);
            alert('试听失败，请检查服务连接');
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#F8FAFC] animate-fade-in-up">
            <div className="px-5 py-4 flex items-center justify-between sticky top-0 z-10 bg-[#F8FAFC]/90 backdrop-blur-sm">
                <button
                    onClick={onClose}
                    className="p-2 -ml-2 text-slate-500 hover:text-slate-800 transition-colors"
                >
                    <ArrowLeft size={24} />
                </button>
                <h2 className="text-lg font-bold text-slate-800">系统设置</h2>
                <div className="w-8"></div>
            </div>

            <div className="p-5 space-y-6 pb-20">
                <div className="bg-gradient-to-br from-indigo-600 to-blue-600 rounded-[2rem] p-6 text-white shadow-xl shadow-indigo-200 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-40 h-40 bg-white opacity-10 rounded-full -mr-10 -mt-10 blur-3xl"></div>

                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-white/20 rounded-lg backdrop-blur-md border border-white/20">
                            <Mic size={20} className="text-yellow-300" />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg leading-tight">AI 语音克隆</h3>
                            <p className="text-[10px] text-indigo-100 opacity-80">Powered by Gemini Nano</p>
                        </div>
                    </div>

                    <p className="text-sm text-indigo-50 leading-relaxed mb-6 opacity-90">
                        直接录音 ≥10 秒或上传 ≥10 秒音频（WAV/MP3），整合为一份样本后用于克隆。克隆一次即存为一个音色，可在下方切换使用。
                    </p>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="audio/*"
                        onChange={handleFileUpload}
                        className="hidden"
                    />

                    {cloneStep === 'idle' && (
                        <div className="space-y-3">
                            <input
                                type="text"
                                placeholder="输入声音名称（如：女儿的声音）"
                                value={clonedVoiceName}
                                onChange={(e) => setClonedVoiceName(e.target.value)}
                                className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 text-sm focus:outline-none focus:ring-2 focus:ring-white/30"
                            />
                            <div className="bg-white/10 rounded-xl p-1 backdrop-blur-sm border border-white/20 flex gap-1">
                                <button
                                    onClick={isRecording ? handleStopRecording : handleStartRecording}
                                    className={`flex-1 py-3 rounded-lg font-bold text-sm shadow-sm flex items-center justify-center gap-2 active:scale-95 transition-transform ${isRecording ? 'bg-rose-500 text-white' : 'bg-white text-indigo-600'
                                        }`}
                                >
                                    <Mic size={16} />
                                    {isRecording ? '停止录音' : '开始录音'}
                                </button>
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex-1 bg-white/20 text-white py-3 rounded-lg font-bold text-sm shadow-sm flex items-center justify-center gap-2 active:scale-95 transition-transform hover:bg-white/30"
                                >
                                    <Upload size={16} /> 上传文件
                                </button>
                            </div>
                            {recordedAudio && (
                                <div className="bg-emerald-500/20 border border-emerald-400/30 rounded-xl p-3 flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-emerald-100 text-sm">
                                        <CheckCircle size={16} />
                                        已选择音频（≥10 秒）
                                    </div>
                                    <button
                                        onClick={handleStartVoiceClone}
                                        className="bg-white text-emerald-600 px-4 py-2 rounded-lg text-xs font-bold active:scale-95 transition-transform"
                                    >
                                        开始克隆
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {cloneStep === 'recording' && (
                        <div className="flex flex-col items-center justify-center py-2">
                            <div className="flex gap-1 h-8 items-center mb-2">
                                {[1, 2, 3, 4, 5].map((i) => (
                                    <div
                                        key={i}
                                        className="w-1.5 bg-white rounded-full animate-talk"
                                        style={{
                                            height: Math.random() * 20 + 10 + 'px',
                                            animationDelay: i * 0.1 + 's',
                                        }}
                                    />
                                ))}
                            </div>
                            <p className="text-sm font-mono text-white tabular-nums">
                                {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:
                                {String(recordingSeconds % 60).padStart(2, '0')}
                            </p>
                            <p className="text-xs text-indigo-100 mt-1">
                                至少 {MIN_VOICE_SAMPLE_SECONDS} 秒后可停止
                            </p>
                            <button
                                onClick={handleStopRecording}
                                disabled={recordingSeconds < MIN_VOICE_SAMPLE_SECONDS}
                                className="mt-3 px-4 py-2 bg-rose-500 text-white rounded-lg text-xs font-bold active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                停止录音
                            </button>
                        </div>
                    )}

                    {cloneStep === 'processing' && (
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs font-medium opacity-80">
                                <span>构建声纹模型</span>
                                <span>{voiceProgress}%</span>
                            </div>
                            <div className="h-2 bg-black/20 rounded-full overflow-hidden">
                                <div className="h-full bg-white rounded-full transition-all duration-150" style={{ width: `${voiceProgress}%` }}></div>
                            </div>
                        </div>
                    )}

                    {cloneStep === 'done' && (
                        <div className="bg-emerald-500/20 border border-emerald-400/30 rounded-xl p-3 flex flex-col gap-3 animate-fade-in">
                            <div className="flex items-center gap-2 text-emerald-100 text-sm font-bold">
                                <CheckCircle size={16} className="text-emerald-300" />
                                声音克隆完成！
                            </div>
                            <p className="text-xs text-emerald-100/80">已存为可切换音色，当前已设为使用中</p>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={handlePreviewVoice}
                                    className="bg-white/10 hover:bg-white/20 text-white text-xs py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5"
                                >
                                    <Play size={12} /> 试听效果
                                </button>
                                <button
                                    onClick={() =>
                                        VoiceService.speak(
                                            '你好，我是你的数字人助手，很高兴为你服务',
                                            clonedVoiceId || undefined
                                        )
                                    }
                                    className="bg-white text-emerald-600 text-xs py-2 rounded-lg font-bold shadow-sm flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                                >
                                    <Volume2 size={12} /> 发送问候
                                </button>
                            </div>
                            <button
                                onClick={() => {
                                    setCloneStep('idle');
                                    setRecordedAudio(null);
                                    setClonedVoiceId(null);
                                    setVoiceProgress(0);
                                }}
                                className="bg-white/10 hover:bg-white/20 text-white text-xs py-2 rounded-lg font-medium transition-colors"
                            >
                                克隆新声音
                            </button>
                        </div>
                    )}

                    <div className="mt-4 pt-4 border-t border-white/20">
                        <h4 className="text-xs font-bold text-indigo-100 uppercase tracking-wider mb-2">
                            TTS 音色 · 可切换（Edge 预设 + 克隆）
                        </h4>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                            {allVoices.map((v) => (
                                <div
                                    key={v.id}
                                    className="flex items-center justify-between gap-2 bg-white/10 rounded-lg px-3 py-2"
                                >
                                    <span className="text-sm text-white truncate flex-1">
                                        {v.name}
                                        {v.isCloned && (
                                            <span className="ml-1 text-[10px] text-amber-300">克隆</span>
                                        )}
                                        {(selectedVoiceId === v.id || (!selectedVoiceId && v.id === 'edge_xiaoyi')) && (
                                            <span className="ml-1 text-[10px] text-emerald-300">当前使用</span>
                                        )}
                                    </span>
                                    <div className="flex gap-1 shrink-0">
                                        <button
                                            onClick={() =>
                                                VoiceService.speak('你好，我是你的数字人助手', v.id)
                                            }
                                            className="px-2 py-1 bg-white/20 text-white text-[10px] rounded hover:bg-white/30"
                                        >
                                            试听
                                        </button>
                                        <button
                                            onClick={() => handleSetAsCurrent(v.id)}
                                            className="px-2 py-1 bg-white/20 text-white text-[10px] rounded hover:bg-white/30"
                                        >
                                            设为当前
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider pl-1">通用设置</h4>
                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-500">
                                <AlertCircle size={20} />
                            </div>
                            <div>
                                <p className="font-bold text-slate-800 text-sm">跌倒自动报警</p>
                            </div>
                        </div>
                        <ToggleRight size={28} className="text-indigo-600" />
                    </div>

                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-500">
                                    <Link2 size={18} />
                                </div>
                                <div>
                                    <p className="font-bold text-slate-800 text-sm">OpenClaw 同步</p>
                                    <p className="text-[11px] text-slate-500">
                                        {openclawStatus.syncEnabled
                                            ? `已启用，elderId=${openclawStatus.elderId || '未配置'}`
                                            : '未启用（检查 VITE_OPENCLAW_* 环境变量）'}
                                    </p>
                                </div>
                            </div>
                            <span
                                className={`flex items-center text-[11px] font-semibold ${
                                    openclawStatus.syncEnabled ? 'text-emerald-600' : 'text-slate-400'
                                }`}
                            >
                                <span
                                    className={`w-2 h-2 rounded-full mr-1 ${
                                        openclawStatus.syncEnabled ? 'bg-emerald-500' : 'bg-slate-300'
                                    }`}
                                />
                                {openclawStatus.syncEnabled ? 'ON' : 'OFF'}
                            </span>
                        </div>

                        {openclawStatus.bridgeBaseUrl && (
                            <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 space-y-1">
                                <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-1">
                                        <Wifi size={12} /> Bridge
                                    </span>
                                    <span
                                        className={`flex items-center gap-1 ${
                                            openclawStatus.loading
                                                ? 'text-slate-400'
                                                : openclawStatus.bridgeHealthy
                                                    ? 'text-emerald-600'
                                                    : 'text-rose-500'
                                        }`}
                                    >
                                        <span
                                            className={`w-2 h-2 rounded-full ${
                                                openclawStatus.loading
                                                    ? 'bg-slate-300'
                                                    : openclawStatus.bridgeHealthy
                                                        ? 'bg-emerald-500'
                                                        : 'bg-rose-500'
                                            }`}
                                        />
                                        {openclawStatus.loading
                                            ? '检测中…'
                                            : openclawStatus.bridgeHealthy
                                                ? '已连接'
                                                : '未连接'}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="flex items-center gap-1">
                                        <Activity size={12} /> Gateway
                                    </span>
                                    <span
                                        className={`${
                                            openclawStatus.gatewayConfigured ? 'text-emerald-600' : 'text-slate-400'
                                        }`}
                                    >
                                        {openclawStatus.gatewayConfigured ? '已配置' : '未知 / 未配置'}
                                    </span>
                                </div>
                                <p className="text-[10px] text-slate-400 pt-1">
                                    请先启动 `npm run openclaw:bridge`，并在 OpenClaw Gateway 中安装
                                    颐伴 OpenClaw 插件、消息通道和 `@openclaw/voice-call`。
                                </p>
                                {openclawStatus.error && (
                                    <p className="text-[10px] text-rose-500 pt-1">{openclawStatus.error}</p>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-500">
                                    <Users size={20} />
                                </div>
                                <div>
                                    <p className="font-bold text-slate-800 text-sm">家属联系人</p>
                                    <p className="text-[11px] text-slate-500">
                                        这里配置的家属姓名与手机号会同步到 OpenClaw，用于消息通知与语音外呼。
                                    </p>
                                </div>
                            </div>
                        </div>

                        {!profile ? (
                            <p className="text-xs text-slate-500">
                                当前尚未加载老人档案，请先在老人端完成基础资料配置。
                            </p>
                        ) : (
                            <>
                                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                                    {profile.familyMembers.map((member, index) => (
                                        <div
                                            key={`${member.name || 'guardian'}_${index}`}
                                            className="flex items-center gap-2"
                                        >
                                            <input
                                                className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
                                                placeholder="姓名"
                                                value={member.name}
                                                onChange={(e) =>
                                                    handleGuardianFieldChange(index, 'name', e.target.value)
                                                }
                                            />
                                            <input
                                                className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
                                                placeholder="关系"
                                                value={member.relation}
                                                onChange={(e) =>
                                                    handleGuardianFieldChange(index, 'relation', e.target.value)
                                                }
                                            />
                                            <input
                                                className="w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
                                                placeholder="手机号"
                                                value={member.phone || ''}
                                                onChange={(e) =>
                                                    handleGuardianFieldChange(index, 'phone', e.target.value)
                                                }
                                            />
                                            <button
                                                onClick={() => handleRemoveGuardian(index)}
                                                className="p-1 text-slate-400 hover:text-rose-500"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-center justify-between pt-2">
                                    <button
                                        onClick={handleAddGuardian}
                                        className="flex items-center gap-1 text-[11px] text-indigo-600 font-semibold"
                                    >
                                        <Plus size={14} /> 添加联系人
                                    </button>
                                    <button
                                        onClick={handleSaveGuardians}
                                        disabled={savingProfile}
                                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-[11px] font-bold rounded-lg"
                                    >
                                        {savingProfile ? '保存中…' : '保存并同步'}
                                    </button>
                                </div>
                                {profileHint && (
                                    <p className="text-[11px] text-emerald-600 pt-1 flex items-center gap-1">
                                        <CheckCircle size={12} /> {profileHint}
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <button className="w-full py-4 text-center text-rose-500 text-sm font-bold bg-rose-50 rounded-2xl border border-rose-100 hover:bg-rose-100 transition-colors">
                    退出登录
                </button>
            </div>
            <style>{`
                .animate-progress-indeterminate { animation: progressIndeterminate 1.5s infinite linear; }
                @keyframes progressIndeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
            `}</style>
        </div>
    );
};

const DashboardHealthTab: React.FC<DashboardHealthTabProps> = ({
    currentMetrics,
    activeAiTab,
    setActiveAiTab,
    reportLoading,
    reportContent,
    generateReport,
    cognitiveLoading,
    cognitiveBrief,
    cognitiveContent,
    showHealthReportModal,
    setShowHealthReportModal,
    showCognitiveReportModal,
    setShowCognitiveReportModal,
}) => {
    const totalSleepHours = mockSleepData.reduce((acc, d) => (d.name === '深睡' || d.name === '浅睡') ? acc + d.hours : acc, 0);
    const deepSleepHours = mockSleepData.find((d) => d.name === '深睡')?.hours ?? 0;
    const lightSleepHours = mockSleepData.find((d) => d.name === '浅睡')?.hours ?? 0;
    const awakeHours = mockSleepData.find((d) => d.name === '清醒')?.hours ?? 0;
    const deepRatio = totalSleepHours > 0 ? deepSleepHours / totalSleepHours : 0;
    const sleepMinutes = Math.round(totalSleepHours * 60);
    const displayHours = Math.floor(sleepMinutes / 60);
    const displayMins = sleepMinutes % 60;
    const sleepDisplay = `${displayHours}小时 ${displayMins > 0 ? displayMins + '分' : '0分'}`;
    const heartRate = currentMetrics.heartRate;
    const bloodPressure = currentMetrics.bloodPressure;
    const bloodOxygen = currentMetrics.bloodOxygen;

    const sleepScore = useMemo(() => {
        let s = 60;
        if (totalSleepHours >= 7 && totalSleepHours <= 9) s += 20;
        else if (totalSleepHours >= 6 && totalSleepHours < 7) s += 10;
        else if (totalSleepHours < 5) s -= 15;
        if (deepRatio >= 0.25 && deepRatio <= 0.45) s += 15;
        else if (deepRatio >= 0.2) s += 5;
        return Math.min(98, Math.max(55, s));
    }, [totalSleepHours, deepRatio]);

    const isHeartNormal = heartRate >= 60 && heartRate <= 100;
    const isBpHigh = bloodPressure.systolic >= 140 || bloodPressure.diastolic >= 90;
    const isBpBorderline = !isBpHigh && (bloodPressure.systolic >= 130 || bloodPressure.diastolic >= 85);
    const isBpNormal = !isBpHigh && !isBpBorderline;
    const isSpo2Normal = bloodOxygen >= 95;
    const isSleepGood = sleepScore >= 80;
    const isSleepBorderline = !isSleepGood && sleepScore >= 70;

    type HealthAlert = {
        key: string;
        title: string;
        value: string;
        normalRange: string;
        message: string;
        color: 'rose' | 'amber' | 'sky' | 'indigo';
    };

    const alerts: HealthAlert[] = [];

    if (!isHeartNormal) {
        alerts.push({
            key: 'heart',
            title: heartRate > 100 ? '心率偏快' : '心率偏慢',
            value: `${heartRate} bpm`,
            normalRange: '60-100 bpm',
            message: heartRate > 100
                ? '心率略快，可提醒爸爸稍作休息，避免剧烈运动，如持续心悸不适建议就医评估。'
                : '心率偏慢，如伴有头晕乏力、胸闷气短等症状，建议尽快就医评估心功能。',
            color: 'rose',
        });
    }

    if (!isBpNormal) {
        alerts.push({
            key: 'bp',
            title: isBpHigh ? '血压偏高' : '血压临界偏高',
            value: `${bloodPressure.systolic}/${bloodPressure.diastolic} mmHg`,
            normalRange: '90-120 / 60-80 mmHg',
            message: isBpHigh
                ? '血压已明显高于正常范围，建议密切观察，如反复偏高或伴头痛胸闷等不适，请及时就医。'
                : '血压略高，属于临界范围，可提醒爸爸清淡饮食、适度运动，注意作息并定期复测。',
            color: 'amber',
        });
    }

    if (!isSpo2Normal) {
        alerts.push({
            key: 'spo2',
            title: '血氧偏低',
            value: `${bloodOxygen}%`,
            normalRange: '≥95%',
            message: '血氧饱和度略低，如持续低于 93% 或出现明显气促、胸闷等，请尽快就医评估心肺功能。',
            color: 'sky',
        });
    }

    if (!isSleepGood && !isSleepBorderline) {
        alerts.push({
            key: 'sleep',
            title: '睡眠质量偏低',
            value: `${sleepScore} 分`,
            normalRange: '良好 ≥ 80 分',
            message: '昨夜睡眠时长和深睡比例偏少，可帮助爸爸调整作息，避免晚间浓茶咖啡和长时间看屏幕，如长期失眠建议就医。',
            color: 'indigo',
        });
    }

    const hasAttention = alerts.length > 0;

    const { sleepDescription } = useMemo(() => {
        const deepPct = Math.round(deepRatio * 100);
        let description: string;
        let tipsOrAffirmation: string;

        if (totalSleepHours >= 7 && deepRatio >= 0.25) {
            description = `昨日共睡 ${displayHours} 小时${displayMins > 0 ? ' ' + displayMins + ' 分' : ''}，其中深睡 ${deepSleepHours} 小时、浅睡 ${lightSleepHours} 小时。深睡占比约 ${deepPct}%，睡眠时长与结构均良好。`;
            tipsOrAffirmation = `睡眠情况良好，时长与深睡占比都不错，子女可放心。请继续保持规律作息与良好习惯。`;
        } else if (totalSleepHours >= 6) {
            description = `昨日共睡 ${displayHours} 小时${displayMins > 0 ? ' ' + displayMins + ' 分' : ''}，其中深睡 ${deepSleepHours} 小时、浅睡 ${lightSleepHours} 小时${awakeHours > 0 ? '，夜间清醒约 ' + awakeHours + ' 小时' : ''}。深睡占比约 ${deepPct}%，整体尚可，仍有优化空间。`;
            tipsOrAffirmation = `改善建议（子女可协助）：固定就寝与起床时间；白天适度活动、傍晚避免剧烈运动；睡前 1 小时避免屏幕与咖啡因；午睡不超过 30 分钟；卧室保持安静、昏暗。若持续入睡困难或早醒，可考虑就医排查睡眠障碍。`;
        } else {
            description = `昨日共睡 ${displayHours} 小时${displayMins > 0 ? ' ' + displayMins + ' 分' : ''}，其中深睡 ${deepSleepHours} 小时、浅睡 ${lightSleepHours} 小时${awakeHours > 0 ? '，夜间清醒约 ' + awakeHours + ' 小时' : ''}。睡眠时长偏少，深睡占比约 ${deepPct}%。`;
            tipsOrAffirmation = `改善建议（子女可协助）：固定就寝与起床时间，即使睡得晚也尽量同一时间起床；白天多接触自然光、适度活动；睡前避免饱餐、酒精与咖啡因；减少午睡或控制在 20 分钟内；睡前可做放松活动（如温水泡脚、听轻音乐）。若长期睡眠不足或日间困倦明显，建议到睡眠门诊或神经内科评估。`;
        }
        return { sleepDescription: description, sleepTipsOrAffirmation: tipsOrAffirmation };
    }, [totalSleepHours, deepRatio, deepSleepHours, lightSleepHours, awakeHours, displayHours, displayMins]);

    return (
        <div className="flex flex-col gap-5 p-4 pb-24 animate-fade-in-up bg-slate-50/80">
            {hasAttention ? (
                <>
                    <div className="bg-amber-50 border border-amber-200 px-4 py-4 rounded-3xl shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded-2xl bg-amber-100 flex items-center justify-center">
                                    <AlertTriangle size={18} className="text-amber-600" />
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-slate-800">需要您关注</p>
                                    <p className="text-[11px] text-slate-600">
                                        共 {alerts.length} 项指标超出理想范围，系统已为您整理说明与建议。
                                    </p>
                                </div>
                            </div>
                            <p className="text-[10px] text-slate-500">手环在线 · 实时监测</p>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                            <span>同步于 {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                            <span className="font-medium text-amber-700">{alerts.length} 项提醒</span>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {alerts.map((alert) => {
                            const bg =
                                alert.color === 'rose'
                                    ? 'bg-rose-50 border-rose-100'
                                    : alert.color === 'amber'
                                        ? 'bg-amber-50 border-amber-100'
                                        : alert.color === 'sky'
                                            ? 'bg-sky-50 border-sky-100'
                                            : 'bg-indigo-50 border-indigo-100';
                            const dot =
                                alert.color === 'rose'
                                    ? 'bg-rose-400'
                                    : alert.color === 'amber'
                                        ? 'bg-amber-400'
                                        : alert.color === 'sky'
                                            ? 'bg-sky-400'
                                            : 'bg-indigo-400';
                            const valueColor =
                                alert.color === 'rose'
                                    ? 'text-rose-600'
                                    : alert.color === 'amber'
                                        ? 'text-amber-600'
                                        : alert.color === 'sky'
                                            ? 'text-sky-600'
                                            : 'text-indigo-600';

                            return (
                                <div key={alert.key} className={`${bg} border rounded-3xl p-4 shadow-sm`}>
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                                            <p className="text-sm font-semibold text-slate-800">{alert.title}</p>
                                        </div>
                                        <span className="text-[11px] text-slate-500">
                                            {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 mb-3">
                                        <div className="bg-white/80 rounded-2xl px-3 py-2.5 border border-slate-100">
                                            <p className="text-[11px] text-slate-500 mb-1">当前检测值</p>
                                            <p className={`text-xl font-bold tabular-nums ${valueColor}`}>{alert.value}</p>
                                        </div>
                                        <div className="bg-white/80 rounded-2xl px-3 py-2.5 border border-slate-100">
                                            <p className="text-[11px] text-slate-500 mb-1">参考正常范围</p>
                                            <p className="text-sm font-semibold text-slate-700">{alert.normalRange}</p>
                                        </div>
                                    </div>
                                    <div className="bg-white/80 rounded-2xl px-3 py-2.5 mb-2 border border-slate-100">
                                        <p className="text-xs text-slate-600 leading-relaxed">
                                            {alert.message}
                                        </p>
                                    </div>
                                    <button className="text-xs text-slate-600 font-medium hover:text-slate-800">
                                        查看该指标历史趋势 &gt;
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </>
            ) : (
                <div className="bg-white border border-emerald-100 rounded-3xl p-4 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-full -mr-8 -mt-8" />
                    <div className="relative z-10 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-100">
                                <ShieldCheck size={18} className="text-emerald-600" />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-800">今日暂无线索需特别关注</p>
                                <p className="text-[11px] text-slate-600">生命体征整体稳定，请继续保持良好作息</p>
                            </div>
                        </div>
                        <p className="text-[11px] text-slate-500">{new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</p>
                    </div>
                </div>
            )}

            <div className="flex items-center gap-2 px-1 mt-1">
                <h3 className="text-base font-bold text-slate-800">实时体征监测</h3>
                <div className="flex-1 h-px bg-slate-200/80"></div>
            </div>

            <RealTimeHealthCharts metrics={currentMetrics} />

            <div className="flex items-center gap-2 px-1 mt-1">
                <h3 className="text-base font-bold text-slate-800">昨夜睡眠</h3>
                <div className="flex-1 h-px bg-slate-200/80"></div>
                <button type="button" className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-0.5">
                    查看详情 <ChevronRight size={14} className="inline" />
                </button>
            </div>

            <div className="bg-white rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-gray-100/80">
                <div
                    className="p-4 text-white relative overflow-hidden"
                    style={{ background: 'linear-gradient(135deg, #4338CA 0%, #6366F1 50%, #818CF8 100%)' }}
                >
                    <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-white/10" />
                    <div className="relative flex items-center justify-between">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <Moon className="w-4 h-4 text-white/80" />
                                <span className="text-[12px] text-white/70">
                                    入睡 22:30 — 起床 05:30
                                </span>
                            </div>
                            <div className="flex items-baseline gap-2">
                                <span className="text-[28px] font-extrabold leading-none">{sleepDisplay}</span>
                            </div>
                            <div className="flex items-center gap-1 mt-1.5">
                                <ArrowUpRight className="w-3 h-3 text-[#A5F3FC]" />
                                <span className="text-[11px] text-[#A5F3FC]">较前一晚 +0.5h</span>
                            </div>
                        </div>
                        <div className="flex flex-col items-center">
                            <div className="relative">
                                <svg width="56" height="56" viewBox="0 0 56 56">
                                    <circle cx="28" cy="28" r="23" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="5" />
                                    <circle
                                        cx="28"
                                        cy="28"
                                        r="23"
                                        fill="none"
                                        stroke="#FFFFFF"
                                        strokeWidth="5"
                                        strokeDasharray={`${(sleepScore / 100) * 144.5} 144.5`}
                                        strokeLinecap="round"
                                        transform="rotate(-90 28 28)"
                                    />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-white" style={{ fontSize: '18px', fontWeight: 800, lineHeight: 1 }}>
                                        {sleepScore}
                                    </span>
                                </div>
                            </div>
                            <span className="text-[10px] text-white/60 mt-1">
                                {sleepScore >= 90 ? '优秀' : sleepScore >= 70 ? '一般' : '较差'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="p-4">
                    <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[11px] text-gray-400">睡眠阶段分布</p>
                        <div className="flex gap-3">
                            <div className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#3730A3' }} />
                                <span className="text-[10px] text-gray-400">深睡</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#818CF8' }} />
                                <span className="text-[10px] text-gray-400">浅睡</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#C4B5FD' }} />
                                <span className="text-[10px] text-gray-400">REM</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-[2px] mb-4 h-6 rounded-lg overflow-hidden">
                        {[
                            { type: 'light', w: 12 },
                            { type: 'deep', w: 18 },
                            { type: 'light', w: 8 },
                            { type: 'rem', w: 10 },
                            { type: 'deep', w: 16 },
                            { type: 'light', w: 14 },
                            { type: 'rem', w: 8 },
                            { type: 'light', w: 14 },
                        ].map((block, i) => {
                            const colorMap: Record<string, string> = {
                                deep: '#3730A3',
                                light: '#818CF8',
                                rem: '#C4B5FD',
                            };
                            return (
                                <div
                                    key={i}
                                    className="h-full rounded-sm"
                                    style={{ width: `${block.w}%`, backgroundColor: colorMap[block.type] }}
                                />
                            );
                        })}
                    </div>

                    {(() => {
                        const totalH = totalSleepHours || 1;
                        const stages = [
                            { label: '深睡', hours: deepSleepHours, color: '#3730A3', desc: '充足' },
                            { label: '浅睡', hours: lightSleepHours, color: '#818CF8', desc: '正常' },
                            { label: 'REM', hours: awakeHours, color: '#C4B5FD', desc: '正常' },
                        ];
                        return (
                            <div className="flex gap-2 mb-3">
                                {stages.map((stage) => (
                                    <div key={stage.label} className="flex-1 bg-gray-50 rounded-xl p-2.5">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-[12px] text-gray-500">{stage.label}</span>
                                            <span
                                                className="text-[10px] px-1.5 py-0.5 rounded-md"
                                                style={{
                                                    backgroundColor: `${stage.color}10`,
                                                    color: stage.color,
                                                    fontWeight: 500,
                                                }}
                                            >
                                                {stage.desc}
                                            </span>
                                        </div>
                                        <div className="flex items-baseline justify-between">
                                            <span style={{ fontSize: '16px', fontWeight: 700, color: stage.color }}>
                                                {stage.hours}h
                                            </span>
                                            <span className="text-[11px] text-gray-400">
                                                {Math.round((stage.hours / totalH) * 100)}%
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        );
                    })()}

                    <div className="bg-[#F0FDF4] rounded-xl px-3 py-2.5 flex items-start gap-2">
                        <span className="text-[13px] mt-0.5">💡</span>
                        <p className="text-[12px] text-[#166534] leading-relaxed">
                            {sleepDescription}
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 px-1 mt-1">
                <h3 className="text-base font-bold text-[#1C2A3A]">AI 智能分析</h3>
                <span
                    className="px-2 py-0.5 rounded-md text-[9px] font-semibold text-white"
                    style={{ background: 'linear-gradient(135deg, #3478F6, #5856D6)' }}
                >
                    AI
                </span>
                <div className="flex-1 h-px bg-slate-200/80"></div>
            </div>

            <div className="bg-white rounded-3xl border border-black/5 shadow-sm overflow-hidden">
                <div className="bg-[#ECEEF3] rounded-xl mx-3 mt-3 mb-2 p-1 flex gap-1">
                    <button
                        onClick={() => setActiveAiTab('report')}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] transition-all ${
                            activeAiTab === 'report' ? 'bg-white shadow-sm text-[#1C2A3A]' : 'text-[#98A5B3]'
                        }`}
                        style={activeAiTab === 'report' ? { fontWeight: 600 } : {}}
                    >
                        <FileText className="w-3.5 h-3.5" />
                        健康日报
                    </button>
                    <button
                        onClick={() => setActiveAiTab('cognitive')}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px] transition-all ${
                            activeAiTab === 'cognitive' ? 'bg-white shadow-sm text-[#1C2A3A]' : 'text-[#98A5B3]'
                        }`}
                        style={activeAiTab === 'cognitive' ? { fontWeight: 600 } : {}}
                    >
                        <Brain className="w-3.5 h-3.5" />
                        认知评估
                    </button>
                </div>

                <div className="p-4 pt-2">
                    {activeAiTab === 'report' ? (
                        <div className="bg-white rounded-2xl overflow-hidden shadow-[0_1px_8px_rgba(0,0,0,0.04)] border border-black/[0.04]">
                            <div
                                className="p-4 relative overflow-hidden"
                                style={{ background: 'linear-gradient(135deg, #4338CA 0%, #6366F1 50%, #818CF8 100%)' }}
                            >
                                <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-white/10" />
                                <div className="absolute bottom-2 right-16 w-8 h-8 rounded-full bg-white/5" />

                                <div className="relative flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                                        <Sparkles className="w-5 h-5 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-white" style={{ fontSize: '15px', fontWeight: 700 }}>
                                            爸爸的健康日报
                                        </h3>
                                        <p className="text-white/60 text-[11px] mt-0.5">
                                            综合体征数据 + 认知交互记录分析生成
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-4">
                                {reportLoading && (
                                    <div className="flex flex-col items-center justify-center py-6">
                                        <Loader2 size={24} className="animate-spin mb-2 text-white" />
                                        <p className="text-[11px] text-white/80">正在生成今日健康日报…</p>
                                    </div>
                                )}

                                {!reportContent && !reportLoading && (
                                    <div className="flex flex-col items-center justify-center py-6">
                                        <p className="text-[11px] text-white/80">即将生成…</p>
                                    </div>
                                )}

                                {reportContent && !reportLoading && (() => {
                                    const isError = reportContent.includes('出错') || reportContent.includes('失败');
                                    if (isError) {
                                        return (
                                            <div className="space-y-3">
                                                <p className="text-[11px] text-white/90">{reportContent}</p>
                                                <button
                                                    onClick={() => generateReport()}
                                                    className="w-full h-9 rounded-2xl text-white text-xs font-semibold flex items-center justify-center gap-1 active:scale-[0.98] transition-all"
                                                    style={{ background: 'linear-gradient(135deg, #3478F6 0%, #5856D6 100%)' }}
                                                >
                                                    重新生成健康日报
                                                </button>
                                            </div>
                                        );
                                    }
                                    const { overall, pointsToNote, familySuggestions } = parseHealthBriefSections(reportContent);
                                    return (
                                        <div className="space-y-3">
                                            <div className="bg-white rounded-2xl p-4 text-[#1C2A3A] space-y-4 border border-black/[0.04] shadow-sm">
                                                {overall && (
                                                    <div className="flex gap-3">
                                                        <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                                                            <ShieldCheck className="text-emerald-600" size={16} />
                                                        </div>
                                                        <div>
                                                            <p className="text-[13px] mb-1" style={{ fontWeight: 600 }}>
                                                                整体评估
                                                            </p>
                                                            <div className="report-markdown text-[12px] leading-relaxed text-[#5E6C7B]">
                                                                <ReactMarkdown>{overall}</ReactMarkdown>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                                {pointsToNote && (
                                                    <div className="flex gap-3">
                                                        <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
                                                            <TrendingUp className="text-amber-600" size={16} />
                                                        </div>
                                                        <div>
                                                            <p className="text-[13px] mb-1" style={{ fontWeight: 600 }}>
                                                                需要留意
                                                            </p>
                                                            <div className="report-markdown text-[12px] leading-relaxed text-[#5E6C7B]">
                                                                <ReactMarkdown>{pointsToNote}</ReactMarkdown>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                                {familySuggestions && (
                                                    <div className="flex gap-3">
                                                        <div className="w-8 h-8 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center shrink-0">
                                                            <Heart className="text-sky-600" size={16} />
                                                        </div>
                                                        <div>
                                                            <p className="text-[13px] mb-1" style={{ fontWeight: 600 }}>
                                                                亲情建议
                                                            </p>
                                                            <div className="report-markdown text-[12px] leading-relaxed text-[#5E6C7B]">
                                                                <ReactMarkdown>{familySuggestions}</ReactMarkdown>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => setShowHealthReportModal(true)}
                                                className="w-full h-10 rounded-xl text-white text-[12px] flex items-center justify-center gap-1 active:scale-[0.98] transition-all"
                                                style={{ background: 'linear-gradient(135deg, #3478F6 0%, #5856D6 100%)' }}
                                            >
                                                查看完整报告 <ChevronRight className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-emerald-50/90 rounded-2xl border border-emerald-200 overflow-hidden">
                            <div className="flex items-center justify-between px-4 pt-4 pb-2">
                                <div className="flex items-center gap-2">
                                    <Brain className="text-emerald-600" size={20} />
                                    <div>
                                        <p className="text-sm font-bold text-slate-800">爸爸的认知评估</p>
                                        <p className="text-[11px] text-slate-600">基于日常对话的NLP 智能分析</p>
                                    </div>
                                </div>
                                {cognitiveBrief && (
                                    <div className="flex flex-col items-center">
                                        <div className="w-12 h-12 rounded-full bg-emerald-500 border-2 border-emerald-400 flex items-center justify-center text-white font-bold text-lg">
                                            {cognitiveBrief.overallScore}
                                        </div>
                                        <p className="text-[10px] text-slate-600 mt-0.5">综合分</p>
                                    </div>
                                )}
                            </div>

                            {!cognitiveBrief && (
                                <div className="flex flex-col items-center justify-center py-10">
                                    <Loader2 size={24} className="animate-spin mb-2 text-emerald-500" />
                                    <p className="text-[11px] text-slate-500">正在生成认知评估报告…</p>
                                </div>
                            )}

                            {cognitiveBrief && !cognitiveLoading && (
                                <div className="px-4 pb-4 space-y-3">
                                    <div className="grid grid-cols-2 gap-2">
                                        {cognitiveBrief.dimensions.map((d) => {
                                            const colorMap: Record<string, { bg: string; text: string; bar: string }> = {
                                                semantic: { bg: 'bg-emerald-100', text: 'text-emerald-700', bar: 'bg-emerald-500' },
                                                vocabulary: { bg: 'bg-sky-100', text: 'text-sky-700', bar: 'bg-sky-500' },
                                                emotion: { bg: 'bg-amber-100', text: 'text-amber-700', bar: 'bg-amber-500' },
                                                memory: { bg: 'bg-violet-100', text: 'text-violet-700', bar: 'bg-violet-500' },
                                            };
                                            const c = colorMap[d.id] || colorMap.semantic;
                                            const Icon = d.id === 'semantic' ? Brain : d.id === 'vocabulary' ? BookOpen : d.id === 'emotion' ? MessageCircle : Link2;
                                            return (
                                                <div key={d.id} className="bg-white rounded-xl p-2.5 shadow-sm border border-slate-100">
                                                    <div className="flex items-center gap-1.5 mb-1">
                                                        <Icon size={14} className={c.text} />
                                                        <span className="text-[11px] font-medium text-slate-700">{d.name}</span>
                                                    </div>
                                                    <p className={`text-[11px] font-semibold ${c.text}`}>{d.status} {d.score}</p>
                                                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-1">
                                                        <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${d.score}%` }} />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="bg-white rounded-xl border border-slate-100 overflow-hidden shadow-sm">
                                        <div className="bg-violet-50 px-3 py-1.5 flex items-center gap-1.5">
                                            <MessageCircle size={14} className="text-violet-600" />
                                            <span className="text-xs font-semibold text-slate-800">近期交互评估</span>
                                        </div>
                                        <p className="px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                                            {cognitiveBrief.recentInteractionEvaluation}
                                        </p>
                                    </div>
                                    <div className="bg-white rounded-xl border border-slate-100 overflow-hidden shadow-sm">
                                        <div className="bg-sky-50 px-3 py-1.5 flex items-center gap-1.5">
                                            <Heart size={14} className="text-sky-600" />
                                            <span className="text-xs font-semibold text-slate-800">陪伴建议</span>
                                        </div>
                                        <p className="px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                                            {cognitiveBrief.accompanyingSuggestions}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setShowCognitiveReportModal(true)}
                                        className="w-full h-10 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                                    >
                                        <Brain size={14} />
                                        查看详细认知报告
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {showHealthReportModal && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40">
                    <div className="w-full max-w-sm mx-auto px-3">
                        <div className="bg-white rounded-3xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
                            <div className="bg-gradient-to-br from-indigo-500 to-violet-500 px-5 pt-5 pb-4 text-white relative">
                                <div className="flex items-center justify-between mb-3">
                                    <div>
                                        <p className="text-xs opacity-90">
                                            {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
                                        </p>
                                        <p className="text-lg font-bold mt-1">爸爸的健康日报</p>
                                        <p className="text-[11px] text-indigo-100/80">基于今日全天体征数据综合分析</p>
                                    </div>
                                    <div className="flex flex-col items-end gap-2">
                                        <button
                                            onClick={() => setShowHealthReportModal(false)}
                                            className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto bg-slate-50 px-5 py-4">
                                {reportLoading && (
                                    <div className="flex flex-col items-center justify-center py-10 text-slate-500 text-sm">
                                        <Loader2 className="animate-spin mb-3 text-indigo-500" size={28} />
                                        正在生成完整健康日报…
                                    </div>
                                )}
                                {!reportLoading && reportContent && (
                                    <div className="bg-white rounded-2xl p-4 shadow-sm">
                                        <div className="report-markdown font-sans text-sm leading-relaxed text-slate-800">
                                            <ReactMarkdown>{reportContent}</ReactMarkdown>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showCognitiveReportModal && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40">
                    <div className="w-full max-w-sm mx-auto px-3">
                        <div className="bg-white rounded-3xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
                            <div className="bg-gradient-to-br from-emerald-500 to-sky-500 px-5 pt-5 pb-4 text-white relative">
                                <div className="flex items-center justify-between mb-3">
                                    <div>
                                        <p className="text-xs opacity-90">
                                            {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
                                        </p>
                                        <p className="text-lg font-bold mt-1">爸爸的认知评估</p>
                                        <p className="text-[11px] text-emerald-100/80">基于今日对话的 NLP 深度分析</p>
                                    </div>
                                    <div className="flex flex-col items-end gap-2">
                                        <button
                                            onClick={() => setShowCognitiveReportModal(false)}
                                            className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto bg-slate-50 px-5 py-4">
                                {cognitiveLoading && (
                                    <div className="flex flex-col items-center justify-center py-10 text-slate-500 text-sm">
                                        <Loader2 className="animate-spin mb-3 text-emerald-500" size={28} />
                                        正在生成认知评估报告…
                                    </div>
                                )}
                                {!cognitiveLoading && cognitiveContent && (
                                    <div className="bg-white rounded-2xl p-4 shadow-sm">
                                        <div className="report-markdown font-sans text-sm leading-relaxed text-slate-800">
                                            <ReactMarkdown>{cognitiveContent}</ReactMarkdown>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showHealthReportModal && reportContent && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
                    <div className="w-[92%] max-w-md max-h-[90vh] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col">
                        <div className="bg-gradient-to-br from-violet-500 to-indigo-500 px-5 pt-4 pb-3 text-white relative">
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <p className="text-xs opacity-80">
                                        {new Date().toLocaleDateString('zh-CN', {
                                            year: 'numeric',
                                            month: 'long',
                                            day: 'numeric',
                                            weekday: 'long',
                                        })}
                                    </p>
                                    <p className="mt-1 text-base font-bold">爸爸的健康日报</p>
                                    <p className="text-[11px] text-indigo-100/80">
                                        基于今天全天体征数据综合分析
                                    </p>
                                </div>
                                <button
                                    onClick={() => setShowHealthReportModal(false)}
                                    className="w-7 h-7 flex items-center justify-center rounded-full bg-white/15 text-white/90 hover:bg-white/25"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        </div>
                        <div className="px-5 py-4 overflow-y-auto">
                            <div className="report-markdown font-sans text-[13px] leading-relaxed text-slate-800 [&_h2]:text-base [&_h2]:font-bold [&_h2]:mt-3 [&_h2:first-child]:mt-0 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold">
                                <ReactMarkdown>{reportContent}</ReactMarkdown>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showCognitiveReportModal && cognitiveContent && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
                    <div className="w-[92%] max-w-md max-h-[90vh] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col">
                        <div className="bg-gradient-to-br from-emerald-500 to-teal-500 px-5 pt-4 pb-3 text-white relative">
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <p className="text-xs opacity-80">
                                        {new Date().toLocaleDateString('zh-CN', {
                                            year: 'numeric',
                                            month: 'long',
                                            day: 'numeric',
                                            weekday: 'long',
                                        })}
                                    </p>
                                    <p className="mt-1 text-base font-bold">爸爸的认知评估</p>
                                    <p className="text-[11px] text-emerald-100/80">
                                        基于今日对话的 NLP 深度分析
                                    </p>
                                </div>
                                <button
                                    onClick={() => setShowCognitiveReportModal(false)}
                                    className="w-7 h-7 flex items-center justify-center rounded-full bg-white/15 text-white/90 hover:bg-white/25"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        </div>
                        <div className="px-5 py-4 overflow-y-auto">
                            <div className="report-markdown font-sans text-[13px] leading-relaxed text-slate-800 [&_h2]:text-base [&_h2]:font-bold [&_h2]:mt-3 [&_h2:first-child]:mt-0 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold">
                                <ReactMarkdown>{cognitiveContent}</ReactMarkdown>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const DashboardFaceAlbumTab: React.FC = () => {
    const [faces, setFaces] = useState<FaceData[]>(() => faceService.getFaces());
    const [showAddModal, setShowAddModal] = useState(false);
    const [form, setForm] = useState({
        name: '',
        relation: '',
        imageUrl: '',
        description: ''
    });

    const refreshList = () => setFaces(faceService.getFaces());

    const handleAddSubmit = () => {
        if (!form.name || !form.imageUrl) return;
        faceService.addFace({
            name: form.name,
            relation: form.relation || '亲友',
            imageUrl: form.imageUrl,
            description: form.description
        });
        refreshList();
        setForm({ name: '', relation: '', imageUrl: '', description: '' });
        setShowAddModal(false);
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('确定要删除这张照片吗？')) {
            faceService.deleteFace(id);
            refreshList();
        }
    };

    return (
        <div className="flex flex-col gap-5 p-5 pb-24 animate-fade-in-up">
            <div>
                <h2 className="text-xl font-bold text-slate-800 mb-3">时光相册</h2>
                <p className="text-xs text-slate-500 mb-3">老人端相册中的照片，用于回忆唤起</p>
                <div className="grid grid-cols-2 gap-3">
                    {ALBUM_MEMORIES.map((photo) => (
                        <div key={photo.id} className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
                            <div className="aspect-square rounded-xl overflow-hidden bg-slate-100 mb-2">
                                <img src={photo.url} alt={photo.location} className="w-full h-full object-cover" />
                            </div>
                            <h4 className="font-bold text-slate-800 text-sm truncate">{photo.location}</h4>
                            <p className="text-xs text-slate-500 mt-0.5 truncate">{photo.date}</p>
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <div className="flex justify-between items-center mb-3">
                    <h2 className="text-xl font-bold text-slate-800">人脸相册</h2>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-lg shadow-indigo-200 active:scale-95"
                    >
                        <Plus size={16} /> 添加照片
                    </button>
                </div>
                <p className="text-xs text-slate-500 mb-3">老人说不认识时可识别人脸，下方为预设亲属照片</p>

                <div className="grid grid-cols-2 gap-4">
                    {FACE_RECOGNITION_CONFIG.map((item) => (
                        <div key={`preset-${item.file}`} className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
                            <div className="aspect-square rounded-xl overflow-hidden bg-slate-100 mb-3">
                                <img src={`/faces/${item.file}`} alt={item.relation} className="w-full h-full object-cover" />
                            </div>
                            <h4 className="font-bold text-slate-800 text-sm text-center">{item.name || item.relation}</h4>
                            <p className="text-xs text-slate-500 text-center mt-0.5">{item.relation}</p>
                        </div>
                    ))}
                    {faces.map((face) => (
                        <div key={face.id} className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 relative group">
                            <button
                                onClick={(e) => handleDelete(face.id, e)}
                                className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <X size={12} />
                            </button>
                            <div className="aspect-square rounded-xl overflow-hidden bg-slate-100 mb-3">
                                <img src={face.imageUrl} alt={face.name} className="w-full h-full object-cover" />
                            </div>
                            <h4 className="font-bold text-slate-800 text-sm text-center">{face.name}</h4>
                            <p className="text-xs text-slate-500 text-center mt-0.5">{face.relation}</p>
                        </div>
                    ))}
                </div>
            </div>

            {showAddModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50" onClick={() => setShowAddModal(false)}>
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
                        <div className="p-4 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="font-bold text-slate-800">添加人脸照片</h3>
                            <button onClick={() => setShowAddModal(false)}><X size={20} className="text-slate-400" /></button>
                        </div>
                        <div className="p-4 space-y-3">
                            <div>
                                <label className="text-xs font-bold text-slate-500 block mb-1">照片 URL</label>
                                <input type="text" value={form.imageUrl} onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm" placeholder="https://..." />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 block mb-1">姓名</label>
                                    <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm" placeholder="如：张伟" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 block mb-1">关系</label>
                                    <input type="text" value={form.relation} onChange={(e) => setForm((f) => ({ ...f, relation: e.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm" placeholder="如：儿子" />
                                </div>
                            </div>
                            <button onClick={handleAddSubmit} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold mt-2">保存照片</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const Dashboard: React.FC<DashboardProps> = ({ status, simulation, logs }) => {
    const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
    const [greeting, setGreeting] = useState<string>('');
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // AI Health Report State
    const [reportLoading, setReportLoading] = useState(false);
    const [reportContent, setReportContent] = useState<string | null>(null);

    // NLP Cognitive Report State（简版结构化 + 完整报告正文用于弹窗）
    const [cognitiveLoading, setCognitiveLoading] = useState(false);
    const [cognitiveBrief, setCognitiveBrief] = useState<CognitiveBrief | null>(null);
    const [cognitiveContent, setCognitiveContent] = useState<string | null>(null);

    // AI 智能分析 Tab 状态（健康日报 / 认知评估），放在父组件，避免子组件重渲染时被重置
    // 进入健康界面默认展示「健康日报」
    const [activeAiTab, setActiveAiTab] = useState<'report' | 'cognitive'>('report');

    // 完整报告弹窗显示状态
    const [showHealthReportModal, setShowHealthReportModal] = useState(false);
    const [showCognitiveReportModal, setShowCognitiveReportModal] = useState(false);

    // 老人 VRM 数字人状态
    const [elderTalking, setElderTalking] = useState(false);
    const ELDER_VRM_URL = '/models/old.vrm';

    const generateReport = async () => {
        setReportLoading(true);
        try {
            // 使用当前实时体征与睡眠时长调用大模型生成健康日报
            const vitalSigns = {
                bpm: currentMetrics.heartRate,
                pressure: `${currentMetrics.bloodPressure.systolic}/${currentMetrics.bloodPressure.diastolic}`,
                sleep: currentMetrics.sleepHours,
            };
            const report = await aiService.generateHealthBrief(vitalSigns, logs ?? []);
            setReportContent(report);
        } catch (error) {
            setReportContent("生成报告时出错，请检查网络设置。");
        } finally {
            setReportLoading(false);
        }
    };

    const generateCognitive = async () => {
        setCognitiveLoading(true);
        try {
            const brief = await aiService.generateCognitiveReportStructured(logs ?? []);
            setCognitiveBrief(brief);
            setCognitiveContent(brief.fullReport);
        } catch (error) {
            const fallback = aiService.getDefaultCognitiveBrief();
            setCognitiveBrief(fallback);
            setCognitiveContent(fallback.fullReport);
        } finally {
            setCognitiveLoading(false);
        }
    };

    // 打开完整健康日报弹窗：如无内容先生成，再展示
    const openHealthReportModal = async () => {
        setActiveAiTab('report');
        if (!reportContent && !reportLoading) {
            await generateReport();
        }
        setShowHealthReportModal(true);
    };

    // 打开完整认知评估弹窗：如无内容先生成，再展示
    const openCognitiveReportModal = async () => {
        setActiveAiTab('cognitive');
        if (!cognitiveBrief && !cognitiveContent && !cognitiveLoading) {
            await generateCognitive();
        }
        setShowCognitiveReportModal(true);
    };

    // 进入健康界面时自动生成健康日报简版（仅当尚无内容且未在加载时）
    const healthReportRequestedRef = useRef(false);
    useEffect(() => {
        if (activeTab !== 'health') {
            healthReportRequestedRef.current = false;
            return;
        }
        if (reportContent != null || reportLoading) return;
        if (healthReportRequestedRef.current) return;
        healthReportRequestedRef.current = true;
        generateReport();
    }, [activeTab, reportContent, reportLoading]);

    // 进入健康界面时自动生成认知评估，直接展示结果界面（无“点击生成”步骤）
    const cognitiveRequestedRef = useRef(false);
    useEffect(() => {
        if (activeTab !== 'health') {
            cognitiveRequestedRef.current = false;
            return;
        }
        if (cognitiveBrief != null || cognitiveLoading) return;
        if (cognitiveRequestedRef.current) return;
        cognitiveRequestedRef.current = true;
        generateCognitive();
    }, [activeTab, cognitiveBrief, cognitiveLoading]);

    const mapRef = useRef<any>(null); // Leaflet map instance
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const layersRef = useRef<any>(null); // 已废弃：轨迹改用稳定 ref 更新
    const pastPolylineRef = useRef<any>(null);
    const futurePolylineRef = useRef<any>(null);
    const userMarkerRef = useRef<any>(null);
    /** 返回当前位置时显示的模拟“实时位置”点（美丽园小区内，与图例 indigo 一致） */
    const currentLocationMarkerRef = useRef<any>(null);
    /** 事件点标记：创建一次，仅通过 show(idx <= historyIndex) 显隐，避免闪烁 */
    const eventMarkersRef = useRef<{ marker: any; eventIndex: number }[]>([]);
    const lastHistoryDataForEventsRef = useRef<any[] | null>(null);

    // Overview Map State
    const overviewMapRef = useRef<any>(null);
    const overviewMapContainerRef = useRef<HTMLDivElement>(null);


    // History Playback State
    const [historyIndex, setHistoryIndex] = useState<number>(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const playbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    /** 当前位置周边 POI，用于多模态“当前位置相关照片” */
    const [locationPhotoItems, setLocationPhotoItems] = useState<{ url: string; caption?: string }[]>([]);
    /** 定位页是否使用 JS API 交互地图；null=首次进入待尝试，true=已用 JS 地图，false=已回退到静态图 */
    const [useJsMap, setUseJsMap] = useState<boolean | null>(null);
    /** 环境语义分析（Groq）：老人周边安全与地理位置描述 */
    const [environmentAnalysis, setEnvironmentAnalysis] = useState<string>('');
    const [environmentAnalysisLoading, setEnvironmentAnalysisLoading] = useState(false);
    const environmentAnalysisReqIdRef = useRef(0);

    const statusColor = status === SystemStatus.CRITICAL ? 'rose' : status === SystemStatus.WARNING ? 'amber' : 'emerald';

    // 健康数据状态管理：默认使用健康生命体征预设
    const [avatarState, setAvatarState] = useState<AvatarState>(healthStateService.getAvatarState());
    const [currentMetrics, setCurrentMetrics] = useState<HealthMetrics>({ ...HEALTHY_VITALS });
    const [activePreset, setActivePreset] = useState<'healthy' | 'subhealthy'>('healthy');
    const [sundowningSnapshot, setSundowningSnapshot] = useState<SundowningRiskSnapshot>(sundowningService.getCurrentSnapshot());
    const [sundowningHistory, setSundowningHistory] = useState<SundowningRiskSnapshot[]>(sundowningService.getRiskHistory(24));
    const [sundowningAlerts, setSundowningAlerts] = useState<SundowningPushAlert[]>(sundowningService.getAlerts(6));
    const [sundowningPlan, setSundowningPlan] = useState<SundowningInterventionPlan | null>(sundowningService.getActiveIntervention());
    const [interventionFlash, setInterventionFlash] = useState<string | null>(null);

    // 黄昏风险可视化覆盖：中/高风险时即使全局未升为 WARNING，也让 3D 小人进入警惕状态
    const avatarVisualStatus = useMemo<SystemStatus>(() => {
        if (status === SystemStatus.CRITICAL || sundowningSnapshot.riskLevel === 'high') return SystemStatus.CRITICAL;
        if (status === SystemStatus.WARNING || sundowningSnapshot.riskLevel === 'medium') return SystemStatus.WARNING;
        return SystemStatus.NORMAL;
    }, [status, sundowningSnapshot.riskLevel]);

    const effectiveAvatarState = useMemo<AvatarState>(() => {
        if (sundowningSnapshot.riskLevel === 'high') {
            return {
                ...avatarState,
                mood: 'worried',
                alertLevel: 'critical',
                facialExpression: 'pained',
                breathingRate: 'rapid',
                sweating: Math.max(avatarState.sweating ?? 0, 0.5),
                tremor: 0,
                heartbeatIntensity: Math.max(avatarState.heartbeatIntensity ?? 0.3, 0.75),
                templeVeinPulse: Math.max(avatarState.templeVeinPulse ?? 0, 0.65),
                overallHealthGlow: 'red',
                eyeState: 'wide',
                bodyStability: Math.max(avatarState.bodyStability ?? 0.8, 0.92),
                message: '黄昏高风险，已触发主动安抚干预',
            };
        }
        if (sundowningSnapshot.riskLevel === 'medium') {
            return {
                ...avatarState,
                mood: 'worried',
                alertLevel: avatarState.alertLevel === 'critical' ? 'critical' : 'warning',
                facialExpression: 'distressed',
                breathingRate: avatarState.breathingRate === 'rapid' ? 'rapid' : 'fast',
                sweating: Math.max(avatarState.sweating ?? 0, 0.28),
                tremor: 0,
                heartbeatIntensity: Math.max(avatarState.heartbeatIntensity ?? 0.3, 0.55),
                overallHealthGlow: 'orange',
                eyeState: avatarState.eyeState === 'closed' ? 'droopy' : avatarState.eyeState,
                bodyStability: Math.max(avatarState.bodyStability ?? 0.8, 0.9),
                message: '黄昏风险上升，建议尽快安抚与陪伴',
            };
        }
        return avatarState;
    }, [avatarState, sundowningSnapshot.riskLevel]);

    const guardDotColorClass =
        avatarVisualStatus === SystemStatus.CRITICAL
            ? 'bg-rose-500'
            : avatarVisualStatus === SystemStatus.WARNING
                ? 'bg-amber-500'
                : 'bg-emerald-500';

    const guardLabel =
        avatarVisualStatus === SystemStatus.CRITICAL
            ? '黄昏高风险干预中'
            : avatarVisualStatus === SystemStatus.WARNING
                ? '黄昏风险上升'
                : '实时守护中';

    const pushGuardianNotice = (notice: Omit<GuardianNoticeCard, 'timestamp'>) => {
        setGuardianNotice({
            ...notice,
            timestamp: Date.now(),
        });
    };

    const sendGuardianNotification = async ({
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
            pushGuardianNotice({
                title,
                message,
                tone: 'error',
                status: 'OpenClaw Bridge 未配置，未能发送到飞书。',
            });
            return { ok: false, skipped: false };
        }

        try {
            const result = await openclawActionService.notifyGuardians({
                elderId: openclawSyncService.getElderId(),
                message,
                purpose,
                metadata,
            });

            if (result?.skipped) {
                pushGuardianNotice({
                    title,
                    message,
                    tone: 'warn',
                    status: `已被冷却窗口拦截：${result.reason || '同类提醒短时间内已发送。'}`,
                });
                return { ok: true, skipped: true };
            }

            const targetText = Array.isArray(result?.targets) && result.targets.length > 0
                ? result.targets.join('、')
                : '已配置家属目标';

            pushGuardianNotice({
                title,
                message,
                tone: 'success',
                status: `已发送到飞书：${targetText}`,
            });
            return { ok: true, skipped: false };
        } catch (error) {
            pushGuardianNotice({
                title,
                message,
                tone: 'error',
                status: error instanceof Error ? error.message : '发送飞书提醒失败。',
            });
            return { ok: false, skipped: false };
        }
    };

    const handleManualIntervention = async () => {
        const plan = sundowningService.triggerIntervention(undefined, 'manual');
        if (!plan) return;
        setInterventionFlash(`已启动：${plan.title}`);
        setTimeout(() => setInterventionFlash(null), 2200);
        const snapshot = sundowningService.getCurrentSnapshot();
        const factors = snapshot.keyFactors.slice(0, 2).join('、');
        await sendGuardianNotification({
            title: '黄昏守护更新',
            message: `【黄昏守护提醒】张爷爷于${formatMonthDayTime(snapshot.timestamp)}出现${getRiskLevelLabel(snapshot.riskLevel)}信号，风险指数${snapshot.riskScore}。系统已执行「${plan.title}」干预，当前关注点：${factors || '黄昏相关风险信号上升'}。建议今晚增加陪伴或电话安抚。`,
            purpose: 'sundowning_update',
            metadata: {
                riskScore: snapshot.riskScore,
                riskLevel: snapshot.riskLevel,
                interventionTitle: plan.title,
                dedupeKey: 'sundowning:manual_intervention',
                dedupeMinutes: 5,
            },
        });
    };

    // 订阅健康状态变化
    useEffect(() => {
        const unsubscribe = healthStateService.subscribe((state) => {
            setAvatarState(state);
        });
        
        // 初始化数据
        healthStateService.updateMetrics(currentMetrics);
        
        return unsubscribe;
    }, []);

    // 黄昏守护订阅：风险趋势 + 推送 + 当前干预
    useEffect(() => {
        const unsubscribeSnapshot = sundowningService.subscribe((snapshot) => {
            setSundowningSnapshot(snapshot);
            setSundowningHistory(sundowningService.getRiskHistory(24));
        });

        const unsubscribeAlerts = sundowningService.subscribeAlerts(() => {
            setSundowningAlerts(sundowningService.getAlerts(6));
        });

        const unsubscribeIntervention = sundowningService.subscribeInterventions((plan) => {
            setSundowningPlan(plan);
        });

        const timer = setInterval(() => {
            sundowningService.evaluateRisk();
        }, 5000);

        return () => {
            unsubscribeSnapshot();
            unsubscribeAlerts();
            unsubscribeIntervention();
            clearInterval(timer);
        };
    }, []);

    // Clock & Greeting
    useEffect(() => {
        const updateTime = () => {
            const now = new Date();

            const hour = now.getHours();
            if (hour < 11) setGreeting('上午好');
            else if (hour < 13) setGreeting('中午好');
            else if (hour < 18) setGreeting('下午好');
            else setGreeting('晚上好');
        };
        updateTime();
        const timer = setInterval(updateTime, 1000);
        return () => clearInterval(timer);
    }, []);

    // Simulation State
    const [historyData, setHistoryData] = useState<{ lat: number; lng: number; time: Date; event?: { type: string; title: string; desc?: string } }[]>([]);
    const [trajectoryLoading, setTrajectoryLoading] = useState(false);
    const [locationAutomationState, setLocationAutomationState] = useState<LocationAutomationState>(locationAutomationService.getState());
    const [locationAutomationEvents, setLocationAutomationEvents] = useState<LocationAutomationEvent[]>(locationAutomationService.getEvents(4));
    const [familyControlFlash, setFamilyControlFlash] = useState<string | null>(null);
    const [guardianNotice, setGuardianNotice] = useState<GuardianNoticeCard | null>(null);
    const [overviewChartReady, setOverviewChartReady] = useState(false);

    // 上海市静安区美丽园小区（延安西路379弄）- 真实地址作为安全中心，电子围栏半径 100m
    const HOME_LAT = 31.2192;
    const HOME_LNG = 121.4385;
    const HOME_POS: [number, number] = [HOME_LNG, HOME_LAT]; // [lng, lat] for 高德
    const GEOFENCE_RADIUS_M = 100;                          // 电子围栏半径 100 米
    const POINT_INTERVAL_SEC = 180;          // 每点间隔 3 分钟
    const TOTAL_HOURS = 12;                  // 12 小时内的轨迹
    const NUM_POINTS = Math.floor((TOTAL_HOURS * 3600) / POINT_INTERVAL_SEC); // 240 点
    const PLAYBACK_MS_PER_POINT = 400;      // 回放时每点间隔 400ms，兼顾逆地理解析速度
    const SAFE_ZONE_RADIUS_DEG = 0.0009;    // 约 100 米对应的纬度近似量（111km/度）

    useEffect(() => {
        if (activeTab !== 'overview' || isSettingsOpen) {
            setOverviewChartReady(false);
            return;
        }

        let raf1 = 0;
        let raf2 = 0;
        setOverviewChartReady(false);
        raf1 = window.requestAnimationFrame(() => {
            raf2 = window.requestAnimationFrame(() => {
                setOverviewChartReady(true);
            });
        });

        return () => {
            if (raf1) window.cancelAnimationFrame(raf1);
            if (raf2) window.cancelAnimationFrame(raf2);
        };
    }, [activeTab, isSettingsOpen]);

    const distFromHome = (lat: number, lng: number) =>
        Math.sqrt((lat - HOME_LAT) ** 2 + (lng - HOME_LNG) ** 2);

    // 1. 正常轨迹：12 小时内，模拟在美丽园小区及 100m 电子围栏内活动（下楼、小区内散步、取快递等）
    const simulateNormalPath = () => {
        setTrajectoryLoading(true);
        requestAnimationFrame(() => {
            const points: { lat: number; lng: number; time: Date; event?: { type: string; title: string; desc?: string } }[] = [];
            const startTime = new Date(Date.now() - TOTAL_HOURS * 3600 * 1000);
            // 围栏内半径约 80m（略小于 100m），保证所有点都在电子围栏内
            const maxR = 0.00072; // 约 80m
            let lat = HOME_LAT;
            let lng = HOME_LNG;
            for (let i = 0; i < NUM_POINTS; i++) {
                const t = i / NUM_POINTS;
                // 模拟一天内多次在小区内短距离移动：早晨-中午-下午-傍晚-夜间
                const phase = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
                const angle = t * Math.PI * 4 + phase * Math.PI + (Math.random() - 0.5) * 0.3;
                const r = maxR * (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(i * 0.02))) + (Math.random() - 0.5) * 0.00008;
                lat = HOME_LAT + Math.sin(angle) * r;
                lng = HOME_LNG + Math.cos(angle) * r;
                const event = i === 0 ? { type: 'normal', title: '🏠 在安全区域内', desc: '12 小时轨迹开始' } : undefined;
                points.push({
                    lat,
                    lng,
                    time: new Date(startTime.getTime() + i * POINT_INTERVAL_SEC * 1000),
                    event,
                });
            }
            setHistoryData(points);
            setHistoryIndex(0);
            setIsPlaying(true);
            setTrajectoryLoading(false);
            locationAutomationService.simulateArrivalHome();
            setLocationAutomationState(locationAutomationService.getState());
            setLocationAutomationEvents(locationAutomationService.getEvents(4));
        });
    };

    // 2. 疑似走失轨迹：前 6 小时在美丽园小区内/附近，之后沿延安西路→南京西路方向离开，超出 100m 围栏时打“疑似走失”
    const simulateLostPath = () => {
        setTrajectoryLoading(true);
        requestAnimationFrame(() => {
            const points: { lat: number; lng: number; time: Date; event?: { type: string; title: string; desc?: string } }[] = [];
            const startTime = new Date(Date.now() - TOTAL_HOURS * 3600 * 1000);
            const halfPoints = Math.floor(NUM_POINTS / 2);
            let eventTriggered = false;
            // 真实路径：美丽园(延安西路379弄) → 向东向北沿路可到静安寺/南京西路一带（约 1.5–2.5 km）
            const stepLat = 0.00025 / 50;   // 每约 50 点向北约 0.00025 度（约 28m），后半段共约 0.0025 度 ≈ 280m 纬度方向
            const stepLng = 0.00035 / 50;  // 向东略大，模拟沿延安西路向东再向北
            let lat = HOME_LAT;
            let lng = HOME_LNG;
            for (let i = 0; i < NUM_POINTS; i++) {
                if (i <= halfPoints) {
                    // 前 6 小时：在小区及围栏内活动（与正常轨迹类似但范围略大，仍 <100m）
                    const t = i / halfPoints;
                    const angle = t * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
                    const r = 0.00075 * (0.4 + 0.6 * Math.random());
                    lat = HOME_LAT + Math.sin(angle) * r + (Math.random() - 0.5) * 0.00006;
                    lng = HOME_LNG + Math.cos(angle) * r + (Math.random() - 0.5) * 0.00006;
                } else {
                    // 后 6 小时：沿东北方向“走出”小区（模拟沿延安西路向东、向南京西路方向）
                    const k = i - halfPoints;
                    const jitter = (Math.random() - 0.5) * 0.00004;
                    lat += stepLat + jitter;
                    lng += stepLng + jitter * 1.2;
                }

                let event: { type: string; title: string; desc?: string } | undefined;
                if (i === 0) {
                    event = { type: 'normal', title: '🏠 在安全区域内', desc: '轨迹开始' };
                } else if (!eventTriggered && distFromHome(lat, lng) > SAFE_ZONE_RADIUS_DEG) {
                    eventTriggered = true;
                    event = { type: 'wandering', title: '⚠️ 疑似走失', desc: '已超出电子围栏（100m）' };
                }

                points.push({
                    lat,
                    lng,
                    time: new Date(startTime.getTime() + i * POINT_INTERVAL_SEC * 1000),
                    event,
                });
            }
            setHistoryData(points);
            setHistoryIndex(0);
            setIsPlaying(true);
            setTrajectoryLoading(false);
            locationAutomationService.simulateLeaveHome();
            wanderingService.simulateWandering('lost');
            const latestLocationState = locationAutomationService.getState();
            const latestWanderingState = wanderingService.getState();
            setLocationAutomationState(latestLocationState);
            setLocationAutomationEvents(locationAutomationService.getEvents(4));
            void sendGuardianNotification({
                title: '走失预警',
                message: `【走失提醒】张爷爷于${formatMonthDayTime()}疑似离开安全范围，当前位置${latestLocationState.currentLabel}，距家约${latestLocationState.lastDistanceMeters}米。系统判定存在${Math.round(latestWanderingState.confidence * 100)}%的走失风险，已开启持续定位关注，请家属尽快联系确认。`,
                purpose: 'wandering_alert',
                metadata: {
                    wanderingType: 'lost',
                    locationLabel: latestLocationState.currentLabel,
                    distanceMeters: latestLocationState.lastDistanceMeters,
                    confidence: latestWanderingState.confidence,
                    dedupeKey: 'wandering:lost',
                    dedupeMinutes: 15,
                },
            });
        });
    };

    const refreshLocationAutomationSnapshots = () => {
        setLocationAutomationState(locationAutomationService.getState());
        setLocationAutomationEvents(locationAutomationService.getEvents(4));
    };

    const simulateSundowningAlert = async () => {
        sundowningService.startSimulation();
        const snapshot = sundowningService.getCurrentSnapshot();
        const factors = snapshot.keyFactors.slice(0, 3).join('、');
        await sendGuardianNotification({
            title: '黄昏守护提醒',
            message: `【黄昏守护提醒】张爷爷于${formatMonthDayTime(snapshot.timestamp)}出现黄昏风险上升，当前风险指数${snapshot.riskScore}（${getRiskLevelLabel(snapshot.riskLevel)}）。系统检测到${factors || '困惑和重复提问信号升高'}，已启动持续观察${snapshot.riskLevel === 'high' ? '并准备自动干预' : ''}。建议今晚安排家属陪伴或视频通话。`,
            purpose: 'sundowning_alert',
            metadata: {
                riskScore: snapshot.riskScore,
                riskLevel: snapshot.riskLevel,
                factors: snapshot.keyFactors,
                dedupeKey: 'sundowning:alert',
                dedupeMinutes: 5,
            },
        });
    };

    const simulateVitalSignAlert = async () => {
        const metrics: HealthMetrics = {
            heartRate: 124,
            bloodOxygen: 88,
            sleepHours: 4.3,
            steps: 980,
            bloodPressure: { systolic: 168, diastolic: 102 },
            temperature: 37.8,
        };
        setCurrentMetrics(metrics);
        setActivePreset('subhealthy');
        healthStateService.updateMetrics(metrics);
        const latestAlerts = healthStateService.getAlertHistory().slice(0, 3);
        const alertSummary = latestAlerts.length > 0
            ? latestAlerts.map((item) => item.message.replace(/[！!]+$/g, '')).join('、')
            : '心率、血氧与血压出现明显异常';
        await sendGuardianNotification({
            title: '生命体征提醒',
            message: `【生命体征提醒】张爷爷于${formatMonthDayTime()}出现生命体征异常：心率${metrics.heartRate}次/分，血氧${metrics.bloodOxygen}%，血压${metrics.bloodPressure?.systolic}/${metrics.bloodPressure?.diastolic}mmHg。系统判断${alertSummary}，建议尽快复测；如持续异常，请联系家属并评估是否就医。`,
            purpose: 'health_alert',
            metadata: {
                heartRate: metrics.heartRate,
                bloodOxygen: metrics.bloodOxygen,
                bloodPressure: metrics.bloodPressure,
                dedupeKey: 'health:vitals',
                dedupeMinutes: 10,
            },
        });
    };

    const postElderAction = async (action: string, payload: Record<string, unknown>, purpose = 'family_control') => {
        const runLocalFallback = () => {
            publishLocalUiCommand({
                type: 'elder.action',
                payload: {
                    action,
                    ...payload,
                },
            });
        };

        if (!openclawActionService.isConfigured()) {
            runLocalFallback();
            setFamilyControlFlash(`Bridge 未配置，已本地下发动作：${action}`);
            return;
        }
        try {
            await openclawActionService.queueElderAction({
                elderId: openclawSyncService.getElderId(),
                action,
                purpose,
                payload,
            });
            setFamilyControlFlash(`已下发动作：${action}`);
        } catch {
            runLocalFallback();
            setFamilyControlFlash(`Bridge 不可用，已本地下发动作：${action}`);
        }
    };

    const simulateLocationAutomation = async (mode: 'home' | 'leave' | 'unknown') => {
        if (mode === 'home') {
            locationAutomationService.simulateArrivalHome();
            const state = locationAutomationService.getState();
            await sendGuardianNotification({
                title: '到家提醒',
                message: `【到家提醒】张爷爷已于${formatMonthDayTime()}安全到家，当前定位显示在${state.currentLabel}，系统将继续保持在家守护。`,
                purpose: 'location_arrived_home_update',
                metadata: {
                    locationLabel: state.currentLabel,
                    distanceMeters: state.lastDistanceMeters,
                    dedupeKey: 'location:arrived_home',
                    dedupeMinutes: 10,
                },
            });
        } else if (mode === 'leave') {
            locationAutomationService.simulateLeaveHome();
            const state = locationAutomationService.getState();
            await sendGuardianNotification({
                title: '离家提醒',
                message: `【离家提醒】张爷爷于${formatMonthDayTime()}离开家中，当前定位在${state.currentLabel}，距家约${state.lastDistanceMeters}米。系统已开启外出关注。`,
                purpose: 'location_leave_update',
                metadata: {
                    locationLabel: state.currentLabel,
                    distanceMeters: state.lastDistanceMeters,
                    dedupeKey: 'location:left_home',
                    dedupeMinutes: 15,
                },
            });
        } else {
            locationAutomationService.simulateUnfamiliarStay();
            const state = locationAutomationService.getState();
            await sendGuardianNotification({
                title: '陌生地点停留提醒',
                message: `【陌生地点停留提醒】张爷爷于${formatMonthDayTime()}在${state.currentLabel}停留，距家约${state.lastDistanceMeters}米，当前位置已被标记为陌生地点。建议家属尽快联系确认。`,
                purpose: 'location_unfamiliar_alert',
                metadata: {
                    locationLabel: state.currentLabel,
                    distanceMeters: state.lastDistanceMeters,
                    dedupeKey: `location:unfamiliar:${state.currentLabel}`,
                    dedupeMinutes: 15,
                },
            });
        }
        refreshLocationAutomationSnapshots();
    };

    useEffect(() => {
        refreshLocationAutomationSnapshots();
        const unsubscribeLocation = locationAutomationService.subscribe(() => refreshLocationAutomationSnapshots());
        return () => {
            unsubscribeLocation();
        };
    }, []);

    // 回放：从最早记录时间（index 0）推进到最后一个点；用 ref 存 interval 便于暂停按钮立即清除
    useEffect(() => {
        if (playbackIntervalRef.current) {
            clearInterval(playbackIntervalRef.current);
            playbackIntervalRef.current = null;
        }
        if (isPlaying && historyData.length > 0) {
            playbackIntervalRef.current = setInterval(() => {
                setHistoryIndex(prev => {
                    if (prev >= historyData.length - 1) {
                        setIsPlaying(false);
                        if (playbackIntervalRef.current) {
                            clearInterval(playbackIntervalRef.current);
                            playbackIntervalRef.current = null;
                        }
                        return prev;
                    }
                    return prev + 1;
                });
            }, PLAYBACK_MS_PER_POINT);
        }
        return () => {
            if (playbackIntervalRef.current) {
                clearInterval(playbackIntervalRef.current);
                playbackIntervalRef.current = null;
            }
        };
    }, [isPlaying, historyData.length]);

    const resetToCurrentLocation = () => {
        if (playbackIntervalRef.current) {
            clearInterval(playbackIntervalRef.current);
            playbackIntervalRef.current = null;
        }
        setIsPlaying(false);
        setHistoryData([]);
        setHistoryIndex(0);
    };

    const [displayAddress, setDisplayAddress] = useState<string>('上海市静安区延安西路379弄 美丽园小区');
    const [addressLoading, setAddressLoading] = useState(false);
    const addressRequestIdRef = useRef(0);

    useEffect(() => {
        const lng = historyData.length > 0 && historyData[historyIndex]
            ? historyData[historyIndex].lng
            : HOME_LNG + 0.00025;
        const lat = historyData.length > 0 && historyData[historyIndex]
            ? historyData[historyIndex].lat
            : HOME_LAT + 0.0002;
        const reqId = ++addressRequestIdRef.current;
        setAddressLoading(true);
        mapService.reverseGeocode(lng, lat).then((res) => {
            if (reqId !== addressRequestIdRef.current) return;
            setAddressLoading(false);
            if (res.success && res.formattedAddress) {
                setDisplayAddress(res.formattedAddress);
            } else {
                setDisplayAddress(`经纬度: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
            }
        }).catch(() => {
            if (reqId !== addressRequestIdRef.current) return;
            setAddressLoading(false);
            setDisplayAddress(`经纬度: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        });
    }, [historyData, historyIndex]);

    // 经纬度文案：有轨迹为当前点，无轨迹为预设模拟位置（与紫色“实时位置”点一致）
    const latLngText = useMemo(() => {
        if (historyData.length > 0 && historyData[historyIndex]) {
            const p = historyData[historyIndex];
            return `Lat: ${p.lat.toFixed(4)}, Lng: ${p.lng.toFixed(4)}`;
        }
        const simLat = HOME_LAT + 0.0002;
        const simLng = HOME_LNG + 0.00025;
        return `Lat: ${simLat.toFixed(4)}, Lng: ${simLng.toFixed(4)}`;
    }, [historyData, historyIndex]);

    // 上方静态图 URL（高德 Web 服务）：与当前经纬度一致，仅在使用静态图回退时展示
    const currentLngLat = useMemo(() => {
        if (historyData.length > 0 && historyData[historyIndex]) {
            return { lng: historyData[historyIndex].lng, lat: historyData[historyIndex].lat };
        }
        return { lng: HOME_LNG + 0.00025, lat: HOME_LAT + 0.0002 };
    }, [historyData, historyIndex]);
    const topMapStaticUrl = useMemo(() => {
        return mapService.getStaticMapUrl(currentLngLat.lng, currentLngLat.lat, 800, 400);
    }, [currentLngLat.lng, currentLngLat.lat]);

    // 根据当前经纬度拉取周边 POI，生成“当前位置相关照片”列表（多模态环境感知）
    useEffect(() => {
        let cancelled = false;
        const { lng, lat } = currentLngLat;
        mapService.getNearbyPoisWeb(lng, lat, 500, 3).then((pois) => {
            if (cancelled) return;
            if (!pois.length) {
                setLocationPhotoItems([
                    { url: 'https://images.unsplash.com/photo-1484154218962-a1c002085d2f?q=80&w=400&auto=format&fit=crop', caption: '当前位置' },
                    { url: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?q=80&w=400&auto=format&fit=crop', caption: '周边' },
                ]);
                return;
            }
            const placeholder = 'https://images.unsplash.com/photo-1484154218962-a1c002085d2f?q=80&w=400&auto=format&fit=crop';
            setLocationPhotoItems(pois.slice(0, 3).map((p) => ({
                url: p.photoUrl || placeholder,
                caption: p.name || undefined,
            })));
        });
        return () => { cancelled = true; };
    }, [currentLngLat.lng, currentLngLat.lat]);

    // 环境语义分析（Groq）：根据当前地址与最近 3 个周边 POI 分析老人周边安全与地理位置
    useEffect(() => {
        const reqId = ++environmentAnalysisReqIdRef.current;
        setEnvironmentAnalysisLoading(true);
        const poiNames = locationPhotoItems.map((i) => i.caption).filter((c): c is string => !!c);
        aiService
            .analyzeEnvironmentForGuardian(displayAddress, poiNames)
            .then((text) => {
                if (reqId !== environmentAnalysisReqIdRef.current) return;
                setEnvironmentAnalysis(text || '');
            })
            .catch(() => {
                if (reqId !== environmentAnalysisReqIdRef.current) return;
                setEnvironmentAnalysis('');
            })
            .finally(() => {
                if (reqId === environmentAnalysisReqIdRef.current) setEnvironmentAnalysisLoading(false);
            });
    }, [displayAddress, locationPhotoItems]);

    // Initialize Map when Location Tab is active
    useEffect(() => {
        let isCancelled = false;

        const initMap = async () => {
            if (activeTab !== 'location' || isSettingsOpen || mapRef.current) return;
            await new Promise(r => setTimeout(r, 100));
            const homePos: [number, number] = HOME_POS;

            const map = await mapService.createMap('guardian-map-container', homePos);
            if (isCancelled) return;
            if (!map) {
                setUseJsMap(false);
                return;
            }
            setUseJsMap(true);
            mapRef.current = map;

            // 2. Add Static Geofence
            mapService.addCircle(map, homePos, GEOFENCE_RADIUS_M, {
                color: '#10b981',
                fillColor: '#34d399',
                dashArray: '5, 5'
            });

            // 3. Add Home Marker - 美丽园小区（安全中心）
            mapService.addMarker(map, homePos, undefined, "美丽园小区 (安全中心)");

            // 4. 预设“实时位置”点
            const currentPos: [number, number] = [HOME_LNG + 0.00025, HOME_LAT + 0.0002];
            currentLocationMarkerRef.current = mapService.addMarker(map, currentPos,
                `<div style="background:#6366f1;width:20px;height:20px;border-radius:50%;border:2px solid white;box-shadow:0 0 0 6px rgba(99, 102, 241, 0.25);"></div>`
            );

            layersRef.current = [];
            setTimeout(() => {
                if (!isCancelled && mapRef.current && typeof mapRef.current.resize === 'function') {
                    mapRef.current.resize();
                }
            }, 350);
        };

        if (activeTab === 'location' && !isSettingsOpen) {
            initMap();
        }

        return () => {
            isCancelled = true;
            if (activeTab !== 'location' || isSettingsOpen) {
                setUseJsMap(null);
                if (mapRef.current) {
                    if (mapRef.current.destroy) mapRef.current.destroy();
                    mapRef.current = null;
                    layersRef.current = null;
                    pastPolylineRef.current = null;
                    futurePolylineRef.current = null;
                    userMarkerRef.current = null;
                    currentLocationMarkerRef.current = null;
                    eventMarkersRef.current = [];
                    lastHistoryDataForEventsRef.current = null;
                }
            }
        }
    }, [activeTab, isSettingsOpen]);

    // Initialize Overview Map
    useEffect(() => {
        let isCancelled = false;

        const initOverviewMap = async () => {
            if (activeTab === 'overview' && !isSettingsOpen && !overviewMapRef.current) {
                await new Promise(r => setTimeout(r, 100));
                const homePos: [number, number] = HOME_POS;
                const map = await mapService.createMap('overview-map-container', homePos);
                if (!map || isCancelled) return;
                overviewMapRef.current = map;

                // Add Home Marker & Circle
                mapService.addCircle(map, homePos, GEOFENCE_RADIUS_M, {
                    color: '#6366f1',
                    fillColor: '#818cf8',
                    dashArray: '5, 5'
                });
                mapService.addMarker(map, homePos, undefined, "美丽园小区");
            }
        };

        if (activeTab === 'overview' && !isSettingsOpen) {
            initOverviewMap();
        }

        return () => {
            isCancelled = true;
            if ((activeTab !== 'overview' || isSettingsOpen) && overviewMapRef.current) {
                if (overviewMapRef.current.destroy) overviewMapRef.current.destroy();
                overviewMapRef.current = null;
            }
        };
    }, [activeTab, isSettingsOpen]);

    // 稳定轨迹渲染：创建一次折线/标记，仅用 setPath/setPosition 更新，避免闪烁
    useEffect(() => {
        if (activeTab !== 'location' || isSettingsOpen || !mapRef.current) return;
        const map = mapRef.current;

        const thin = (path: [number, number][], step: number) => {
            if (path.length <= step) return path;
            const out: [number, number][] = [];
            for (let i = 0; i < path.length; i += step) out.push(path[i]);
            if ((path.length - 1) % step !== 0) out.push(path[path.length - 1]);
            return out;
        };
        const thinStep = 10;

        const run = () => {
            try {
                if (historyData.length === 0) {
                    if (pastPolylineRef.current) {
                        map.remove(pastPolylineRef.current);
                        pastPolylineRef.current = null;
                    }
                    if (futurePolylineRef.current) {
                        map.remove(futurePolylineRef.current);
                        futurePolylineRef.current = null;
                    }
                    if (userMarkerRef.current) {
                        map.remove(userMarkerRef.current);
                        userMarkerRef.current = null;
                    }
                    eventMarkersRef.current.forEach(({ marker }) => map.remove(marker));
                    eventMarkersRef.current = [];
                    lastHistoryDataForEventsRef.current = null;
                    // 返回当前位置：在美丽园小区内显示模拟的“实时位置”点，颜色与图例“实时位置”(indigo-500)一致
                    const currentPos: [number, number] = [
                        HOME_LNG + 0.00025,
                        HOME_LAT + 0.0002,
                    ];
                    if (!currentLocationMarkerRef.current) {
                        currentLocationMarkerRef.current = mapService.addMarker(map, currentPos,
                            `<div style="background:#6366f1;width:20px;height:20px;border-radius:50%;border:2px solid white;box-shadow:0 0 0 6px rgba(99, 102, 241, 0.25);"></div>`
                        );
                    }
                    return;
                }
                if (currentLocationMarkerRef.current) {
                    map.remove(currentLocationMarkerRef.current);
                    currentLocationMarkerRef.current = null;
                }

                const pastPoints = historyData.slice(0, historyIndex + 1).map(p => [p.lng, p.lat] as [number, number]);
                const futurePoints = historyData.slice(historyIndex).map(p => [p.lng, p.lat] as [number, number]);
                const pastThin = pastPoints.length > 500 ? thin(pastPoints, thinStep) : pastPoints;
                const futureThin = futurePoints.length > 500 ? thin(futurePoints, thinStep) : futurePoints;
                const pastPath = pastThin.length >= 2 ? pastThin : pastThin.length === 1 ? [pastThin[0], pastThin[0]] : [];
                const futurePath = futureThin.length >= 2 ? futureThin : futureThin.length === 1 ? [futureThin[0], futureThin[0]] : [];
                const currentPt = historyData[historyIndex];

                if (!pastPolylineRef.current && pastPath.length >= 2) {
                    pastPolylineRef.current = mapService.addPolyline(map, pastPath, { color: '#94a3b8', weight: 6, opacity: 0.9 });
                }
                if (pastPolylineRef.current && pastPath.length >= 2) {
                    pastPolylineRef.current.setPath(pastPath);
                }

                if (!futurePolylineRef.current && futurePath.length >= 2) {
                    futurePolylineRef.current = mapService.addPolyline(map, futurePath, { color: '#94a3b8', weight: 4, opacity: 0.5, dashArray: '10, 10' });
                }
                if (futurePolylineRef.current) {
                    const fp = futurePath.length >= 2 ? futurePath : (currentPt ? [[currentPt.lng, currentPt.lat], [currentPt.lng, currentPt.lat]] : []);
                    futurePolylineRef.current.setPath(fp);
                }

                // 事件点：仅在 historyData 变更时重建，否则只更新显隐，避免闪烁
                if (lastHistoryDataForEventsRef.current !== historyData) {
                    eventMarkersRef.current.forEach(({ marker }) => map.remove(marker));
                    eventMarkersRef.current = [];
                    historyData.forEach((pt, idx) => {
                        if (!pt.event) return;
                        const isFall = pt.event.type === 'fall';
                        const color = isFall ? '#e11d48' : '#f59e0b';
                        const marker = mapService.addMarker(map, [pt.lng, pt.lat],
                            `<div style="background:${color};width:24px;height:24px;border-radius:50%;border:2px solid white;box-shadow:0 3px 6px rgba(0,0,0,0.3);color:white;text-align:center;line-height:20px;font-weight:bold;font-size:14px;">${isFall ? '!' : '?'}</div>`,
                            pt.event.title
                        );
                        if (marker) eventMarkersRef.current.push({ marker, eventIndex: idx });
                    });
                    lastHistoryDataForEventsRef.current = historyData;
                }
                eventMarkersRef.current.forEach(({ marker, eventIndex }) => {
                    const visible = eventIndex <= historyIndex;
                    if (visible && typeof marker.show === 'function') marker.show();
                    if (!visible && typeof marker.hide === 'function') marker.hide();
                });

                if (currentPt) {
                    if (!userMarkerRef.current) {
                        userMarkerRef.current = mapService.addMarker(map, [currentPt.lng, currentPt.lat],
                            `<div style="background:#4f46e5;width:20px;height:20px;border-radius:50%;border:2px solid white;box-shadow:0 0 0 6px rgba(79, 70, 229, 0.2);"></div>`
                        );
                    } else {
                        userMarkerRef.current.setPosition([currentPt.lng, currentPt.lat]);
                    }
                }
            } catch (e) {
                console.warn('[Dashboard] Map layer update error:', e);
            }
        };

        run();
    }, [activeTab, isSettingsOpen, historyIndex, historyData]);
    const sundowningTrendData = useMemo(() => {
        const history = sundowningHistory.slice(-24);
        if (history.length === 0) {
            return [{ ts: Date.now(), timeLabel: '--:--:--', risk: 0, threshold: 70 }];
        }
        return history.map((item) => ({
            ts: item.timestamp,
            timeLabel: new Date(item.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            risk: item.riskScore,
            threshold: 70,
        }));
    }, [sundowningHistory]);

    const renderOverviewTab = () => (
        <div className="flex flex-col gap-6 pb-28 p-5 animate-fade-in-up">
            {/* Header Section */}
            <div className="flex justify-between items-end px-1 mt-2">
                <div>
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                        <Sun size={12} className="text-amber-500" /> Oct 24, Thursday
                    </p>
                    <h2 className="text-2xl font-bold text-slate-800 tracking-tight">{greeting}, <span className="text-indigo-600">李先生</span></h2>
                </div>
                <div className="bg-white p-1 rounded-full shadow-sm border border-slate-100 cursor-pointer hover:scale-105 transition-transform">
                    <div className="w-10 h-10 bg-indigo-100 rounded-full overflow-hidden flex items-center justify-center">
                        <User className="text-indigo-500" size={20} />
                    </div>
                </div>
            </div>

            {/* 3D 老年数字人 Hero 状态卡片 - 尽量占满模块 */}
            <div className={`relative overflow-hidden rounded-[2.5rem] p-4 shadow-xl transition-all duration-700 group flex flex-col items-center ${
                avatarVisualStatus === SystemStatus.CRITICAL ? 'bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-200' :
                avatarVisualStatus === SystemStatus.WARNING ? 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-orange-200' :
                'bg-white border border-slate-100 shadow-lg shadow-slate-100'
            }`}>
                {/* 状态角标 - 左上角 */}
                <div className={`absolute top-4 left-4 z-20 flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full shadow-sm ${
                    avatarVisualStatus === SystemStatus.NORMAL ? 'bg-slate-50 border border-slate-100' : 'bg-white/20 backdrop-blur-md border border-white/30'
                }`}>
                    <div className="relative flex items-center justify-center w-5 h-5">
                        <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${guardDotColorClass}`}></span>
                        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${guardDotColorClass}`}></span>
                    </div>
                    <span className={`text-xs font-bold tracking-widest ${avatarVisualStatus === SystemStatus.NORMAL ? 'text-slate-600' : 'text-white text-shadow-sm'}`}>{guardLabel}</span>
                </div>

                <div className={`absolute top-0 right-0 -mr-12 -mt-12 w-64 h-64 opacity-5 rounded-full blur-3xl ${avatarVisualStatus === SystemStatus.NORMAL ? 'bg-indigo-500' : 'bg-white'}`}></div>

                {/* 3D 数字人容器：尽量占满模块，居中显示 */}
                <div className="relative z-10 w-full min-h-[260px] flex items-center justify-center overflow-hidden py-2">
                    <div className="relative w-full max-w-[300px] aspect-square flex items-center justify-center mx-auto">
                        <div className={`absolute inset-0 rounded-full blur-2xl animate-pulse ${avatarVisualStatus === SystemStatus.NORMAL ? 'bg-slate-100' : 'bg-white/5'}`}></div>
                        <div className={`absolute inset-0 rounded-full backdrop-blur-sm border ${avatarVisualStatus === SystemStatus.NORMAL ? 'bg-white/50 border-slate-100' : 'bg-gradient-to-tr from-white/10 to-transparent border-white/10'}`}></div>
                        <div className={`absolute inset-1 border-2 border-dashed rounded-full animate-spin-slow opacity-60 ${
                            avatarVisualStatus === SystemStatus.CRITICAL
                                ? 'border-rose-200/70'
                                : avatarVisualStatus === SystemStatus.WARNING
                                    ? 'border-amber-200/70'
                                    : 'border-indigo-200/50'
                        }`}></div>
                        <div className={`absolute inset-2 rounded-full border overflow-hidden flex items-center justify-center ${
                            avatarVisualStatus === SystemStatus.NORMAL ? 'bg-slate-50 border-white shadow-[inset_0_4px_20px_rgba(0,0,0,0.05)]' : 'bg-gradient-to-b from-white/20 to-white/5 border-white/30'
                        }`}>
                            <AvatarVRM
                                modelUrl={ELDER_VRM_URL}
                                width={280}
                                height={280}
                                isTalking={elderTalking}
                                emotion="calm"
                                cameraY={1.0}
                                lookAtY={0.85}
                                modelOffsetX={-0.05}
                                modelOffsetY={-0.6}
                            />
                        </div>

                        {avatarVisualStatus !== SystemStatus.NORMAL && (
                            <div className="absolute top-1 right-1 bg-white rounded-full p-1.5 shadow-lg border-2 border-red-500 z-30">
                                <AlertTriangle size={18} className="text-red-600 animate-pulse" />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 黄昏守护：风险趋势 + 实时推送 */}
            <div className="bg-white rounded-[2rem] p-4 border border-slate-100 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.15)]">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                            <Moon size={15} className="text-indigo-500" />
                            黄昏守护风险趋势
                        </h4>
                        <p className="text-[11px] text-slate-500 mt-0.5">高危窗口 16:00-19:00，风险指数会结合行为信号动态更新</p>
                    </div>
                    <div className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                        sundowningSnapshot.riskLevel === 'high'
                            ? 'bg-rose-100 text-rose-700'
                            : sundowningSnapshot.riskLevel === 'medium'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-emerald-100 text-emerald-700'
                    }`}>
                        {sundowningSnapshot.riskLevel === 'high' ? '高风险' : sundowningSnapshot.riskLevel === 'medium' ? '中风险' : '低风险'}
                        {' · '}
                        {sundowningSnapshot.riskScore}
                    </div>
                </div>

                <div className="h-28 mt-3 min-w-0">
                    {overviewChartReady ? (
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={112}>
                        <LineChart data={sundowningTrendData} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                            <XAxis
                                dataKey="ts"
                                type="number"
                                domain={['dataMin', 'dataMax']}
                                tick={{ fontSize: 10, fill: '#64748B' }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(v: number) => new Date(v).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} />
                            <Tooltip
                                contentStyle={{ borderRadius: 10, border: '1px solid #E2E8F0', fontSize: 12 }}
                                formatter={(value: any) => [`${value}`, '风险指数']}
                                labelFormatter={(label: any) => `时间 ${new Date(Number(label)).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
                            />
                            <Line type="monotone" dataKey="threshold" stroke="#CBD5E1" strokeDasharray="4 4" dot={false} strokeWidth={1.5} />
                            <Line
                                type="monotone"
                                dataKey="risk"
                                stroke={
                                    sundowningSnapshot.riskLevel === 'high'
                                        ? '#E11D48'
                                        : sundowningSnapshot.riskLevel === 'medium'
                                            ? '#D97706'
                                            : '#16A34A'
                                }
                                dot={false}
                                strokeWidth={2.5}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                    ) : (
                        <div className="h-full w-full rounded-2xl bg-slate-50 animate-pulse" />
                    )}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3">
                    <div className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
                        <p className="text-[10px] text-slate-400 mb-1">关键触发</p>
                        <p className="text-xs font-medium text-slate-700">
                            {sundowningSnapshot.keyFactors[0] ?? '暂无'}
                        </p>
                    </div>
                    <div className="rounded-xl bg-slate-50 border border-slate-100 p-2.5">
                        <p className="text-[10px] text-slate-400 mb-1">主动干预</p>
                        <p className="text-xs font-medium text-slate-700">
                            {sundowningPlan?.status === 'running' ? sundowningPlan.title : '待命中'}
                        </p>
                    </div>
                </div>

                <div className="mt-3 space-y-2">
                    <p className="text-[11px] font-semibold text-slate-500">实时推送</p>
                    {sundowningAlerts.slice(0, 2).map((alert) => (
                        <div key={alert.id} className={`rounded-xl px-3 py-2 border ${
                            alert.level === 'high' ? 'bg-rose-50 border-rose-100' : 'bg-amber-50 border-amber-100'
                        }`}>
                            <div className="flex items-center justify-between gap-2">
                                <p className={`text-xs font-semibold ${alert.level === 'high' ? 'text-rose-700' : 'text-amber-700'}`}>{alert.title}</p>
                                <span className="text-[10px] text-slate-500">
                                    {new Date(alert.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-600 mt-1">{alert.message}</p>
                        </div>
                    ))}
                    {sundowningAlerts.length === 0 && (
                        <div className="rounded-xl px-3 py-2 border bg-emerald-50 border-emerald-100 text-[11px] text-emerald-700">
                            暂无黄昏异常推送，当前守护状态稳定。
                        </div>
                    )}
                </div>
            </div>

            {/* Location Widget */}
            <div className="bg-white rounded-[2.5rem] p-2 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.08)] border border-slate-100 cursor-pointer group" onClick={() => setActiveTab('location')}>
                <div className="relative h-44 bg-slate-100 rounded-[2rem] overflow-hidden">
                    {/* Real Amap Container */}
                    <div id="overview-map-container" ref={overviewMapContainerRef} className="w-full h-full"></div>

                    {/* Radar Pulse Effect */}
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                        <div className="w-40 h-40 bg-indigo-500/10 rounded-full animate-ping opacity-75"></div>
                        <div className="absolute inset-0 w-40 h-40 bg-indigo-500/5 rounded-full animate-pulse delay-75"></div>
                        <div className="absolute top-1/2 left-1/2 w-5 h-5 bg-white border-[3px] border-indigo-600 rounded-full shadow-lg transform -translate-x-1/2 -translate-y-1/2 z-10"></div>
                    </div>

                    {/* Floating Status Badge */}
                    <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-md px-4 py-2 rounded-2xl shadow-sm text-xs font-bold text-slate-700 flex items-center gap-2 border border-white/50">
                        <div className={`w-2 h-2 rounded-full animate-pulse ${avatarVisualStatus === SystemStatus.NORMAL ? 'bg-emerald-500' : avatarVisualStatus === SystemStatus.WARNING ? 'bg-amber-500' : 'bg-rose-500'}`}></div>
                        {simulation === SimulationType.WANDERING ? '离家 1.2km (异常)' : '在家中 (安全)'}
                    </div>
                </div>

                <div className="px-5 py-4 flex justify-between items-center">
                    <div>
                        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                            <MapPin size={16} className="text-indigo-500" /> 实时位置
                        </h4>
                        <p className="text-xs text-slate-400 mt-0.5 ml-6">GPS Signal Strong · Battery 84%</p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm">
                        <ChevronRight size={20} />
                    </div>
                </div>
            </div>
        </div>
    );

    // --- Main Render ---

    return (
        <div className="flex items-center justify-center h-full py-8 gap-6 flex-wrap px-4">
            {/* Phone Frame */}
            <div className="relative w-[360px] h-[720px] bg-black rounded-[3rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] border-[8px] border-slate-800 overflow-hidden ring-1 ring-slate-900/5 select-none flex flex-col shrink-0">

                {/* Main Content Area - Updated: Removed Status Bar, Added pt-8 to clear corners */}
                <div className="flex-1 bg-[#F8FAFC] overflow-y-auto no-scrollbar relative pt-8">

                    {isSettingsOpen ? (
                        <DashboardSettingsView onClose={() => setIsSettingsOpen(false)} />
                    ) : (
                        <>
                            {/* Scrollable Header */}
                            <div className="px-5 py-4 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-indigo-200 shadow-md">
                                        <Activity size={18} className="text-white" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-lg font-bold text-slate-800 tracking-tight">颐伴 <span className="text-slate-400 font-normal">YiCompanion</span></span>
                                        <span className="text-[10px] font-medium text-slate-400">让陪伴更懂长者</span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setIsSettingsOpen(true)}
                                    className="p-2 bg-white text-slate-400 hover:text-indigo-600 rounded-full shadow-sm border border-slate-50 transition-colors"
                                >
                                    <Settings size={18} />
                                </button>
                            </div>

                            {activeTab === 'overview' && renderOverviewTab()}
                            {activeTab === 'health' && (
                                <DashboardHealthTab
                                    currentMetrics={currentMetrics}
                                    activeAiTab={activeAiTab}
                                    setActiveAiTab={setActiveAiTab}
                                    reportLoading={reportLoading}
                                    reportContent={reportContent}
                                    generateReport={generateReport}
                                    cognitiveLoading={cognitiveLoading}
                                    cognitiveBrief={cognitiveBrief}
                                    cognitiveContent={cognitiveContent}
                                    showHealthReportModal={showHealthReportModal}
                                    setShowHealthReportModal={setShowHealthReportModal}
                                    showCognitiveReportModal={showCognitiveReportModal}
                                    setShowCognitiveReportModal={setShowCognitiveReportModal}
                                />
                            )}
                            {activeTab === 'location' && (
                                <LocationTabContent
                                    mapContainerRef={mapContainerRef}
                                    historyData={historyData}
                                    historyIndex={historyIndex}
                                    setHistoryIndex={setHistoryIndex}
                                    isPlaying={isPlaying}
                                    setIsPlaying={setIsPlaying}
                                    trajectoryLoading={trajectoryLoading}
                                    simulateNormalPath={simulateNormalPath}
                                    simulateLostPath={simulateLostPath}
                                    resetToCurrentLocation={resetToCurrentLocation}
                                    playbackIntervalRef={playbackIntervalRef}
                                    POINT_INTERVAL_SEC={POINT_INTERVAL_SEC}
                                    simulation={simulation}
                                    displayAddress={displayAddress}
                                    addressLoading={addressLoading}
                                    latLngText={latLngText}
                                    locationPhotoItems={locationPhotoItems}
                                    useJsMap={useJsMap}
                                    topMapStaticUrl={topMapStaticUrl}
                                    staticMapCenter={currentLngLat}
                                    homePos={HOME_POS}
                                    geofenceRadiusDeg={SAFE_ZONE_RADIUS_DEG}
                                    environmentAnalysis={environmentAnalysis}
                                    environmentAnalysisLoading={environmentAnalysisLoading}
                                />
                            )}
                            {activeTab === 'faces' && <DashboardFaceAlbumTab />}

                        </>
                    )}
                </div>

                {/* Bottom Navigation Bar - Hide when in Settings */}
                {!isSettingsOpen && (
                    <div className="absolute bottom-0 w-full h-20 bg-white/95 backdrop-blur-xl border-t border-slate-100 flex items-center justify-around pb-4 z-50 shadow-[0_-5px_30px_rgba(0,0,0,0.03)]">
                        {[
                            { id: 'overview', label: '总览', icon: LayoutGrid },
                            { id: 'health', label: '健康', icon: Heart },
                            { id: 'location', label: '定位', icon: MapPin },
                            { id: 'faces', label: '相册', icon: Users },
                        ].map((item) => {
                            const isActive = activeTab === (item.id as DashboardTab);
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => setActiveTab(item.id as DashboardTab)}
                                    className={`flex flex-col items-center gap-1.5 w-12 transition-all duration-300 group ${isActive ? 'text-indigo-600' : 'text-slate-400'}`}
                                >
                                    <div className={`p-2 rounded-2xl transition-all duration-300 ${isActive ? 'bg-indigo-50 -translate-y-1 shadow-sm' : 'group-hover:bg-slate-50'}`}>
                                        <item.icon size={22} className={isActive ? 'fill-indigo-600/20' : ''} strokeWidth={isActive ? 2.5 : 2} />
                                    </div>
                                    <span className={`text-[10px] font-bold transition-all duration-300 ${isActive ? 'opacity-100' : 'opacity-0 h-0'}`}>{item.label}</span>
                                </button>
                            )
                        })}
                    </div>
                )}

                {/* Overlay for Critical Alerts */}
                {status === SystemStatus.CRITICAL && !isSettingsOpen && (
                    <div className="absolute top-16 left-0 right-0 bg-rose-600 text-white text-xs font-bold px-4 py-2 flex items-center justify-between animate-pulse z-40 shadow-lg">
                        <span className="flex items-center gap-2"><AlertTriangle size={14} fill="white" /> 紧急警报触发</span>
                        <button className="bg-white/20 px-3 py-1 rounded-full text-[10px]">立即处理 &gt;</button>
                    </div>
                )}
            </div>

            {/* 统一模拟控制面板（手机屏外：定位轨迹 + 健康数据） */}
            <div className="w-[320px] max-h-[720px] overflow-y-auto rounded-2xl bg-slate-50 border border-slate-200 shadow-lg p-4 shrink-0 space-y-6">
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                    <MapPin size={14} /> 定位轨迹模拟
                </h3>
                <div className="flex flex-col gap-2">
                    <button
                        onClick={simulateNormalPath}
                        disabled={trajectoryLoading}
                        className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white text-xs font-bold rounded-xl shadow-sm active:scale-95 transition-all text-left"
                    >
                        {trajectoryLoading ? '生成中…' : '🏠 模拟: 正常轨迹 (12h)'}
                    </button>
                    <button
                        onClick={simulateLostPath}
                        disabled={trajectoryLoading}
                        className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-xs font-bold rounded-xl shadow-sm active:scale-95 transition-all text-left"
                    >
                        {trajectoryLoading ? '生成中…' : '⚠️ 模拟: 疑似走失 (12h)'}
                    </button>
                    <button
                        onClick={resetToCurrentLocation}
                        disabled={historyData.length === 0}
                        className="px-4 py-2.5 bg-slate-500 hover:bg-slate-600 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-sm active:scale-95 transition-all text-left flex items-center gap-2"
                    >
                        <ArrowLeft size={14} /> 返回当前位置
                    </button>
                </div>
                {guardianNotice && (
                    <div className={`rounded-2xl border p-3 text-xs space-y-2 ${
                        guardianNotice.tone === 'success'
                            ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                            : guardianNotice.tone === 'warn'
                                ? 'border-amber-100 bg-amber-50 text-amber-700'
                                : 'border-rose-100 bg-rose-50 text-rose-700'
                    }`}>
                        <div className="flex items-center justify-between">
                            <span className="font-bold">家属提醒反馈</span>
                            <span className="text-[10px] opacity-70">{formatClockLabel(guardianNotice.timestamp)}</span>
                        </div>
                        <div className="font-semibold">{guardianNotice.title}</div>
                        <div>{guardianNotice.status}</div>
                        <div className="rounded-xl bg-white/70 px-3 py-2 text-[11px] leading-relaxed">
                            {guardianNotice.message}
                        </div>
                    </div>
                )}

                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 pt-2 border-t border-slate-200">
                    <Moon size={14} /> 黄昏守护模拟
                </h3>
                <div className="flex flex-col gap-2">
                    <button
                        onClick={simulateSundowningAlert}
                        className="px-4 py-2.5 bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold rounded-xl shadow-sm active:scale-95 transition-all text-left"
                    >
                        🌆 模拟: 风险持续上升
                    </button>
                    <button
                        onClick={handleManualIntervention}
                        disabled={sundowningPlan?.status === 'running'}
                        className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 text-white text-xs font-bold rounded-xl shadow-sm active:scale-95 transition-all text-left"
                    >
                        {sundowningPlan?.status === 'running' ? '🤖 主动干预执行中…' : '🤖 立即执行主动干预'}
                    </button>
                    <button
                        onClick={() => {
                            sundowningService.stopSimulation();
                            sundowningService.completeActiveIntervention('calmed');
                        }}
                        className="px-4 py-2.5 bg-slate-500 hover:bg-slate-600 text-white text-xs font-bold rounded-xl shadow-sm active:scale-95 transition-all text-left"
                    >
                        ✅ 停止黄昏模拟
                    </button>
                </div>
                <div className={`rounded-xl p-3 text-xs border ${
                    sundowningSnapshot.riskLevel === 'high'
                        ? 'bg-rose-50 border-rose-100 text-rose-700'
                        : sundowningSnapshot.riskLevel === 'medium'
                            ? 'bg-amber-50 border-amber-100 text-amber-700'
                            : 'bg-emerald-50 border-emerald-100 text-emerald-700'
                }`}>
                    当前风险：{sundowningSnapshot.riskScore}（{sundowningSnapshot.riskLevel === 'high' ? '高' : sundowningSnapshot.riskLevel === 'medium' ? '中' : '低'}）
                    {sundowningPlan?.status === 'running' ? ` · 干预中：${sundowningPlan.title}` : ' · 干预待命'}
                </div>
                {interventionFlash && (
                    <div className="rounded-xl p-2.5 text-xs border bg-indigo-50 border-indigo-100 text-indigo-700">
                        {interventionFlash}
                    </div>
                )}

                <p className="pt-2 border-t border-slate-200 text-[11px] text-slate-500 leading-relaxed">
                    语音建提醒、认知记录与 7 天照护趋势已移至<strong className="text-slate-700">老人端预览旁 · 家属联动控制台</strong>，便于与老人界面同屏演示。
                </p>

                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 pt-2 border-t border-slate-200">
                    <MessageSquare size={14} /> 家属飞书反控模拟
                </h3>
                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={() => postElderAction('speak_text', { text: '张爷爷，张明刚刚在飞书里说晚上会给您打电话。' })}
                        className="rounded-xl bg-indigo-500 px-3 py-2.5 text-left text-xs font-bold text-white shadow-sm"
                    >
                        💬 播报家属消息
                    </button>
                    <button
                        onClick={() => postElderAction('open_memory_album', { text: '张爷爷，我们来看看家人的照片。' })}
                        className="rounded-xl bg-fuchsia-500 px-3 py-2.5 text-left text-xs font-bold text-white shadow-sm"
                    >
                        🖼 打开相册
                    </button>
                    <button
                        onClick={() => postElderAction('show_medication', { text: '张爷爷，我来提醒您看看今晚的用药安排。' })}
                        className="rounded-xl bg-emerald-500 px-3 py-2.5 text-left text-xs font-bold text-white shadow-sm"
                    >
                        💊 打开用药引导
                    </button>
                    <button
                        onClick={() => postElderAction('start_breathing', { text: '张爷爷，我们先慢慢吸气，再慢慢呼气。' })}
                        className="rounded-xl bg-orange-500 px-3 py-2.5 text-left text-xs font-bold text-white shadow-sm"
                    >
                        🌬 启动呼吸放松
                    </button>
                </div>
                {familyControlFlash && (
                    <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-700">
                        {familyControlFlash}
                    </div>
                )}

                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 pt-2 border-t border-slate-200">
                    <Link2 size={14} /> 定位自动编排
                </h3>
                <div className="grid grid-cols-3 gap-2">
                    <button
                        onClick={() => simulateLocationAutomation('home')}
                        className="rounded-xl bg-emerald-500 px-2 py-2.5 text-xs font-bold text-white shadow-sm"
                    >
                        到家
                    </button>
                    <button
                        onClick={() => simulateLocationAutomation('leave')}
                        className="rounded-xl bg-amber-500 px-2 py-2.5 text-xs font-bold text-white shadow-sm"
                    >
                        离家
                    </button>
                    <button
                        onClick={() => simulateLocationAutomation('unknown')}
                        className="rounded-xl bg-rose-500 px-2 py-2.5 text-xs font-bold text-white shadow-sm"
                    >
                        陌生停留
                    </button>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-700">当前定位状态</span>
                        <span className={`font-semibold ${locationAutomationState.currentStatus === 'home' ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {locationAutomationState.currentStatus === 'home' ? '在家' : '外出'}
                        </span>
                    </div>
                    <p>地点：{locationAutomationState.currentLabel} · 距家 {locationAutomationState.lastDistanceMeters}m</p>
                    {locationAutomationEvents[0] && (
                        <div className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                            最近事件：{locationAutomationEvents[0].summary}
                        </div>
                    )}
                </div>

                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 pt-2 border-t border-slate-200">
                    <Activity size={14} /> 健康数据模拟
                </h3>
                <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-4 border border-indigo-100 space-y-4">
                    <h4 className="text-xs font-bold text-indigo-900 flex items-center gap-2">生命体征预设</h4>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={() => {
                                const metrics = { ...HEALTHY_VITALS };
                                setCurrentMetrics(metrics);
                                setActivePreset('healthy');
                                healthStateService.updateMetrics(metrics);
                            }}
                            className={`rounded-xl p-3 text-left transition-all border-2 text-xs ${
                                activePreset === 'healthy'
                                    ? 'bg-emerald-500 border-emerald-600 text-white shadow-lg'
                                    : 'bg-white/80 border-slate-200 text-slate-700 hover:border-emerald-300'
                            }`}
                        >
                            <span className="font-bold">✅ 健康</span>
                            <p className="text-[10px] opacity-90 mt-0.5">心率 72 · 血氧 98% · 血压 118/76</p>
                        </button>
                        <button
                            onClick={() => {
                                const metrics = { ...SUBHEALTHY_VITALS };
                                setCurrentMetrics(metrics);
                                setActivePreset('subhealthy');
                                healthStateService.updateMetrics(metrics);
                            }}
                            className={`rounded-xl p-3 text-left transition-all border-2 text-xs ${
                                activePreset === 'subhealthy'
                                    ? 'bg-amber-500 border-amber-600 text-white shadow-lg'
                                    : 'bg-white/80 border-slate-200 text-slate-700 hover:border-amber-300'
                            }`}
                        >
                            <span className="font-bold">⚠️ 亚健康</span>
                            <p className="text-[10px] opacity-90 mt-0.5">心率 88 · 血氧 94% · 血压 152/98</p>
                        </button>
                    </div>
                    <button
                        onClick={simulateVitalSignAlert}
                        className="w-full rounded-xl bg-rose-500 px-4 py-2.5 text-left text-xs font-bold text-white shadow-sm"
                    >
                        🚨 发送生命体征预警
                    </button>
                    <h4 className="text-xs font-bold text-slate-600 mb-2">微调指标</h4>
                    <div className="space-y-3">
                        <div className="bg-white/70 rounded-lg p-2">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[10px] font-bold text-slate-700">心率</span>
                                <span className={`text-sm font-bold ${currentMetrics.heartRate > 100 ? 'text-red-600' : currentMetrics.heartRate < 60 ? 'text-blue-600' : 'text-green-600'}`}>{currentMetrics.heartRate}</span>
                            </div>
                            <input type="range" min="50" max="130" value={currentMetrics.heartRate}
                                onChange={(e) => { const v = { ...currentMetrics, heartRate: parseInt(e.target.value) }; setCurrentMetrics(v); healthStateService.updateMetrics(v); }}
                                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
                        </div>
                        <div className="bg-white/70 rounded-lg p-2">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[10px] font-bold text-slate-700">血氧</span>
                                <span className={`text-sm font-bold ${currentMetrics.bloodOxygen < 90 ? 'text-red-600' : currentMetrics.bloodOxygen < 95 ? 'text-orange-600' : 'text-green-600'}`}>{currentMetrics.bloodOxygen}%</span>
                            </div>
                            <input type="range" min="85" max="100" value={currentMetrics.bloodOxygen}
                                onChange={(e) => { const v = { ...currentMetrics, bloodOxygen: parseInt(e.target.value) }; setCurrentMetrics(v); healthStateService.updateMetrics(v); }}
                                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
                        </div>
                        <div className="bg-white/70 rounded-lg p-2">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[10px] font-bold text-slate-700">睡眠(h)</span>
                                <span className={`text-sm font-bold ${currentMetrics.sleepHours < 5 ? 'text-red-600' : currentMetrics.sleepHours < 6 ? 'text-orange-600' : 'text-green-600'}`}>{currentMetrics.sleepHours.toFixed(1)}</span>
                            </div>
                            <input type="range" min="2" max="12" step="0.5" value={currentMetrics.sleepHours}
                                onChange={(e) => { const v = { ...currentMetrics, sleepHours: parseFloat(e.target.value) }; setCurrentMetrics(v); healthStateService.updateMetrics(v); }}
                                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
                        </div>
                        <div className="bg-white/70 rounded-lg p-2">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[10px] font-bold text-slate-700">步数</span>
                                <span className={`text-sm font-bold ${currentMetrics.steps < 2000 ? 'text-orange-600' : 'text-green-600'}`}>{currentMetrics.steps.toLocaleString()}</span>
                            </div>
                            <input type="range" min="0" max="10000" step="100" value={currentMetrics.steps}
                                onChange={(e) => { const v = { ...currentMetrics, steps: parseInt(e.target.value) }; setCurrentMetrics(v); healthStateService.updateMetrics(v); }}
                                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
                        </div>
                        <div className="bg-white/70 rounded-lg p-2">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[10px] font-bold text-slate-700">收缩压 (mmHg)</span>
                                <span className={`text-sm font-bold ${
                                    (currentMetrics.bloodPressure?.systolic ?? 120) >= 140 ? 'text-red-600' :
                                    (currentMetrics.bloodPressure?.systolic ?? 120) >= 130 ? 'text-orange-600' : 'text-green-600'
                                }`}>{currentMetrics.bloodPressure?.systolic ?? 120}</span>
                            </div>
                            <input type="range" min="80" max="200" step="1" value={currentMetrics.bloodPressure?.systolic ?? 120}
                                onChange={(e) => {
                                    const v = { ...currentMetrics, bloodPressure: { systolic: parseInt(e.target.value), diastolic: currentMetrics.bloodPressure?.diastolic ?? 80 } };
                                    setCurrentMetrics(v);
                                    healthStateService.updateMetrics(v);
                                }}
                                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
                            <div className="flex justify-between text-[9px] text-slate-500 mt-0.5">
                                <span>80</span>
                                <span>正常 120</span>
                                <span>200</span>
                            </div>
                        </div>
                        <div className="bg-white/70 rounded-lg p-2">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[10px] font-bold text-slate-700">舒张压 (mmHg)</span>
                                <span className={`text-sm font-bold ${
                                    (currentMetrics.bloodPressure?.diastolic ?? 80) >= 90 ? 'text-red-600' :
                                    (currentMetrics.bloodPressure?.diastolic ?? 80) >= 85 ? 'text-orange-600' : 'text-green-600'
                                }`}>{currentMetrics.bloodPressure?.diastolic ?? 80}</span>
                            </div>
                            <input type="range" min="50" max="130" step="1" value={currentMetrics.bloodPressure?.diastolic ?? 80}
                                onChange={(e) => {
                                    const v = { ...currentMetrics, bloodPressure: { systolic: currentMetrics.bloodPressure?.systolic ?? 120, diastolic: parseInt(e.target.value) } };
                                    setCurrentMetrics(v);
                                    healthStateService.updateMetrics(v);
                                }}
                                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
                            <div className="flex justify-between text-[9px] text-slate-500 mt-0.5">
                                <span>50</span>
                                <span>正常 80</span>
                                <span>130</span>
                            </div>
                        </div>
                    </div>
                    {avatarState.message && (
                        <div className={`rounded-lg p-2 text-xs ${
                            avatarState.alertLevel === 'critical' ? 'bg-red-100 border border-red-300' :
                            avatarState.alertLevel === 'warning' ? 'bg-orange-100 border border-orange-300' :
                            avatarState.alertLevel === 'attention' ? 'bg-yellow-100 border border-yellow-300' :
                            'bg-green-100 border border-green-300'
                        }`}>
                            <span className="font-bold text-slate-700">3D 小人：</span>
                            <span className="text-slate-600">{avatarState.message}</span>
                            <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                                <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">心情: {avatarState.mood === 'happy' ? '开心' : avatarState.mood === 'calm' ? '平静' : avatarState.mood === 'tired' ? '疲惫' : avatarState.mood === 'worried' ? '担忧' : '困倦'}</span>
                                <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">精力: {Math.round(avatarState.energy)}%</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
            .no-scrollbar::-webkit-scrollbar { display: none; }
            .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            .animate-fade-in-up { animation: fadeInUp 0.5s cubic-bezier(0.2, 0.8, 0.2, 1); }
            .animate-ping-slow { animation: pingSlow 3s infinite; }
            .animate-talk { animation: talk 0.5s ease-in-out infinite alternate; }
            @keyframes fadeInUp { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes pingSlow { 0% { transform: scale(1); opacity: 1; } 75%, 100% { transform: scale(1.5); opacity: 0; } }
            @keyframes talk { from { height: 10px; } to { height: 30px; } }
        `}</style>
        </div>
    );
};

export default Dashboard;
