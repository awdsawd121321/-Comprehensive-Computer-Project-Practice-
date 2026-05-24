/**
 * 游荡检测服务
 * 通过分析GPS轨迹检测老人是否迷路或游荡
 */

import { openclawSyncService } from './openclawSyncService';

// 位置点
export interface GeoPoint {
    latitude: number;
    longitude: number;
    timestamp: number;
    accuracy?: number;
}

// 安全区域（地理围栏）
export interface SafeZone {
    id: string;
    name: string;
    center: { latitude: number; longitude: number };
    radiusMeters: number;  // 半径(米)
}

// 游荡状态
export interface WanderingState {
    isWandering: boolean;           // 是否游荡
    wanderingType: 'none' | 'circling' | 'pacing' | 'lost';  // 游荡类型
    confidence: number;             // 置信度 0-1
    duration: number;               // 游荡持续时间(秒)
    distanceFromHome: number;       // 距离家的距离(米)
    outsideSafeZone: boolean;       // 是否在安全区域外
    lastKnownLocation?: GeoPoint;   // 最后已知位置
}

// 游荡事件
export interface WanderingEvent {
    type: 'wandering_start' | 'wandering_end' | 'left_safe_zone' | 'returned_safe';
    state: WanderingState;
    timestamp: Date;
}

type WanderingCallback = (event: WanderingEvent) => void;

export class WanderingService {
    private trackingHistory: GeoPoint[] = [];
    private maxHistoryLength = 100;  // 保留最近100个点
    private safeZones: SafeZone[] = [];
    private homeLocation: GeoPoint | null = null;
    private currentState: WanderingState;
    private subscribers: WanderingCallback[] = [];
    private watchId: number | null = null;
    private analysisInterval: any = null;

    // 检测参数
    private readonly CIRCLING_THRESHOLD = 0.3;  // 有效距离/总距离 < 0.3 判定为打转
    private readonly PACING_THRESHOLD = 2;      // 往返次数 > 2 判定为踱步
    private readonly MIN_POINTS_FOR_ANALYSIS = 10;  // 最少需要10个点才分析
    private readonly ANALYSIS_INTERVAL_MS = 5000;   // 每5秒分析一次

    constructor() {
        this.currentState = {
            isWandering: false,
            wanderingType: 'none',
            confidence: 0,
            duration: 0,
            distanceFromHome: 0,
            outsideSafeZone: false,
        };
        this.loadSafeZones();
        openclawSyncService.syncWanderingConfig(this.homeLocation, this.safeZones);
        openclawSyncService.syncWanderingState(this.currentState);
    }

    /**
     * 订阅游荡事件
     */
    subscribe(callback: WanderingCallback): () => void {
        this.subscribers.push(callback);
        return () => {
            this.subscribers = this.subscribers.filter(cb => cb !== callback);
        };
    }

    /**
     * 通知订阅者
     */
    private notify(event: WanderingEvent): void {
        this.subscribers.forEach(cb => cb(event));
        openclawSyncService.syncWanderingEvent(event);
    }

    /**
     * 设置家的位置
     */
    setHomeLocation(location: GeoPoint): void {
        this.homeLocation = location;
        localStorage.setItem('emobit_home_location', JSON.stringify(location));
        openclawSyncService.syncWanderingConfig(this.homeLocation, this.safeZones);
    }

    /**
     * 添加安全区域
     */
    addSafeZone(zone: SafeZone): void {
        this.safeZones.push(zone);
        localStorage.setItem('emobit_safe_zones', JSON.stringify(this.safeZones));
        openclawSyncService.syncWanderingConfig(this.homeLocation, this.safeZones);
    }

    /**
     * 加载安全区域
     */
    private loadSafeZones(): void {
        try {
            const saved = localStorage.getItem('emobit_safe_zones');
            if (saved) {
                this.safeZones = JSON.parse(saved);
            } else {
                // 默认安全区域：家周围500米
                this.safeZones = [{
                    id: 'home',
                    name: '家',
                    center: { latitude: 39.9042, longitude: 116.4074 },  // 北京默认位置
                    radiusMeters: 500,
                }];
            }

            const homeStr = localStorage.getItem('emobit_home_location');
            if (homeStr) {
                this.homeLocation = JSON.parse(homeStr);
            }
        } catch (e) {
            console.warn('[Wandering] Failed to load safe zones:', e);
        }
        openclawSyncService.syncWanderingConfig(this.homeLocation, this.safeZones);
    }

    /**
     * 开始位置监控
     */
    startTracking(): void {
        if (this.watchId !== null) return;

        if (!navigator.geolocation) {
            console.error('[Wandering] Geolocation not supported');
            return;
        }

        console.log('[Wandering] 开始位置监控');

        this.watchId = navigator.geolocation.watchPosition(
            (position) => {
                this.recordPosition({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    timestamp: Date.now(),
                    accuracy: position.coords.accuracy,
                });
            },
            (error) => {
                console.error('[Wandering] 位置获取失败:', error);
            },
            {
                enableHighAccuracy: true,
                maximumAge: 10000,
                timeout: 5000,
            }
        );

        // 定时分析轨迹
        this.analysisInterval = setInterval(() => {
            this.analyzeTrajectory();
        }, this.ANALYSIS_INTERVAL_MS);
    }

    /**
     * 停止位置监控
     */
    stopTracking(): void {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        if (this.analysisInterval) {
            clearInterval(this.analysisInterval);
            this.analysisInterval = null;
        }
        console.log('[Wandering] 停止位置监控');
    }

    /**
     * 记录位置点
     */
    recordPosition(point: GeoPoint): void {
        this.trackingHistory.push(point);

        // 保持历史长度
        if (this.trackingHistory.length > this.maxHistoryLength) {
            this.trackingHistory = this.trackingHistory.slice(-this.maxHistoryLength);
        }

        this.currentState.lastKnownLocation = point;

        // 检查是否在安全区域
        this.checkSafeZone(point);
        openclawSyncService.syncWanderingState(this.currentState);
    }

    /**
     * 检查是否在安全区域内
     */
    private checkSafeZone(point: GeoPoint): void {
        const wasOutside = this.currentState.outsideSafeZone;

        // 检查所有安全区域
        const insideAnySafeZone = this.safeZones.some(zone => {
            const distance = this.calculateDistance(point, zone.center as GeoPoint);
            return distance <= zone.radiusMeters;
        });

        this.currentState.outsideSafeZone = !insideAnySafeZone;

        // 计算距家距离
        if (this.homeLocation) {
            this.currentState.distanceFromHome = this.calculateDistance(point, this.homeLocation);
        }

        // 触发事件
        if (!wasOutside && this.currentState.outsideSafeZone) {
            this.notify({
                type: 'left_safe_zone',
                state: { ...this.currentState },
                timestamp: new Date(),
            });
        } else if (wasOutside && !this.currentState.outsideSafeZone) {
            this.notify({
                type: 'returned_safe',
                state: { ...this.currentState },
                timestamp: new Date(),
            });
        }
    }

    /**
     * 分析轨迹判断是否游荡
     */
    private analyzeTrajectory(): void {
        if (this.trackingHistory.length < this.MIN_POINTS_FOR_ANALYSIS) {
            return;
        }

        const recentPoints = this.trackingHistory.slice(-30);  // 分析最近30个点
        const wasWandering = this.currentState.isWandering;

        // 计算总距离和有效距离
        let totalDistance = 0;
        for (let i = 1; i < recentPoints.length; i++) {
            totalDistance += this.calculateDistance(recentPoints[i - 1], recentPoints[i]);
        }

        const effectiveDistance = this.calculateDistance(
            recentPoints[0],
            recentPoints[recentPoints.length - 1]
        );

        // 判断游荡类型
        const ratio = effectiveDistance / (totalDistance + 0.001);  // 避免除零

        if (ratio < this.CIRCLING_THRESHOLD && totalDistance > 50) {
            // 打转检测：走了很多路但没离开原地
            this.currentState.isWandering = true;
            this.currentState.wanderingType = 'circling';
            this.currentState.confidence = 1 - ratio;
        } else if (this.detectPacing(recentPoints)) {
            // 踱步检测：来回走
            this.currentState.isWandering = true;
            this.currentState.wanderingType = 'pacing';
            this.currentState.confidence = 0.8;
        } else if (this.currentState.outsideSafeZone && this.currentState.distanceFromHome > 1000) {
            // 迷路检测：远离家且在安全区外
            this.currentState.isWandering = true;
            this.currentState.wanderingType = 'lost';
            this.currentState.confidence = 0.9;
        } else {
            this.currentState.isWandering = false;
            this.currentState.wanderingType = 'none';
            this.currentState.confidence = 0;
        }

        // 触发事件
        if (!wasWandering && this.currentState.isWandering) {
            this.notify({
                type: 'wandering_start',
                state: { ...this.currentState },
                timestamp: new Date(),
            });
        } else if (wasWandering && !this.currentState.isWandering) {
            this.notify({
                type: 'wandering_end',
                state: { ...this.currentState },
                timestamp: new Date(),
            });
        }
    }

    /**
     * 检测踱步（来回走）
     */
    private detectPacing(points: GeoPoint[]): boolean {
        if (points.length < 10) return false;

        // 计算方向变化次数
        let directionChanges = 0;
        let lastDirection = 0;

        for (let i = 2; i < points.length; i++) {
            const bearing1 = this.calculateBearing(points[i - 2], points[i - 1]);
            const bearing2 = this.calculateBearing(points[i - 1], points[i]);

            const diff = Math.abs(bearing2 - bearing1);
            const normalizedDiff = diff > 180 ? 360 - diff : diff;

            if (normalizedDiff > 150) {  // 接近180度的转向
                directionChanges++;
            }
        }

        return directionChanges >= this.PACING_THRESHOLD;
    }

    /**
     * 计算两点之间的距离（米）
     */
    calculateDistance(p1: GeoPoint | { latitude: number; longitude: number }, p2: GeoPoint | { latitude: number; longitude: number }): number {
        const R = 6371000;  // 地球半径（米）
        const φ1 = p1.latitude * Math.PI / 180;
        const φ2 = p2.latitude * Math.PI / 180;
        const Δφ = (p2.latitude - p1.latitude) * Math.PI / 180;
        const Δλ = (p2.longitude - p1.longitude) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    /**
     * 计算方位角
     */
    private calculateBearing(p1: GeoPoint, p2: GeoPoint): number {
        const φ1 = p1.latitude * Math.PI / 180;
        const φ2 = p2.latitude * Math.PI / 180;
        const Δλ = (p2.longitude - p1.longitude) * Math.PI / 180;

        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

        const θ = Math.atan2(y, x);
        return (θ * 180 / Math.PI + 360) % 360;
    }

    /**
     * 获取当前状态
     */
    getState(): WanderingState {
        return { ...this.currentState };
    }

    getSafeZones(): SafeZone[] {
        return [...this.safeZones];
    }

    getHomeLocation(): GeoPoint | null {
        return this.homeLocation ? { ...this.homeLocation } : null;
    }

    /**
     * 获取轨迹历史
     */
    getTrackingHistory(): GeoPoint[] {
        return [...this.trackingHistory];
    }

    /**
     * 模拟游荡（演示用）
     */
    simulateWandering(type: 'circling' | 'pacing' | 'lost'): void {
        console.log('[Wandering] 模拟游荡:', type);

        this.currentState.isWandering = true;
        this.currentState.wanderingType = type;
        this.currentState.confidence = 0.85;
        this.currentState.distanceFromHome = type === 'lost' ? 1500 : 100;
        this.currentState.outsideSafeZone = type === 'lost';

        this.notify({
            type: 'wandering_start',
            state: { ...this.currentState },
            timestamp: new Date(),
        });

        // 10秒后结束模拟
        setTimeout(() => {
            this.currentState.isWandering = false;
            this.currentState.wanderingType = 'none';
            this.notify({
                type: 'wandering_end',
                state: { ...this.currentState },
                timestamp: new Date(),
            });
        }, 10000);
    }
}

// 单例导出
export const wanderingService = new WanderingService();
