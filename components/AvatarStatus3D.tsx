import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { SystemStatus } from '../types';
import { AvatarState } from '../services/healthStateService';

interface AvatarStatus3DProps {
    status: SystemStatus;
    healthState?: AvatarState;
    size?: number;
}

/**
 * 3D 老年数字人形象，用于子女端 Dashboard 总览。
 * 根据系统状态和健康数据呈现不同动画效果和视觉反馈。
 */
const AvatarStatus3D: React.FC<AvatarStatus3DProps> = ({ status, healthState, size = 110 }) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const healthStateRef = useRef<AvatarState | undefined>(healthState);

    // 始终保持 ref 为最新，供动画循环每帧读取（避免 healthState 在 deps 中导致场景反复销毁重建）
    useEffect(() => {
        healthStateRef.current = healthState;
    }, [healthState]);

    useEffect(() => {
        if (!mountRef.current) return;

        // 清除可能存在的旧 canvas（如 React Strict Mode 双重挂载残留）
        while (mountRef.current.firstChild) {
            mountRef.current.removeChild(mountRef.current.firstChild);
        }

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
        camera.position.z = 5.5;
        camera.position.y = -0.2;

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setSize(size, size);
        renderer.setPixelRatio(window.devicePixelRatio);
        mountRef.current.appendChild(renderer.domElement);

        const ambientLight = new THREE.AmbientLight(0xffffff, 1.3);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
        dirLight.position.set(2, 5, 5);
        scene.add(dirLight);

        const charGroup = new THREE.Group();
        scene.add(charGroup);

        // --- Materials（颜色在 animate 中按 healthStateRef 实时更新）---
        const skinMat = new THREE.MeshPhysicalMaterial({ color: 0xffe5d8, roughness: 0.5 });
        const hairMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6, metalness: 0.1 });
        const eyesMat = new THREE.MeshBasicMaterial({ color: 0x2d1b15 });
        const mouthMat = new THREE.MeshBasicMaterial({ color: 0x4a2c2a });
        const tongueMat = new THREE.MeshBasicMaterial({ color: 0xe06c75 });

        const sweaterMat = new THREE.MeshStandardMaterial({ color: 0x2e3b4e, roughness: 0.9 });
        const sweaterRibMat = new THREE.MeshStandardMaterial({ color: 0x243040, roughness: 0.9 });
        const buttonMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.1 });

        const blushMat = new THREE.MeshBasicMaterial({ color: 0xff8a8a, transparent: true, opacity: 0.15 });
        const wrinkleMat = new THREE.MeshBasicMaterial({ color: 0xdeb8a6, transparent: true, opacity: 0.6 });

        // 新增：汗珠材质（出汗时显示）
        const sweatMat = new THREE.MeshPhysicalMaterial({ 
            color: 0xddddff, 
            transparent: true, 
            opacity: 0.6,
            roughness: 0.1,
            metalness: 0.3,
        });

        // --- Head ---
        const head = new THREE.Mesh(new THREE.SphereGeometry(1.2, 32, 32), skinMat);
        charGroup.add(head);

        // --- Neck ---
        const neckGeo = new THREE.CylinderGeometry(0.5, 0.6, 0.6, 32);
        const neck = new THREE.Mesh(neckGeo, skinMat);
        neck.position.y = -1.0;
        charGroup.add(neck);

        // --- Body (Sweater) ---
        const body = new THREE.Mesh(new THREE.SphereGeometry(1.0, 32, 32), sweaterMat);
        body.position.y = -1.7;
        body.scale.set(1.1, 1.1, 0.9);
        charGroup.add(body);

        // --- Buttons ---
        const buttonGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.03, 16);
        const createButton = (y: number, z: number, rotX: number) => {
            const b = new THREE.Mesh(buttonGeo, buttonMat);
            b.rotation.x = Math.PI / 2 + rotX;
            b.position.set(0, y, z);
            charGroup.add(b);
        };
        createButton(-1.35, 0.88, -0.2);
        createButton(-1.65, 0.94, -0.1);
        createButton(-1.95, 0.96, 0);
        createButton(-2.25, 0.91, 0.1);

        // --- Arms ---
        const armGeo = new THREE.CapsuleGeometry(0.17, 1.2, 4, 8);
        const handGeo = new THREE.SphereGeometry(0.16, 16, 16);

        const lArm = new THREE.Mesh(armGeo, sweaterMat);
        lArm.position.set(-1.0, -1.35, -0.1);
        lArm.rotation.set(-0.1, 0.1, -0.15);
        const lHand = new THREE.Mesh(handGeo, skinMat);
        lHand.position.y = -0.8;
        lArm.add(lHand);
        const lCuff = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.04, 8, 16), sweaterRibMat);
        lCuff.position.y = -0.65;
        lCuff.rotation.x = Math.PI / 2;
        lArm.add(lCuff);
        charGroup.add(lArm);

        const rArm = new THREE.Mesh(armGeo, sweaterMat);
        rArm.position.set(1.0, -1.35, -0.1);
        rArm.rotation.set(-0.1, -0.1, 0.15);
        const rHand = new THREE.Mesh(handGeo, skinMat);
        rHand.position.y = -0.8;
        rArm.add(rHand);
        const rCuff = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.04, 8, 16), sweaterRibMat);
        rCuff.position.y = -0.65;
        rCuff.rotation.x = Math.PI / 2;
        rArm.add(rCuff);
        charGroup.add(rArm);

        // --- Hair ---
        const hairGeo = new THREE.SphereGeometry(0.5, 16, 16);
        const createHairBlock = (
            x: number, y: number, z: number,
            sx: number, sy: number, sz: number,
            rx = 0, ry = 0, rz = 0
        ) => {
            const m = new THREE.Mesh(hairGeo, hairMat);
            m.position.set(x, y, z);
            m.scale.set(sx, sy, sz);
            m.rotation.set(rx, ry, rz);
            head.add(m);
        };
        createHairBlock(0.2, 1.15, 0.1, 2.1, 0.8, 1.8, 0, 0, -0.2);
        createHairBlock(-0.8, 1.0, 0.2, 1.1, 0.9, 1.4, 0, 0, 0.2);
        createHairBlock(0, 0.6, -0.8, 2.3, 1.8, 1.2);
        createHairBlock(-1.12, 0.4, 0.1, 0.3, 1.2, 0.8);
        createHairBlock(1.12, 0.4, 0.1, 0.3, 1.2, 0.8);

        // --- Face Features ---
        const eyeGeo = new THREE.CapsuleGeometry(0.08, 0.12, 4, 8);
        const lEye = new THREE.Mesh(eyeGeo, eyesMat);
        lEye.position.set(-0.35, 0.2, 1.12);
        head.add(lEye);
        const rEye = new THREE.Mesh(eyeGeo, eyesMat);
        rEye.position.set(0.35, 0.2, 1.12);
        head.add(rEye);

        const browGeo = new THREE.CapsuleGeometry(0.045, 0.28, 4, 8);
        const browMat = new THREE.MeshBasicMaterial({ color: 0x999999 });
        const lBrow = new THREE.Mesh(browGeo, browMat);
        lBrow.position.set(-0.35, 0.55, 1.15);
        lBrow.rotation.z = 1.65;
        head.add(lBrow);
        const rBrow = new THREE.Mesh(browGeo, browMat);
        rBrow.position.set(0.35, 0.55, 1.15);
        rBrow.rotation.z = -1.65;
        head.add(rBrow);

        const nose = new THREE.Mesh(
            new THREE.SphereGeometry(0.09, 16, 16),
            new THREE.MeshPhysicalMaterial({ color: 0xffd1c2, roughness: 0.5 })
        );
        nose.position.set(0, 0.1, 1.22);
        head.add(nose);

        const lineGeo = new THREE.TorusGeometry(0.5, 0.012, 4, 16, 0.8);
        const line1 = new THREE.Mesh(lineGeo, wrinkleMat);
        line1.position.set(0, 0.8, 1.1);
        line1.rotation.z = Math.PI / 2 + 2.74;
        line1.rotation.x = -0.3;
        head.add(line1);
        const line2 = new THREE.Mesh(lineGeo, wrinkleMat);
        line2.position.set(0, 0.95, 1.05);
        line2.rotation.z = Math.PI / 2 + 2.74;
        line2.rotation.x = -0.4;
        head.add(line2);

        const cheekGeo = new THREE.CircleGeometry(0.25, 32);
        const lCheek = new THREE.Mesh(cheekGeo, blushMat);
        lCheek.position.set(-0.7, -0.05, 1.05);
        lCheek.rotation.y = -0.4;
        head.add(lCheek);
        const rCheek = new THREE.Mesh(cheekGeo, blushMat);
        rCheek.position.set(0.7, -0.05, 1.05);
        rCheek.rotation.y = 0.4;
        head.add(rCheek);

        // 黑眼圈（睡眠不足时显示，ellipse 形状放在眼睛下方）
        const darkCircleMat = new THREE.MeshBasicMaterial({
            color: 0x7a6b7a,
            transparent: true,
            opacity: 0,
            depthWrite: false,
        });
        const darkCircleGeo = new THREE.CircleGeometry(0.12, 32);
        const lDarkCircle = new THREE.Mesh(darkCircleGeo, darkCircleMat);
        lDarkCircle.position.set(-0.38, 0.02, 1.1);
        lDarkCircle.rotation.y = -0.35;
        lDarkCircle.scale.set(1.2, 0.8, 1);
        head.add(lDarkCircle);
        const rDarkCircle = new THREE.Mesh(darkCircleGeo, darkCircleMat);
        rDarkCircle.position.set(0.38, 0.02, 1.1);
        rDarkCircle.rotation.y = 0.35;
        rDarkCircle.scale.set(1.2, 0.8, 1);
        head.add(rDarkCircle);

        const mouthGroup = new THREE.Group();
        const mouthShape = new THREE.Mesh(new THREE.CircleGeometry(0.12, 32, 0, Math.PI), mouthMat);
        mouthShape.rotation.z = Math.PI;
        mouthGroup.add(mouthShape);
        const tongue = new THREE.Mesh(new THREE.CircleGeometry(0.08, 32, 0, Math.PI), tongueMat);
        tongue.rotation.z = Math.PI;
        tongue.position.y = -0.04;
        tongue.position.z = 0.01;
        mouthGroup.add(tongue);
        mouthGroup.position.set(0, -0.25, 1.18);
        mouthGroup.rotation.x = -0.1;
        head.add(mouthGroup);

        const beardGroup = new THREE.Group();
        head.add(beardGroup);
        const beardGeo = new THREE.ConeGeometry(0.18, 0.35, 64);
        const chinBeard = new THREE.Mesh(beardGeo, hairMat);
        chinBeard.position.set(0, -1.08, 0.92);
        chinBeard.rotation.x = Math.PI + 0.15;
        chinBeard.scale.set(1, 1, 0.5);
        beardGroup.add(chinBeard);

        const earGeo = new THREE.SphereGeometry(0.25, 32, 32);
        const lEar = new THREE.Mesh(earGeo, skinMat);
        lEar.position.set(-1.18, 0.1, 0);
        lEar.scale.z = 0.5;
        head.add(lEar);
        const rEar = new THREE.Mesh(earGeo, skinMat);
        rEar.position.set(1.18, 0.1, 0);
        rEar.scale.z = 0.5;
        head.add(rEar);

        // 汗珠（始终创建，animate 中根据 sweating 控制可见性和大小）
        const sweatGeo = new THREE.SphereGeometry(0.04, 8, 8);
        const sweatDrops: THREE.Mesh[] = [];
        const sweatPositions = [[-0.2, 0.9, 1.0], [0.15, 0.95, 1.05], [-0.4, 0.8, 0.95], [-0.6, 0.3, 0.95], [0.5, 0.25, 1.0]];
        sweatPositions.forEach(([x, y, z]) => {
            const drop = new THREE.Mesh(sweatGeo, sweatMat);
            drop.position.set(x, y, z);
            head.add(drop);
            sweatDrops.push(drop);
        });

        const lipMat = new THREE.MeshBasicMaterial({ color: 0xd88080 });
        const upperLip = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.025, 0.18, 4, 8),
            lipMat
        );
        upperLip.position.set(0, -0.13, 1.19);
        upperLip.rotation.z = Math.PI / 2;
        head.add(upperLip);
        const lowerLip = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.03, 0.2, 4, 8),
            lipMat
        );
        lowerLip.position.set(0, -0.23, 1.19);
        lowerLip.rotation.z = Math.PI / 2;
        head.add(lowerLip);

        // 新增：心跳指示器（胸部位置的脉冲圆环）
        const heartbeatRingMat = new THREE.MeshBasicMaterial({
            color: 0xff6b6b,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
        });
        const heartbeatRing = new THREE.Mesh(
            new THREE.RingGeometry(0.15, 0.25, 32),
            heartbeatRingMat
        );
        heartbeatRing.position.set(0, -1.4, 0.95);
        charGroup.add(heartbeatRing);

        // 新增：太阳穴血管（左右两侧）
        const veinMat = new THREE.MeshBasicMaterial({
            color: 0x8866aa,
            transparent: true,
            opacity: 0,
        });
        const veinGeo = new THREE.CapsuleGeometry(0.02, 0.15, 4, 8);
        const lVein = new THREE.Mesh(veinGeo, veinMat);
        lVein.position.set(-0.95, 0.4, 0.6);
        lVein.rotation.z = 0.3;
        head.add(lVein);
        const rVein = new THREE.Mesh(veinGeo, veinMat);
        rVein.position.set(0.95, 0.4, 0.6);
        rVein.rotation.z = -0.3;
        head.add(rVein);

        // 新增：健康光晕（背后的圆形光环）
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0x4ade80,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide,
        });
        const glowRing = new THREE.Mesh(
            new THREE.RingGeometry(2.2, 2.8, 64),
            glowMat
        );
        glowRing.position.z = -1.5;
        glowRing.position.y = -0.5;
        charGroup.add(glowRing);

        // 手部材质（用于指尖紫绀）
        const fingerMat = new THREE.MeshPhysicalMaterial({ color: 0xffe5d8, roughness: 0.5 });

        let frameId: number;
        const clock = new THREE.Clock();

        const animate = () => {
            frameId = requestAnimationFrame(animate);
            const t = clock.getElapsedTime();
            const hs = healthStateRef.current;

            // 每帧根据最新 healthState 更新材质
            if (hs) {
                const skinColor = hs.skinTone === 'pale' ? 0xf5e6dc : hs.skinTone === 'flushed' ? 0xffbfa6 : 0xffe5d8;
                skinMat.color.setHex(skinColor);
                tongueMat.color.setHex(hs.lipColor === 'pale' ? 0xf0b5b8 : hs.lipColor === 'cyanotic' ? 0xb08090 : 0xe06c75);
                lipMat.color.setHex(hs.lipColor === 'rosy' ? 0xef9090 : hs.lipColor === 'pale' ? 0xdbb0b0 : hs.lipColor === 'cyanotic' ? 0x9070a0 : 0xd88080);
                let bo = 0.15;
                if (hs.mood === 'happy') bo = 0.25;
                if (hs.mood === 'tired' || hs.mood === 'sleepy') bo = 0.05;
                if (hs.skinTone === 'flushed') bo = 0.35;
                blushMat.opacity = bo;
                const sw = hs.sweating ?? 0;
                sweatDrops.forEach(d => {
                    d.visible = sw > 0.2;
                    d.scale.setScalar(sw > 0.2 ? Math.max(0.3, sw) : 0.01);
                });
                const dci = hs.darkCircleIntensity ?? 0;
                lDarkCircle.visible = rDarkCircle.visible = dci > 0;
                darkCircleMat.opacity = dci * 0.55;

                // 指尖紫绀（手部颜色变化）
                const fc = hs.fingerCyanosis ?? 0;
                if (fc > 0) {
                    const cyanColor = new THREE.Color(0xffe5d8).lerp(new THREE.Color(0xc8a0c8), fc);
                    fingerMat.color.copy(cyanColor);
                    lHand.material = rHand.material = fingerMat;
                } else {
                    lHand.material = rHand.material = skinMat;
                }

                // 太阳穴血管跳动（高血压可视化）
                const tvp = hs.templeVeinPulse ?? 0;
                lVein.visible = rVein.visible = tvp > 0.1;
                if (tvp > 0) {
                    const pulse = Math.sin(t * (hs.heartbeatSpeed ?? 1.2) * Math.PI * 2) * 0.5 + 0.5;
                    veinMat.opacity = tvp * 0.6 * (0.5 + pulse * 0.5);
                    lVein.scale.setScalar(1 + pulse * 0.3 * tvp);
                    rVein.scale.setScalar(1 + pulse * 0.3 * tvp);
                }

                // 健康光晕颜色
                const glowColor = hs.overallHealthGlow === 'red' ? 0xef4444 :
                    hs.overallHealthGlow === 'orange' ? 0xf97316 :
                    hs.overallHealthGlow === 'yellow' ? 0xeab308 : 0x4ade80;
                glowMat.color.setHex(glowColor);
                glowMat.opacity = hs.overallHealthGlow === 'green' ? 0.12 : 0.25;
            } else {
                lDarkCircle.visible = rDarkCircle.visible = false;
                lVein.visible = rVein.visible = false;
            }

            // 根据健康状态调整动画（每帧读取最新值）
            const energy = hs?.energy ?? 70;
            const posture = hs?.posture ?? 'relaxed';
            const breathingRate = hs?.breathingRate ?? 'normal';
            const tremor = hs?.tremor ?? 0;
            const headTilt = hs?.headTilt ?? 0;
            const shoulderSlump = hs?.shoulderSlump ?? 0;
            const facialExpression = hs?.facialExpression ?? 'neutral';
            const heartbeatIntensity = hs?.heartbeatIntensity ?? 0.3;
            const heartbeatSpeed = hs?.heartbeatSpeed ?? 1.2;
            const bodyStability = hs?.bodyStability ?? 0.8;
            const headachePose = hs?.headachePose ?? false;
            
            // 基础动画强度（根据精力值）
            const intensity = energy / 100;

            // 心跳动画（胸部脉冲）
            const heartPhase = t * heartbeatSpeed * Math.PI * 2;
            const heartPulse = Math.pow(Math.max(0, Math.sin(heartPhase)), 3);  // 锐利的脉冲波形
            heartbeatRing.visible = heartbeatIntensity > 0.2;
            heartbeatRingMat.opacity = heartPulse * heartbeatIntensity * 0.8;
            heartbeatRing.scale.setScalar(1 + heartPulse * 0.5 * heartbeatIntensity);

            // 身体稳定性（步数少时轻微晃动）
            const instability = 1 - bodyStability;
            const wobble = instability > 0.3 ? {
                x: Math.sin(t * 0.7) * 0.02 * instability,
                z: Math.sin(t * 0.5) * 0.015 * instability,
            } : { x: 0, z: 0 };

            // 颤抖效果（低血氧、疲劳时）
            const tremorOffset = tremor > 0 ? {
                // 仅保留轻微上下抖动，避免左右晃动造成惊吓感
                x: 0,
                y: Math.sin(t * 10) * 0.004 * tremor,
                z: 0,
            } : { x: 0, y: 0, z: 0 };

            if (status === SystemStatus.NORMAL) {
                // 正常状态 - 根据健康数据微调
                if (posture === 'slouched') {
                    // 疲惫姿态 - 身体前倾，动作缓慢，肩膀下沉
                    charGroup.position.y = Math.sin(t * 0.8) * 0.03 - 0.15 - shoulderSlump * 0.2 + tremorOffset.y;
                    charGroup.rotation.y = Math.sin(t * 0.3) * 0.05 + tremorOffset.x * 0.5 + wobble.x;
                    charGroup.rotation.x = 0.1 + shoulderSlump * 0.15; // 身体前倾
                    charGroup.rotation.z = tremorOffset.z * 0.3 + wobble.z;
                    head.rotation.x = Math.sin(t * 0.2) * 0.03 + 0.15 + headTilt * 0.3; // 头部下垂
                    // 头痛姿势：手扶额头
                    if (headachePose) {
                        rArm.rotation.x = -0.8;
                        rArm.rotation.z = 0.6;
                        rArm.position.y = -1.1;
                    } else {
                        lArm.rotation.x = -0.15 - shoulderSlump * 0.1;
                        rArm.rotation.x = -0.15 - shoulderSlump * 0.1;
                        rArm.rotation.z = 0.15;
                        rArm.position.y = -1.35;
                    }
                } else if (posture === 'upright') {
                    // 精神饱满 - 挺直，动作活泼
                    charGroup.position.y = Math.sin(t * 1.8) * 0.06 + tremorOffset.y;
                    charGroup.rotation.y = Math.sin(t * 0.6) * 0.1 * intensity + tremorOffset.x * 0.2 + wobble.x;
                    charGroup.rotation.z = tremorOffset.z * 0.2 + wobble.z;
                    head.rotation.x = Math.sin(t * 0.4) * 0.06 - headTilt * 0.1;
                    if (headachePose) {
                        rArm.rotation.x = -0.8;
                        rArm.rotation.z = 0.6;
                        rArm.position.y = -1.1;
                    } else {
                        lArm.rotation.x = -0.1 + Math.sin(t * 2.0) * 0.08 * intensity;
                        rArm.rotation.x = -0.1 - Math.sin(t * 2.0) * 0.08 * intensity;
                        rArm.rotation.z = 0.15;
                        rArm.position.y = -1.35;
                    }
                } else {
                    // 放松姿态（默认）
                    charGroup.position.y = Math.sin(t * 1.5) * 0.05 - shoulderSlump * 0.1 + tremorOffset.y;
                    charGroup.rotation.y = Math.sin(t * 0.5) * 0.08 + tremorOffset.x * 0.3 + wobble.x;
                    charGroup.rotation.x = shoulderSlump * 0.08;
                    charGroup.rotation.z = tremorOffset.z * 0.25 + wobble.z;
                    head.rotation.x = Math.sin(t * 0.3) * 0.05 + headTilt * 0.2;
                    if (headachePose) {
                        rArm.rotation.x = -0.8;
                        rArm.rotation.z = 0.6;
                        rArm.position.y = -1.1;
                    } else {
                        lArm.rotation.x = -0.1 + Math.sin(t * 1.5) * 0.05 - shoulderSlump * 0.05;
                        rArm.rotation.x = -0.1 - Math.sin(t * 1.5) * 0.05 - shoulderSlump * 0.05;
                        rArm.rotation.z = 0.15;
                        rArm.position.y = -1.35;
                    }
                }

                // 呼吸动画（根据呼吸频率和健康数据）
                let breathSpeed = 2.0;
                let breathDepth = 0.02;
                if (breathingRate === 'rapid') {
                    breathSpeed = 5.0;
                    breathDepth = 0.04;
                } else if (breathingRate === 'fast') {
                    breathSpeed = 3.5;
                    breathDepth = 0.03;
                } else if (breathingRate === 'slow') {
                    breathSpeed = 1.2;
                    breathDepth = 0.015;
                }
                // 叠加心跳节律到呼吸
                const heartbeatEffect = heartPulse * heartbeatIntensity * 0.015;
                body.scale.y = 1.1 + Math.sin(t * breathSpeed) * breathDepth + heartbeatEffect;
                body.scale.x = 1.1 + heartbeatEffect * 0.3;
                
                // 胸部呼吸时的轻微前后移动
                body.position.z = Math.sin(t * breathSpeed) * breathDepth * 0.5;
            } else if (status === SystemStatus.WARNING) {
                // 警告状态：保持克制，仅表现焦虑（不左右颤抖）
                charGroup.position.y = -0.08 + Math.sin(t * 1.4) * 0.03;
                charGroup.rotation.y = Math.sin(t * 0.6) * 0.05;
                charGroup.rotation.z = 0;
                charGroup.rotation.x = 0.08 + shoulderSlump * 0.05;
                head.rotation.y = Math.sin(t * 0.9) * 0.08;
                head.rotation.x = 0.12 + headTilt * 0.2;
                body.scale.y = 1.1 + Math.sin(t * 3.2) * 0.03; // 呼吸偏快
                body.position.z = Math.sin(t * 3.2) * 0.01;
            } else if (status === SystemStatus.CRITICAL) {
                // 高风险状态：更紧张但不“抖”，避免夸张表现
                charGroup.position.y = -0.12 + Math.sin(t * 1.1) * 0.02;
                charGroup.rotation.y = Math.sin(t * 0.4) * 0.04;
                charGroup.rotation.z = 0;
                charGroup.rotation.x = 0.12 + shoulderSlump * 0.1;
                head.rotation.x = 0.18 + headTilt * 0.22;
                body.scale.y = 1.1 + Math.sin(t * 3.8) * 0.035;
                body.position.z = Math.sin(t * 3.8) * 0.012;
            }

            // 面部表情调整（眉毛位置）
            if (facialExpression === 'pained' || facialExpression === 'distressed') {
                // 痛苦/不适表情：眉毛下垂、紧皱
                lBrow.position.y = 0.5 + Math.sin(t * 2.0) * 0.02;
                rBrow.position.y = 0.5 + Math.sin(t * 2.0) * 0.02;
                lBrow.rotation.z = 1.8;
                rBrow.rotation.z = -1.8;
                // 嘴巴张开（呼吸困难）
                if (breathingRate === 'rapid' || breathingRate === 'fast') {
                    mouthGroup.scale.y = 1.2 + Math.sin(t * 3.0) * 0.3;
                } else {
                    mouthGroup.scale.y = 1;
                }
            } else if (facialExpression === 'peaceful') {
                // 安详表情：眉毛放松
                lBrow.position.y = 0.55;
                rBrow.position.y = 0.55;
                lBrow.rotation.z = 1.6;
                rBrow.rotation.z = -1.6;
                mouthGroup.scale.y = 1;
            } else {
                lBrow.position.y = 0.55;
                rBrow.position.y = 0.55;
                lBrow.rotation.z = 1.65;
                rBrow.rotation.z = -1.65;
                mouthGroup.scale.y = 1;
            }

            // 对话情绪驱动的共情动画
            const convMood = hs?.conversationMood;
            const convIntensity = hs?.conversationMoodIntensity ?? 0;
            if (convMood && convIntensity > 0.15) {
                if (convMood === 'happy') {
                    // 微笑：嘴角上扬 + 轻微点头
                    mouthGroup.scale.x = 1.15;
                    mouthGroup.scale.y = Math.max(mouthGroup.scale.y, 0.9);
                    head.rotation.x += Math.sin(t * 1.5) * 0.03 * convIntensity;
                    // 腮红增强
                    blushMat.opacity = Math.max(blushMat.opacity, 0.25 * convIntensity);
                } else if (convMood === 'sad' || convMood === 'lonely') {
                    // 共情关切：眉毛微蹙、嘴巴放平、头部微倾
                    lBrow.position.y = Math.min(lBrow.position.y, 0.52);
                    rBrow.position.y = Math.min(rBrow.position.y, 0.52);
                    lBrow.rotation.z = 1.72;
                    rBrow.rotation.z = -1.72;
                    head.rotation.z = Math.sin(t * 0.3) * 0.04 * convIntensity;
                } else if (convMood === 'anxious') {
                    // 安抚：呼吸放缓、表情柔和
                    body.scale.y = 1.1 + Math.sin(t * 1.2) * 0.012;
                    lBrow.position.y = Math.min(lBrow.position.y, 0.53);
                    rBrow.position.y = Math.min(rBrow.position.y, 0.53);
                } else if (convMood === 'confused') {
                    // 耐心：轻微点头动画
                    head.rotation.x += Math.sin(t * 1.0) * 0.04 * convIntensity;
                }
            }

            // 眨眼动画（根据眼睛状态）
            const eyeState = hs?.eyeState ?? 'normal';
            if (eyeState === 'closed') {
                // 闭眼
                lEye.scale.y = 0.1;
                rEye.scale.y = 0.1;
            } else if (eyeState === 'droopy') {
                // 疲倦昏沉、睁不开眼：眼皮沉重 + 偶发"打瞌睡"垂下 + 勉强撑开
                const cycle = t % 10;  // 约每 10 秒一周期
                const inNodPhase = cycle < 0.8;  // 前 0.8 秒为打瞌睡
                let targetY: number;
                if (inNodPhase) {
                    targetY = 0.14 + (cycle / 0.8) * 0.1;  // 从几乎闭上缓慢回升
                    head.rotation.x += 0.08;  // 打瞌睡时头部前倾
                } else {
                    const wave = Math.sin(t * 0.5) * 0.1;
                    targetY = Math.max(0.2, Math.min(0.38, 0.28 + wave));  // 平时半睁、轻微浮动
                }
                const currentY = lEye.scale.y;
                const lerpSpeed = targetY < currentY ? 0.06 : 0.12;  // 垂下更慢、撑开稍快（勉强感）
                lEye.scale.y = rEye.scale.y = THREE.MathUtils.lerp(currentY, targetY, lerpSpeed);
            } else if (eyeState === 'wide') {
                // 睁大眼（精神、紧张）
                lEye.scale.y = rEye.scale.y = 1.2;
            } else {
                // 正常眨眼
                if (Math.random() > 0.99) {
                    lEye.scale.y = rEye.scale.y = 0.1;
                } else {
                    lEye.scale.y = rEye.scale.y = THREE.MathUtils.lerp(lEye.scale.y, 1.0, 0.2);
                }
            }

            renderer.render(scene, camera);
        };
        animate();

        return () => {
            cancelAnimationFrame(frameId);
            renderer.dispose();
            if (mountRef.current?.contains(renderer.domElement)) {
                mountRef.current.removeChild(renderer.domElement);
            }
        };
    }, [status, size]);

    return <div ref={mountRef} style={{ width: size, height: size }} />;
};

export default AvatarStatus3D;
