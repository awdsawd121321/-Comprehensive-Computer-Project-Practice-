/**
 * VRM 数字人渲染组件
 *
 * 加载 VRoid VRM 3D 模型，实时接收 EmotionDrivingModel 的 25 维情感输出，
 * 通过规则映射到 VRM Expression 权重，驱动面部表情和口型。
 *
 * 支持:
 * - EmotionDrivingModel 25维情感实时驱动
 * - 规则映射器 (vrmExpressionMapper) 将 AU/VA/EXP 映射到 VRM 表情
 * - WebSocket 接收推理结果
 * - 规则肢体动画（呼吸、点头、思考等）
 * - 与 emotionService 集成（降级方案）
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import * as THREE from 'three';
import { mapEmotionToVRM, resetMapperState, type VRMExpressionWeights } from '../services/vrmExpressionMapper';

// 注意: 需要安装 @pixiv/three-vrm@^3 和 three@0.160
// npm install @pixiv/three-vrm
// 由于 three-vrm 可能尚未安装，此组件使用动态导入 + 降级方案

interface EmotionFrame {
    /** 25 维情感向量 [AU×15, VA×2, EXP×8] */
    weights: number[];
    timestamp: number;
}

interface AvatarVRMProps {
    /** VRM 模型路径 */
    modelUrl: string;
    /** 是否在说话（驱动口型动画） */
    isTalking?: boolean;
    /** 是否在聆听 */
    isListening?: boolean;
    /** 是否在思考 */
    isThinking?: boolean;
    /** 当前情绪（驱动表情） */
    emotion?: 'happy' | 'sad' | 'anxious' | 'angry' | 'confused' | 'lonely' | 'calm' | 'neutral';
    /** 容器尺寸 */
    width?: number;
    height?: number;
    /** WebSocket URL (驱动模型推理服务) */
    wsUrl?: string;
    /** 点击事件 */
    onClick?: () => void;
    /** 相机高度（默认 1.4），不同体型模型可调整 */
    cameraY?: number;
    /** 相机注视点高度（默认 1.2） */
    lookAtY?: number;
    /** 模型 X 偏移（加载后平移模型） */
    modelOffsetX?: number;
    /** 模型 Y 偏移（加载后平移模型） */
    modelOffsetY?: number;
}

// 情绪 → VRM Expression 降级预设（无 WebSocket 时使用）
const EMOTION_VRM_PRESETS: Record<string, Partial<VRMExpressionWeights>> = {
    happy:    { happy: 0.6, aa: 0.1 },
    sad:      { sad: 0.5, relaxed: 0.2 },
    anxious:  { surprised: 0.3, relaxed: 0.3 },
    angry:    { angry: 0.6, relaxed: 0.1 },
    confused: { surprised: 0.3, relaxed: 0.3 },
    lonely:   { sad: 0.3, relaxed: 0.4 },
    calm:     { relaxed: 0.5 },
    neutral:  {},
};

const AvatarVRM: React.FC<AvatarVRMProps> = ({
    modelUrl,
    isTalking = false,
    isListening = false,
    isThinking = false,
    emotion = 'neutral',
    width = 400,
    height = 500,
    wsUrl,
    onClick,
    cameraY = 1.4,
    lookAtY = 1.2,
    modelOffsetX = 0,
    modelOffsetY = 0,
}) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const vrmRef = useRef<any>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const frameBufferRef = useRef<EmotionFrame[]>([]);
    const [modelLoaded, setModelLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 用 ref 追踪动态 props，避免 useEffect 闭包捕获旧值
    const emotionRef = useRef(emotion);
    const isTalkingRef = useRef(isTalking);
    const isListeningRef = useRef(isListening);
    const isThinkingRef = useRef(isThinking);
    useEffect(() => { emotionRef.current = emotion; }, [emotion]);
    useEffect(() => { isTalkingRef.current = isTalking; }, [isTalking]);
    useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
    useEffect(() => { isThinkingRef.current = isThinking; }, [isThinking]);

    // Three.js 场景初始化
    useEffect(() => {
        if (!mountRef.current) return;

        let scene: THREE.Scene;
        let renderer: THREE.WebGLRenderer;
        let camera: THREE.PerspectiveCamera;

        try {
            // 清除旧内容
            while (mountRef.current.firstChild) {
                mountRef.current.removeChild(mountRef.current.firstChild);
            }

            scene = new THREE.Scene();
            scene.background = new THREE.Color(0xf0f4f8);

            camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
            camera.position.set(0, cameraY, 1.8);
            camera.lookAt(0, lookAtY, 0);

            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setSize(width, height);
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            mountRef.current.appendChild(renderer.domElement);
        } catch (err: any) {
            console.error('[AvatarVRM] 场景初始化失败:', err);
            setError(`初始化失败: ${err?.message || err}`);
            return;
        }

        // 灯光
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(1, 2, 3);
        scene.add(dirLight);
        const fillLight = new THREE.DirectionalLight(0xaaccff, 0.3);
        fillLight.position.set(-1, 1, -1);
        scene.add(fillLight);

        // 加载 VRM 模型
        loadVRM(scene, modelUrl).then((vrm) => {
            vrmRef.current = vrm;
            setModelLoaded(true);
            setError(null);
        }).catch((err) => {
            console.error('[AvatarVRM] 模型加载失败:', err);
            setError(`模型加载失败: ${err.message}`);
        });

        // 动画循环
        const clock = new THREE.Clock();
        let frameId: number;

        const animate = () => {
            frameId = requestAnimationFrame(animate);
            const delta = clock.getDelta();
            const elapsed = clock.getElapsedTime();

            const vrm = vrmRef.current;
            if (vrm) {
                try {
                    // 应用情感驱动
                    applyBlendShapes(vrm, elapsed, delta);

                    // 空闲动画（呼吸、微动）
                    applyIdleAnimation(vrm, elapsed);

                    // VRM update
                    if (vrm.update) {
                        vrm.update(delta);
                    }
                } catch {
                    // 动画更新出错不影响渲染
                }
            }

            try {
                renderer.render(scene, camera);
            } catch {
                // 渲染失败静默忽略
            }
        };
        animate();

        return () => {
            cancelAnimationFrame(frameId);
            try {
                renderer.dispose();
                // 仅当 canvas 仍是 mountRef 子元素时才移除
                if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
                    mountRef.current.removeChild(renderer.domElement);
                }
            } catch { /* 忽略清理错误 */ }
            resetMapperState();
        };
    }, [modelUrl, width, height]);

    // WebSocket 连接（接收 EmotionDrivingModel 25 维推理结果）
    useEffect(() => {
        if (!wsUrl || !modelLoaded) return;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (Array.isArray(data) && data.length === 25) {
                    // 25 维情感向量 [AU×15, VA×2, EXP×8]
                    frameBufferRef.current.push({
                        weights: data,
                        timestamp: performance.now(),
                    });
                    // 保持缓冲区不超过 60 帧
                    if (frameBufferRef.current.length > 60) {
                        frameBufferRef.current.shift();
                    }
                }
            } catch {
                // 忽略解析错误
            }
        };

        ws.onerror = (err) => {
            console.warn('[AvatarVRM] WebSocket 错误:', err);
        };

        return () => {
            ws.close();
            wsRef.current = null;
        };
    }, [wsUrl, modelLoaded]);

    /** 加载 VRM 模型（出错则降级为占位几何体） */
    const loadVRM = async (scene: THREE.Scene, url: string): Promise<any> => {
        try {
            const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
            const threeVRM = await import('@pixiv/three-vrm');

            const loader = new GLTFLoader();
            loader.register((parser: any) => new threeVRM.VRMLoaderPlugin(parser));

            return await new Promise((resolve, reject) => {
                loader.load(
                    url,
                    (gltf: any) => {
                        const vrm = gltf.userData.vrm;
                        if (!vrm) {
                            reject(new Error('文件不是有效的 VRM 模型'));
                            return;
                        }
                        // VRM 1.0 模型默认面向 +Z 朝向摄像机，无需旋转
                        // vrm.scene.rotation.y = Math.PI; // 删除：原旋转180度导致背对镜头
                        // 应用模型偏移，让不同 VRM 模型在容器中居中
                        vrm.scene.position.x = modelOffsetX;
                        vrm.scene.position.y = modelOffsetY;
                        scene.add(vrm.scene);
                        console.log('[AvatarVRM] VRM 模型加载成功');
                        resolve(vrm);
                    },
                    undefined,
                    (err: any) => reject(err),
                );
            });
        } catch (err: any) {
            console.warn('[AvatarVRM] VRM 加载失败，使用占位模型:', err?.message || err);
            return createPlaceholderAvatar(scene);
        }
    };

    /** 占位模型（three-vrm 未安装时使用） */
    const createPlaceholderAvatar = (scene: THREE.Scene) => {
        const group = new THREE.Group();

        // 头部
        const headGeo = new THREE.SphereGeometry(0.15, 32, 32);
        const skinMat = new THREE.MeshStandardMaterial({ color: 0xffe5d8, roughness: 0.6 });
        const head = new THREE.Mesh(headGeo, skinMat);
        head.position.y = 1.55;
        group.add(head);

        // 身体
        const bodyGeo = new THREE.CylinderGeometry(0.12, 0.15, 0.4, 16);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5b8cff, roughness: 0.8 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 1.2;
        group.add(body);

        // 眼睛
        const eyeGeo = new THREE.SphereGeometry(0.02, 16, 16);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2d1b15 });
        const lEye = new THREE.Mesh(eyeGeo, eyeMat);
        lEye.position.set(-0.05, 1.57, 0.13);
        group.add(lEye);
        const rEye = new THREE.Mesh(eyeGeo, eyeMat);
        rEye.position.set(0.05, 1.57, 0.13);
        group.add(rEye);

        // 嘴巴
        const mouthGeo = new THREE.CapsuleGeometry(0.01, 0.04, 4, 8);
        const mouthMat = new THREE.MeshBasicMaterial({ color: 0xd88080 });
        const mouth = new THREE.Mesh(mouthGeo, mouthMat);
        mouth.position.set(0, 1.5, 0.14);
        mouth.rotation.z = Math.PI / 2;
        group.add(mouth);

        scene.add(group);

        // 返回兼容接口
        return {
            scene: group,
            update: () => {},
            expressionManager: null,
            humanoid: null,
            _placeholder: true,
            _head: head,
            _mouth: mouth,
            _lEye: lEye,
            _rEye: rEye,
        };
    };

    /** 将 VRM Expression 权重应用到模型 */
    const applyVRMWeights = (vrm: any, weights: VRMExpressionWeights) => {
        if (!vrm.expressionManager) return;
        for (const [name, value] of Object.entries(weights)) {
            try {
                vrm.expressionManager.setValue(name, value);
            } catch {
                // 该表情 VRM 模型不支持，静默忽略
            }
        }
    };

    /** 应用情感驱动帧到 VRM 模型 */
    const applyBlendShapes = (vrm: any, elapsed: number, delta: number) => {
        const frame = frameBufferRef.current.shift();

        if (frame && frame.weights.length === 25 && vrm.expressionManager) {
            // 有 ML 驱动帧 → 25维 → VRM 映射
            const vrmWeights = mapEmotionToVRM(frame.weights, delta);
            applyVRMWeights(vrm, vrmWeights);
        } else if (vrm.expressionManager) {
            // 降级：情绪预设 + 基础动画
            applyEmotionPreset(vrm, emotionRef.current, elapsed);
        } else if (vrm._placeholder) {
            // 占位模型：简单动画
            applyPlaceholderAnimation(vrm, elapsed);
        }
    };

    /** 情绪预设应用（降级方案，无 WebSocket 时） */
    const applyEmotionPreset = (vrm: any, emo: string, elapsed: number) => {
        if (!vrm.expressionManager) return;

        const preset = EMOTION_VRM_PRESETS[emo] || {};

        // 先重置所有表情为 0
        const allExprs = ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'aa', 'ih', 'ou', 'ee', 'oh'];
        for (const name of allExprs) {
            try { vrm.expressionManager.setValue(name, 0); } catch { /* ignore */ }
        }

        // 应用预设
        for (const [name, value] of Object.entries(preset)) {
            try { vrm.expressionManager.setValue(name, value); } catch { /* ignore */ }
        }

        // 眨眼 — 增加随机感，每 3~5 秒眨一次
        const blinkPeriod = 3.5 + Math.sin(elapsed * 0.1) * 0.8;
        const blinkCycle = elapsed % blinkPeriod;
        const blinkValue = (blinkCycle > blinkPeriod - 0.15) ? 1.0 : 0.0;
        // 偶尔双眨
        const doubleBlinkPhase = elapsed % 7.2;
        const doubleBlink = (doubleBlinkPhase > 5.8 && doubleBlinkPhase < 5.95) ? 1.0 : 0.0;
        const finalBlink = Math.max(blinkValue, doubleBlink);
        try {
            vrm.expressionManager.setValue('blinkLeft', finalBlink);
            vrm.expressionManager.setValue('blinkRight', finalBlink);
        } catch { /* ignore */ }

        // 即使 neutral 状态也保持微微笑意
        try {
            const currentRelaxed = (preset as any).relaxed || 0;
            const minSmile = 0.08 + Math.sin(elapsed * 0.2) * 0.03;
            if (currentRelaxed < minSmile) {
                vrm.expressionManager.setValue('relaxed', minSmile);
            }
        } catch { /* ignore */ }

        // 说话口型 — 更丰富的嘴部运动
        if (isTalkingRef.current) {
            const mouthOpen = 0.3 + Math.sin(elapsed * 8) * 0.2 + Math.sin(elapsed * 12) * 0.1;
            try { vrm.expressionManager.setValue('aa', Math.max(0, mouthOpen)); } catch { /* ignore */ }
            try { vrm.expressionManager.setValue('oh', Math.sin(elapsed * 5) * 0.15); } catch { /* ignore */ }
            try { vrm.expressionManager.setValue('ee', Math.sin(elapsed * 7) * 0.08 + 0.05); } catch { /* ignore */ }
        }
    };

    /** 通过骨骼名称直接遍历 VRM scene 查找骨骼节点 */
    const findBoneByName = (vrm: any, name: string): THREE.Object3D | null => {
        let result: THREE.Object3D | null = null;
        vrm.scene.traverse((node: THREE.Object3D) => {
            if (node.name.toLowerCase().includes(name.toLowerCase())) {
                result = node;
            }
        });
        return result;
    };

    /** 空闲动画 — 呼吸、轻微晃头、身体微摆、胳膊自然下垂 */
    const applyIdleAnimation = (vrm: any, elapsed: number) => {
        if (!vrm.humanoid && !vrm._placeholder) return;

        if (vrm._placeholder) {
            // 占位模型呼吸
            vrm._head.position.y = 1.55 + Math.sin(elapsed * 1.5) * 0.005;
            return;
        }

        // 微摆参数
        const breathe = Math.sin(elapsed * 1.5) * 0.02;
        const sway = Math.sin(elapsed * 0.6) * 0.01;

        // VRM 骨骼动画
        try {
            // ---- 胳膊自然下垂 ----
            // T-pose → 自然下垂：绕 Z 轴旋转约 80°，绕 X 轴微微前倾
            // 用户反馈 +1.35 导致胳膊向上，故取反
            const ARM_ROT_Z = -1.35;  // 左臂负值，右臂镜像为正值
            const ARM_ROT_X = 0.06;  // 微微前倾，显得更自然
            const ARM_ROT_Z_SWAY = Math.sin(elapsed * 0.7) * 0.015;  // 手臂轻微摆动
            const ARM_ROT_X_SWAY = Math.sin(elapsed * 1.0) * 0.005;

            // 优先用 humanoid API，备用直接遍历 scene
            const getBone = (name: string) => {
                const fromHumanoid = vrm.humanoid?.getNormalizedBoneNode(name);
                return fromHumanoid || findBoneByName(vrm, name);
            };

            const luArm = getBone('leftUpperArm');
            const ruArm = getBone('rightUpperArm');
            const llArm = getBone('leftLowerArm');
            const rlArm = getBone('rightLowerArm');

            if (luArm) {
                // 左上臂：从 T-pose 水平位旋转向下约 77°
                luArm.rotation.z = ARM_ROT_Z + ARM_ROT_Z_SWAY;
                luArm.rotation.x = -ARM_ROT_X + ARM_ROT_X_SWAY;
            }
            if (ruArm) {
                // 右上臂：镜像方向
                ruArm.rotation.z = -ARM_ROT_Z - ARM_ROT_Z_SWAY;
                ruArm.rotation.x = -ARM_ROT_X - ARM_ROT_X_SWAY;
            }
            if (llArm) {
                // 左前臂：轻微向前弯曲，保持自然弧度
                llArm.rotation.x = -0.15 + Math.sin(elapsed * 0.9) * 0.01;
            }
            if (rlArm) {
                rlArm.rotation.x = -0.15 - Math.sin(elapsed * 0.9) * 0.01;
            }

            // ---- 说话时手臂微动 ----
            if (isTalkingRef.current) {
                if (luArm) luArm.rotation.z += Math.sin(elapsed * 2.5) * 0.04;
                if (ruArm) ruArm.rotation.z -= Math.sin(elapsed * 2.5) * 0.04;
                if (llArm) llArm.rotation.x += Math.sin(elapsed * 3) * 0.03;
                if (rlArm) rlArm.rotation.x -= Math.sin(elapsed * 3) * 0.03;
            }

            // ---- 上半身 ----
            const spine = vrm.humanoid?.getNormalizedBoneNode('spine');
            if (spine) {
                spine.rotation.x = breathe;
                spine.rotation.z = sway;
            }

            const head = vrm.humanoid?.getNormalizedBoneNode('head');
            if (head) {
                head.rotation.y = Math.sin(elapsed * 0.5) * 0.06;
                head.rotation.x = Math.sin(elapsed * 0.3) * 0.04;
                head.rotation.z = Math.sin(elapsed * 0.7) * 0.02;
            }

            // 聆听时：明显点头反馈
            if (isListeningRef.current && head) {
                head.rotation.x += Math.sin(elapsed * 1.2) * 0.08;
            }

            // 思考时：歪头 + 眼神偏移
            if (isThinkingRef.current && head) {
                head.rotation.z = Math.sin(elapsed * 0.8) * 0.1;
                head.rotation.y += 0.1;
            }

            // 说话时：身体微动 + 更大幅度呼吸
            if (isTalkingRef.current && spine) {
                spine.rotation.x += Math.sin(elapsed * 3) * 0.02;
                spine.rotation.z += Math.sin(elapsed * 2.5) * 0.01;
            }
        } catch {
            // 骨骼访问失败时静默忽略
        }
    };

    /** 占位模型动画 */
    const applyPlaceholderAnimation = (vrm: any, elapsed: number) => {
        // 呼吸
        vrm._head.position.y = 1.55 + Math.sin(elapsed * 1.5) * 0.005;

        // 说话时嘴巴动
        if (isTalkingRef.current) {
            const scale = 1 + Math.abs(Math.sin(elapsed * 8)) * 0.5;
            vrm._mouth.scale.y = scale;
        } else {
            vrm._mouth.scale.y = 1;
        }

        // 眨眼
        const blinkCycle = elapsed % 3.5;
        const isBlinking = blinkCycle > 3.3;
        vrm._lEye.scale.y = isBlinking ? 0.1 : 1;
        vrm._rEye.scale.y = isBlinking ? 0.1 : 1;
    };

    /** 向 WebSocket 发送音频数据（请求情感驱动推理） */
    const sendAudioForDriving = useCallback((audioBuffer: ArrayBuffer, emotionCondition: number[]) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            const audioBase64 = btoa(
                String.fromCharCode(...new Uint8Array(audioBuffer))
            );
            wsRef.current.send(JSON.stringify({
                audio: audioBase64,
                emotion: emotionCondition,  // 10维: [v, a, n, h, s, su, f, d, an, c]
            }));
        }
    }, []);

    return (
        <div
            style={{
                width,
                height,
                position: 'relative',
                cursor: onClick ? 'pointer' : 'default',
                borderRadius: 16,
                overflow: 'hidden',
            }}
            onClick={onClick}
        >
            {/* Three.js 专用容器 — React 不管理此 div 的子元素 */}
            <div
                ref={mountRef}
                style={{ width: '100%', height: '100%' }}
            />

            {/* 加载状态 */}
            {!modelLoaded && !error && (
                <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(240,244,248,0.9)',
                    fontSize: 14, color: '#666',
                }}>
                    加载数字人模型...
                </div>
            )}

            {/* 错误状态 */}
            {error && (
                <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(255,240,240,0.9)',
                    fontSize: 12, color: '#c00', padding: 16, textAlign: 'center',
                }}>
                    {error}
                </div>
            )}

            {/* 状态指示器 */}
            {isListening && (
                <div style={{
                    position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
                    padding: '4px 12px', borderRadius: 20,
                    backgroundColor: 'rgba(99,102,241,0.8)', color: '#fff', fontSize: 12,
                }}>
                    聆听中...
                </div>
            )}
            {isThinking && !isListening && (
                <div style={{
                    position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
                    padding: '4px 12px', borderRadius: 20,
                    backgroundColor: 'rgba(245,158,11,0.8)', color: '#fff', fontSize: 12,
                }}>
                    思考中...
                </div>
            )}
        </div>
    );
};

export default AvatarVRM;
