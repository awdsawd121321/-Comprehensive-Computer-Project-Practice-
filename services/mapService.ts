/**
 * 高德地图导航服务
 * 使用高德地图 JS API 实现路线规划和导航
 * 
 * 注意：当前暂时禁用地图功能（缺少 @amap/amap-jsapi-loader 依赖）
 * 所有方法将返回失败结果，不影响其他功能测试
 */

// 暂时禁用地图导入，避免启动错误
import AMapLoader from '@amap/amap-jsapi-loader';

const MAP_SERVICE_DISABLED = false; // Enable map functionality
// let AMapLoader: any = null;

// 类型定义
export interface LngLat {
    lng: number;
    lat: number;
}

export interface RouteStep {
    instruction: string;  // 导航指令，如"向左转"
    road: string;         // 道路名称
    distance: number;     // 该步骤距离(米)
    duration: number;     // 预计时间(秒)
    action: 'left' | 'right' | 'straight' | 'arrive' | 'start';
}

export interface RouteResult {
    success: boolean;
    distance: number;     // 总距离(米)
    duration: number;     // 总时间(秒)
    steps: RouteStep[];
    polyline?: number[][]; // 路线坐标点
    error?: string;
}

export interface GeocodeResult {
    success: boolean;
    location?: LngLat;
    formattedAddress?: string;
    error?: string;
}

/** 逆地理编码结果：坐标 -> 详细地址 */
export interface ReverseGeocodeResult {
    success: boolean;
    formattedAddress?: string;
    addressComponent?: {
        province?: string;
        city?: string;
        citycode?: string;
        district?: string;
        adcode?: string;
        township?: string;
        street?: string;
        streetNumber?: string;
    };
    error?: string;
}

// 高德地图AMap类型（简化版）
interface AMapInstance {
    plugin: (plugins: string[], callback: () => void) => void;
    Walking: new (options?: object) => WalkingService;
    Driving: new (options?: object) => DrivingService;
    Geocoder: new () => GeocoderService;
    Geolocation: new (options?: object) => GeolocationService;
}

interface WalkingService {
    search: (
        start: [number, number],
        end: [number, number],
        callback: (status: string, result: any) => void
    ) => void;
}

interface DrivingService {
    search: (
        start: [number, number],
        end: [number, number],
        callback: (status: string, result: any) => void
    ) => void;
}

interface GeocoderService {
    getLocation: (
        address: string,
        callback: (status: string, result: any) => void
    ) => void;
    getAddress: (
        lnglat: [number, number] | { lng: number; lat: number },
        callback: (status: string, result: any) => void
    ) => void;
}

interface GeolocationService {
    getCurrentPosition: (
        callback: (status: string, result: any) => void
    ) => void;
}

class MapService {
    private AMap: AMapInstance | null = null;
    private isInitialized = false;

    /**
     * 初始化高德地图SDK
     */
    async init(): Promise<boolean> {
        // 如果地图功能已禁用，直接返回 false
        if (MAP_SERVICE_DISABLED || !AMapLoader) {
            console.warn('[MapService] 地图功能已禁用');
            return false;
        }

        if (this.isInitialized && this.AMap) {
            return true;
        }

        const key = import.meta.env.VITE_AMAP_JS_KEY;
        const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE;

        if (!key || key === 'your_amap_js_key_here') {
            console.warn('[MapService] 未配置高德 JS API Key (VITE_AMAP_JS_KEY)');
            return false;
        }

        try {
            // 设置安全密钥
            if (securityCode && securityCode !== 'your_amap_security_code_here') {
                (window as any)._AMapSecurityConfig = {
                    securityJsCode: securityCode,
                };
            }

            this.AMap = await AMapLoader.load({
                key,
                version: '2.0',
                plugins: ['AMap.Walking', 'AMap.Driving', 'AMap.Geocoder', 'AMap.Geolocation'],
            });

            this.isInitialized = true;
            console.log('[MapService] 高德地图SDK初始化成功');
            return true;
        } catch (error) {
            console.error('[MapService] 初始化失败:', error);
            return false;
        }
    }



    /**
     * 地址转坐标（地理编码）
     */
    async geocode(address: string): Promise<GeocodeResult> {
        if (!await this.init()) {
            return { success: false, error: '地图服务未初始化' };
        }

        return new Promise((resolve) => {
            const geocoder = new this.AMap!.Geocoder();

            geocoder.getLocation(address, (status, result) => {
                if (status === 'complete' && result.geocodes?.length > 0) {
                    const geo = result.geocodes[0];
                    resolve({
                        success: true,
                        location: { lng: geo.location.lng, lat: geo.location.lat },
                        formattedAddress: geo.formattedAddress,
                    });
                } else {
                    resolve({ success: false, error: '地址解析失败' });
                }
            });
        });
    }

    /**
     * 逆地理编码（Web 服务 API）：坐标转详细地址，不依赖 JS SDK，使用同一 Key 即可
     * 文档：https://lbs.amap.com/api/webservice/guide/api/georegeo
     */
    async reverseGeocodeWeb(lng: number, lat: number): Promise<ReverseGeocodeResult> {
        const key = import.meta.env.VITE_AMAP_WEB_KEY;
        if (!key || key === 'your_amap_web_key_here') {
            return { success: false, error: '未配置高德 Web 服务 Key (VITE_AMAP_WEB_KEY)' };
        }
        const location = `${lng.toFixed(6)},${lat.toFixed(6)}`;
        const url = `https://restapi.amap.com/v3/geocode/regeo?key=${encodeURIComponent(key)}&location=${encodeURIComponent(location)}&radius=500&output=json`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.status !== '1' || !data.regeocode) {
                return { success: false, error: data.info || '逆地理编码失败' };
            }
            const r = data.regeocode;
            const addr = r.addressComponent || {};
            const streetNumber = addr.streetNumber || {};
            const streetStr = typeof streetNumber === 'object' && streetNumber.street
                ? [streetNumber.street, streetNumber.number].filter(Boolean).join('')
                : (addr.street || '');
            return {
                success: true,
                formattedAddress: r.formatted_address || r.formattedAddress || '',
                addressComponent: {
                    province: addr.province,
                    city: addr.city,
                    citycode: addr.citycode,
                    district: addr.district,
                    adcode: addr.adcode,
                    township: addr.township,
                    street: streetStr || addr.street,
                    streetNumber: typeof addr.streetNumber === 'string' ? addr.streetNumber : (streetNumber?.number || ''),
                },
            };
        } catch (e) {
            console.error('[MapService] reverseGeocodeWeb 请求失败:', e);
            return { success: false, error: String(e) };
        }
    }

    /**
     * 逆地理编码：坐标转详细地址（优先 Web 服务 API，失败时尝试 JS SDK）
     */
    async reverseGeocode(lng: number, lat: number): Promise<ReverseGeocodeResult> {
        const web = await this.reverseGeocodeWeb(lng, lat);
        if (web.success) return web;

        if (!await this.init()) {
            return { success: false, error: web.error || '地图服务未初始化' };
        }
        return new Promise((resolve) => {
            const GeocoderCtor = this.AMap!.Geocoder as new (opts?: { radius?: number }) => GeocoderService;
            const geocoder = new GeocoderCtor({ radius: 500 });
            geocoder.getAddress([lng, lat], (status: string, result: any) => {
                if (status === 'complete' && result.regeocode) {
                    const regeo = result.regeocode;
                    resolve({
                        success: true,
                        formattedAddress: regeo.formattedAddress,
                        addressComponent: regeo.addressComponent
                            ? {
                                province: regeo.addressComponent.province,
                                city: regeo.addressComponent.city,
                                citycode: regeo.addressComponent.citycode,
                                district: regeo.addressComponent.district,
                                adcode: regeo.addressComponent.adcode,
                                township: regeo.addressComponent.township,
                                street: regeo.addressComponent.street,
                                streetNumber: regeo.addressComponent.streetNumber,
                            }
                            : undefined,
                    });
                } else {
                    resolve({ success: false, error: '逆地理编码失败' });
                }
            });
        });
    }

    /**
     * 获取当前位置
     */
    async getCurrentLocation(): Promise<GeocodeResult> {
        if (!await this.init()) {
            return { success: false, error: '地图服务未初始化' };
        }

        return new Promise((resolve) => {
            const geolocation = new this.AMap!.Geolocation({
                enableHighAccuracy: true,
                timeout: 10000,
            });

            geolocation.getCurrentPosition((status, result) => {
                if (status === 'complete') {
                    resolve({
                        success: true,
                        location: { lng: result.position.lng, lat: result.position.lat },
                        formattedAddress: result.formattedAddress,
                    });
                } else {
                    resolve({ success: false, error: '定位失败' });
                }
            });
        });
    }

    /**
     * 步行路线规划
     */
    async planWalkingRoute(
        start: LngLat | string,
        end: LngLat | string
    ): Promise<RouteResult> {
        if (!await this.init()) {
            return { success: false, distance: 0, duration: 0, steps: [], error: '地图服务未初始化' };
        }

        // 如果是地址字符串，先转换为坐标
        let startLngLat: LngLat;
        let endLngLat: LngLat;

        if (typeof start === 'string') {
            const result = await this.geocode(start);
            if (!result.success || !result.location) {
                return { success: false, distance: 0, duration: 0, steps: [], error: `起点"${start}"解析失败` };
            }
            startLngLat = result.location;
        } else {
            startLngLat = start;
        }

        if (typeof end === 'string') {
            const result = await this.geocode(end);
            if (!result.success || !result.location) {
                return { success: false, distance: 0, duration: 0, steps: [], error: `终点"${end}"解析失败` };
            }
            endLngLat = result.location;
        } else {
            endLngLat = end;
        }

        return new Promise((resolve) => {
            const walking = new this.AMap!.Walking();

            walking.search(
                [startLngLat.lng, startLngLat.lat],
                [endLngLat.lng, endLngLat.lat],
                (status, result) => {
                    if (status === 'complete' && result.routes?.length > 0) {
                        const route = result.routes[0];
                        const steps = this.parseSteps(route.steps || []);

                        resolve({
                            success: true,
                            distance: route.distance || 0,
                            duration: route.time || 0,
                            steps,
                            polyline: route.path?.map((p: any) => [p.lng, p.lat]),
                        });
                    } else {
                        resolve({
                            success: false,
                            distance: 0,
                            duration: 0,
                            steps: [],
                            error: '路线规划失败',
                        });
                    }
                }
            );
        });
    }

    /**
     * 驾车路线规划
     */
    async planDrivingRoute(
        start: LngLat | string,
        end: LngLat | string
    ): Promise<RouteResult> {
        if (!await this.init()) {
            return { success: false, distance: 0, duration: 0, steps: [], error: '地图服务未初始化' };
        }

        // 地址转换逻辑同上
        let startLngLat: LngLat;
        let endLngLat: LngLat;

        if (typeof start === 'string') {
            const result = await this.geocode(start);
            if (!result.success || !result.location) {
                return { success: false, distance: 0, duration: 0, steps: [], error: `起点解析失败` };
            }
            startLngLat = result.location;
        } else {
            startLngLat = start;
        }

        if (typeof end === 'string') {
            const result = await this.geocode(end);
            if (!result.success || !result.location) {
                return { success: false, distance: 0, duration: 0, steps: [], error: `终点解析失败` };
            }
            endLngLat = result.location;
        } else {
            endLngLat = end;
        }

        return new Promise((resolve) => {
            const driving = new this.AMap!.Driving({ policy: 0 }); // 最快路线

            driving.search(
                [startLngLat.lng, startLngLat.lat],
                [endLngLat.lng, endLngLat.lat],
                (status, result) => {
                    if (status === 'complete' && result.routes?.length > 0) {
                        const route = result.routes[0];
                        const steps = this.parseSteps(route.steps || []);

                        resolve({
                            success: true,
                            distance: route.distance || 0,
                            duration: route.time || 0,
                            steps,
                            polyline: route.path?.map((p: any) => [p.lng, p.lat]),
                        });
                    } else {
                        resolve({
                            success: false,
                            distance: 0,
                            duration: 0,
                            steps: [],
                            error: '路线规划失败',
                        });
                    }
                }
            );
        });
    }

    /**
     * 解析路线步骤
     */
    private parseSteps(rawSteps: any[]): RouteStep[] {
        return rawSteps.map((step) => {
            const instruction = step.instruction || '';
            let action: RouteStep['action'] = 'straight';

            if (instruction.includes('左转') || instruction.includes('向左')) {
                action = 'left';
            } else if (instruction.includes('右转') || instruction.includes('向右')) {
                action = 'right';
            } else if (instruction.includes('到达') || instruction.includes('终点')) {
                action = 'arrive';
            } else if (instruction.includes('出发') || instruction.includes('起点')) {
                action = 'start';
            }

            return {
                instruction,
                road: step.road || '',
                distance: step.distance || 0,
                duration: step.time || 0,
                action,
            };
        });
    }

    /**
     * 格式化距离显示
     */
    formatDistance(meters: number): string {
        if (meters < 1000) {
            return `${Math.round(meters)} 米`;
        }
        return `${(meters / 1000).toFixed(1)} 公里`;
    }

    /**
     * 格式化时间显示
     */
    formatDuration(seconds: number): string {
        if (seconds < 60) {
            return `${Math.round(seconds)} 秒`;
        }
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) {
            return `${minutes} 分钟`;
        }
        const hours = Math.floor(minutes / 60);
        const remainMinutes = minutes % 60;
        return `${hours} 小时 ${remainMinutes} 分钟`;
    }

    /**
     * 创建地图实例
     */
    async createMap(containerId: string, center?: [number, number]): Promise<any> {
        if (!await this.init()) {
            return null;
        }

        try {
            // @ts-ignore
            const map = new window.AMap.Map(containerId, {
                zoom: 17,
                center: center,
                viewMode: '3D',
            });
            return map;
        } catch (e) {
            console.error('[MapService] 地图创建失败:', e);
            return null;
        }
    }

    /**
     * 添加标记
     */
    addMarker(map: any, position: [number, number], content?: string, popup?: string): any {
        if (!map || !this.AMap) return null;

        // @ts-ignore
        const marker = new window.AMap.Marker({
            position: position,
            content: content,
            anchor: 'bottom-center',
        });

        if (popup) {
            // @ts-ignore
            marker.setLabel({
                content: `<div style="padding:5px; background:white; border-radius:4px; box-shadow:0 2px 4px rgba(0,0,0,0.2);">${popup}</div>`,
                direction: 'top'
            });
        }

        map.add(marker);
        return marker;
    }

    /**
     * 添加折线
     */
    addPolyline(map: any, path: [number, number][], style: any = {}): any {
        if (!map || !this.AMap) return null;

        // @ts-ignore
        const polyline = new window.AMap.Polyline({
            path: path,
            strokeColor: style.color || "#3366FF",
            strokeOpacity: style.opacity || 1,
            strokeWeight: style.weight || 5,
            strokeStyle: style.dashArray ? "dashed" : "solid",
            strokeDasharray: style.dashArray ? style.dashArray.split(',').map(Number) : undefined,
            lineJoin: 'round',
            lineCap: 'round',
            zIndex: 50,
        });

        map.add(polyline);
        return polyline;
    }

    /**
     * 添加圆
     */
    addCircle(map: any, center: [number, number], radius: number, style: any = {}): any {
        if (!map || !this.AMap) return null;

        // @ts-ignore
        const circle = new window.AMap.Circle({
            center: center,
            radius: radius,
            strokeColor: style.color || "#3366FF",
            strokeOpacity: style.opacity || 1,
            strokeWeight: style.weight || 1,
            fillColor: style.fillColor || "#1791fc",
            fillOpacity: style.fillOpacity || 0.35,
            strokeStyle: style.dashArray ? "dashed" : "solid",
            strokeDasharray: style.dashArray ? style.dashArray.split(',').map(Number) : undefined,
        });

        map.add(circle);
        return circle;
    }

    /**
     * 清除地图覆盖物
     */
    clearMap(map: any): void {
        if (map) {
            map.clearMap();
        }
    }

    /**
     * 周边 POI（Web 服务 API）：根据当前经纬度获取附近地点，用于“当前位置相关”展示
     * 文档：https://lbs.amap.com/api/webservice/guide/api-advanced/search
     */
    async getNearbyPoisWeb(lng: number, lat: number, radius: number = 500, limit: number = 6): Promise<{ name: string; type: string; photoUrl?: string }[]> {
        const key = import.meta.env.VITE_AMAP_WEB_KEY;
        if (!key || key === 'your_amap_web_key_here') return [];
        const location = `${lng.toFixed(6)},${lat.toFixed(6)}`;
        const url = `https://restapi.amap.com/v3/place/around?key=${encodeURIComponent(key)}&location=${encodeURIComponent(location)}&radius=${radius}&types=120000|141200&offset=${Math.min(25, limit)}&page=1&extensions=all`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.status !== '1' || !Array.isArray(data.pois)) return [];
            return data.pois.slice(0, limit).map((p: any) => ({
                name: p.name || '',
                type: p.type || '',
                photoUrl: p.photos && Array.isArray(p.photos) && p.photos[0] ? p.photos[0].url : undefined,
            }));
        } catch (e) {
            console.error('[MapService] getNearbyPoisWeb 请求失败:', e);
            return [];
        }
    }

    /**
     * 获取高德静态地图图片 URL（上方定位图、多模态等）
     * 使用 Web 服务静态地图 API，返回以指定经纬度为中心的地图截图 URL
     * @param lng 经度
     * @param lat 纬度
     * @param width 图片宽度，默认 600
     * @param height 图片高度，默认 300
     * @returns 静态地图图片 URL，未配置 Key 时返回空字符串
     */
    getStaticMapUrl(lng: number, lat: number, width: number = 600, height: number = 300): string {
        const key = import.meta.env.VITE_AMAP_WEB_KEY;
        if (!key || key === 'your_amap_web_key_here') {
            return '';
        }
        const location = `${lng.toFixed(6)},${lat.toFixed(6)}`;
        const size = `${Math.min(1024, width)}*${Math.min(1024, height)}`;
        // markers 格式：size,color,label:经度,纬度（高德要求逗号分隔，不 encode 整段）
        const markers = `mid,,A:${location}`;
        const base = 'https://restapi.amap.com/v3/staticmap';
        const q = `location=${encodeURIComponent(location)}&zoom=16&size=${size}&markers=${encodeURIComponent(markers)}&key=${encodeURIComponent(key)}`;
        return `${base}?${q}`;
    }

    /**
     * 将经纬度转换为静态地图图片内的像素坐标（与高德静态图 zoom 一致，Web Mercator）
     * 用于在静态图上方叠加轨迹、当前位置点等
     */
    latLngToStaticMapPx(
        lng: number,
        lat: number,
        centerLng: number,
        centerLat: number,
        zoom: number,
        imgWidth: number,
        imgHeight: number
    ): { x: number; y: number } {
        const n = 256 * Math.pow(2, zoom);
        const toRad = (d: number) => (d * Math.PI) / 180;
        const latRad = toRad(lat);
        const centerLatRad = toRad(centerLat);
        const worldX = ((lng + 180) / 360) * n;
        const worldY =
            ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
        const centerWorldX = ((centerLng + 180) / 360) * n;
        const centerWorldY =
            ((1 - Math.log(Math.tan(centerLatRad) + 1 / Math.cos(centerLatRad)) / Math.PI) / 2) * n;
        return {
            x: worldX - centerWorldX + imgWidth / 2,
            y: worldY - centerWorldY + imgHeight / 2,
        };
    }
}

// 单例导出
export const mapService = new MapService();
