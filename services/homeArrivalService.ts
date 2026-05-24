/**
 * 到家检测服务
 * 检测老人是否到家，用于触发时光相册询问
 */

// 上海市静安区美丽园小区（与 Dashboard.tsx 一致）
const HOME_LAT = 31.2192;
const HOME_LNG = 121.4385;
const HOME_RADIUS_METERS = 100; // 50米内视为到家

class HomeArrivalService {
    private prompted = false; // 本次会话是否已询问过
    private lastCheckResult = false; // 上次检测结果

    /**
     * 计算两点距离（米）
     */
    private calculateDistance(
        lat1: number,
        lng1: number,
        lat2: number,
        lng2: number
    ): number {
        const R = 6371000; // 地球半径（米）
        const φ1 = (lat1 * Math.PI) / 180;
        const φ2 = (lat2 * Math.PI) / 180;
        const Δφ = ((lat2 - lat1) * Math.PI) / 180;
        const Δλ = ((lng2 - lng1) * Math.PI) / 180;

        const a =
            Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    /**
     * 检测是否到家
     * @param currentLat 当前纬度
     * @param currentLng 当前经度
     * @returns 是否在家（距离家 ≤ HOME_RADIUS_METERS）
     */
    isAtHome(currentLat?: number, currentLng?: number): boolean {
        // 如果没有提供位置，使用默认的模拟位置（美丽园小区内的一个点）
        const lat = currentLat ?? HOME_LAT + 0.0002;
        const lng = currentLng ?? HOME_LNG + 0.00025;

        const distance = this.calculateDistance(lat, lng, HOME_LAT, HOME_LNG);
        this.lastCheckResult = distance <= HOME_RADIUS_METERS;

        console.log(
            `[HomeArrival] 检测到家状态: 距离=${distance.toFixed(1)}m, 在家=${this.lastCheckResult}`
        );

        return this.lastCheckResult;
    }

    /**
     * 检测本次会话是否已询问过
     */
    hasPromptedThisSession(): boolean {
        return this.prompted;
    }

    /**
     * 标记已询问
     */
    markPrompted(): void {
        this.prompted = true;
        console.log('[HomeArrival] 已标记本次会话已询问');
    }

    /**
     * 重置询问状态（用于测试）
     */
    resetPromptState(): void {
        this.prompted = false;
        console.log('[HomeArrival] 已重置询问状态');
    }

    /**
     * 获取家的位置（用于显示）
     */
    getHomeLocation(): { lat: number; lng: number } {
        return { lat: HOME_LAT, lng: HOME_LNG };
    }

    /**
     * 获取检测半径
     */
    getHomeRadius(): number {
        return HOME_RADIUS_METERS;
    }
}

// 单例导出
export const homeArrivalService = new HomeArrivalService();
