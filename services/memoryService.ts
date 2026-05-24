/**
 * 记忆锚点服务
 * 管理地标-回忆关联，实现地标触发式记忆唤醒
 */

import { openclawSyncService } from './openclawSyncService';

export interface MemoryAnchor {
    id: string;
    name: string;                    // 地点名称
    location: {
        lat: number;
        lng: number;
    };
    radius: number;                  // 触发范围（米）
    memoryText: string;              // 回忆内容
    voiceText?: string;              // 语音播报文本
    imageUrl?: string;               // 相关照片
    category: 'work' | 'family' | 'friend' | 'landmark' | 'daily';
    createdAt: Date;
    lastTriggered?: Date;
}

export interface LocationEvent {
    anchor: MemoryAnchor;
    distance: number;
    timestamp: Date;
}

/**
 * 记忆锚点服务类
 */
export class MemoryService {
    private anchors: MemoryAnchor[] = [];
    private watchId: number | null = null;
    private lastPosition: GeolocationPosition | null = null;
    private triggeredAnchors = new Set<string>(); // 防止重复触发
    private cooldownMs = 3600000; // 1小时冷却时间
    private listeners: ((event: LocationEvent) => void)[] = [];

    constructor() {
        // 加载预设的记忆锚点（演示用）
        this.loadDefaultAnchors();
        openclawSyncService.syncMemoryAnchors(this.anchors);
    }

    /**
     * 添加记忆锚点
     */
    addAnchor(anchor: Omit<MemoryAnchor, 'id' | 'createdAt'>): MemoryAnchor {
        const newAnchor: MemoryAnchor = {
            ...anchor,
            id: 'anchor_' + Math.random().toString(36).substr(2, 9),
            createdAt: new Date(),
        };

        this.anchors.push(newAnchor);
        this.saveAnchors();
        openclawSyncService.syncMemoryAnchors(this.anchors);

        return newAnchor;
    }

    /**
     * 删除记忆锚点
     */
    removeAnchor(id: string): boolean {
        const index = this.anchors.findIndex(a => a.id === id);
        if (index !== -1) {
            this.anchors.splice(index, 1);
            this.saveAnchors();
            openclawSyncService.syncMemoryAnchors(this.anchors);
            return true;
        }
        return false;
    }

    /**
     * 获取所有锚点
     */
    getAllAnchors(): MemoryAnchor[] {
        return [...this.anchors];
    }

    /**
     * 根据位置获取附近的记忆锚点
     * @param lat 纬度
     * @param lng 经度
     * @param maxDistance 最大距离（米），默认 5000米
     */
    getMemoriesByLocation(lat: number, lng: number, maxDistance: number = 5000): MemoryAnchor[] {
        return this.anchors
            .map(anchor => ({
                anchor,
                distance: this.calculateDistance(lat, lng, anchor.location.lat, anchor.location.lng)
            }))
            .filter(item => item.distance <= maxDistance)
            .sort((a, b) => a.distance - b.distance)
            .map(item => item.anchor);
    }

    /**
     * 开始位置监控
     */
    startWatching(): void {
        if (this.watchId !== null) return;

        if (!navigator.geolocation) {
            console.warn('[Memory] Geolocation not supported');
            return;
        }

        this.watchId = navigator.geolocation.watchPosition(
            (position) => this.handlePositionUpdate(position),
            (error) => console.error('[Memory] Geolocation error:', error),
            {
                enableHighAccuracy: true,
                maximumAge: 30000,
                timeout: 27000,
            }
        );

        console.log('[Memory] Started watching location');
    }

    /**
     * 停止位置监控
     */
    stopWatching(): void {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
            console.log('[Memory] Stopped watching location');
        }
    }

    /**
     * 处理位置更新
     */
    private handlePositionUpdate(position: GeolocationPosition): void {
        this.lastPosition = position;
        const { latitude, longitude } = position.coords;

        // 检查每个锚点
        for (const anchor of this.anchors) {
            const distance = this.calculateDistance(
                latitude,
                longitude,
                anchor.location.lat,
                anchor.location.lng
            );

            // 在触发范围内
            if (distance <= anchor.radius) {
                this.triggerAnchor(anchor, distance);
            }
        }
    }

    /**
     * 触发记忆锚点
     */
    private triggerAnchor(anchor: MemoryAnchor, distance: number): void {
        // 检查冷却时间
        const now = Date.now();
        const lastTriggered = anchor.lastTriggered?.getTime() || 0;

        if (now - lastTriggered < this.cooldownMs) {
            return; // 还在冷却中
        }

        // 防止短期重复触发
        if (this.triggeredAnchors.has(anchor.id)) {
            return;
        }

        console.log(`[Memory] Triggered anchor: ${anchor.name}`);

        // 更新触发时间
        anchor.lastTriggered = new Date();
        this.triggeredAnchors.add(anchor.id);

        // 5分钟后移除触发标记
        setTimeout(() => {
            this.triggeredAnchors.delete(anchor.id);
        }, 300000);

        // 通知监听器
        const event: LocationEvent = {
            anchor,
            distance,
            timestamp: new Date(),
        };

        this.listeners.forEach(listener => listener(event));
        openclawSyncService.syncMemoryEvent(event);
    }

    /**
     * 计算两点间距离（米）
     */
    private calculateDistance(
        lat1: number,
        lng1: number,
        lat2: number,
        lng2: number
    ): number {
        const R = 6371000; // 地球半径（米）
        const dLat = this.toRad(lat2 - lat1);
        const dLng = this.toRad(lng2 - lng1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) *
            Math.cos(this.toRad(lat2)) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    private toRad(deg: number): number {
        return deg * (Math.PI / 180);
    }

    /**
     * 订阅锚点触发事件
     */
    subscribe(listener: (event: LocationEvent) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    /**
     * 生成记忆唤醒对话
     */
    generateMemoryDialogue(anchor: MemoryAnchor, speakerName: string = '小明'): string {
        const categoryPrefixes: Record<MemoryAnchor['category'], string> = {
            work: `爸，这是您以前工作的地方`,
            family: `爸，这里有很多回忆`,
            friend: `爸，您的老朋友住在附近`,
            landmark: `爸，这个地方您还记得吗`,
            daily: `爸，这是您常来的地方`,
        };

        const prefix = categoryPrefixes[anchor.category] || '爸';

        if (anchor.voiceText) {
            return anchor.voiceText;
        }

        return `${prefix}。${anchor.memoryText}`;
    }

    /**
     * 保存锚点到localStorage
     */
    private saveAnchors(): void {
        try {
            localStorage.setItem('emobit_memory_anchors', JSON.stringify(this.anchors));
        } catch (e) {
            console.warn('[Memory] Failed to save anchors:', e);
        }
        openclawSyncService.syncMemoryAnchors(this.anchors);
    }

    /**
     * 从localStorage加载锚点
     */
    private loadAnchors(): void {
        try {
            const saved = localStorage.getItem('emobit_memory_anchors');
            if (saved) {
                this.anchors = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('[Memory] Failed to load anchors:', e);
        }
    }

    /**
     * 加载默认锚点（演示用）
     */
    private loadDefaultAnchors(): void {
        this.loadAnchors();

        // 如果没有锚点，添加示例
        if (this.anchors.length === 0) {
            this.anchors = [
                {
                    id: 'demo_work',
                    name: '老单位',
                    location: { lat: 39.9042, lng: 116.4074 },
                    radius: 100,
                    memoryText: '还记得1995年那次表彰吗？您那时候可是单位的骨干呢！',
                    voiceText: '爸，这是您以前工作的地方，还记得1995年那次表彰吗？',
                    category: 'work',
                    createdAt: new Date(),
                },
                {
                    id: 'demo_park',
                    name: '老公园',
                    location: { lat: 39.9142, lng: 116.3974 },
                    radius: 150,
                    memoryText: '小时候您常带我来这里喂鸽子，我还记得那个卖糖葫芦的老奶奶。',
                    voiceText: '爸，这是我们小时候常来的公园，还记得那个卖糖葫芦的老奶奶吗？',
                    category: 'family',
                    createdAt: new Date(),
                },
                {
                    id: 'demo_home',
                    name: '家',
                    location: { lat: 39.9000, lng: 116.4100 },
                    radius: 50,
                    memoryText: '欢迎回家！今天累了吧，进屋喝杯热茶。',
                    voiceText: '爸，快到家啦！我给您沏好茶了。',
                    category: 'daily',
                    createdAt: new Date(),
                },
            ];
        }
    }

    /**
     * 手动测试触发（用于演示）
     */
    testTrigger(anchorId: string): void {
        const anchor = this.anchors.find(a => a.id === anchorId);
        if (anchor) {
            this.triggerAnchor(anchor, 10);
        }
    }
}

// 单例导出
export const memoryService = new MemoryService();
