// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DataStore } from '../../backend/data-server/store.mjs';
import { createDataServer } from '../../backend/data-server/server.mjs';
import { DataClient } from '../../openclaw/bridge/dataClient.mjs';

/**
 * Bridge ↔ Data Backend 集成测试
 *
 * 测试目标：Bridge 通过 dataClient 写入 → Data Backend 回读 →
 *           确保数据完整且可用于 context 聚合。
 *
 * 运行方式：in-process 启动一个真实 Data Backend HTTP 服务，
 *           然后 dataClient 通过 HTTP 进行读写。
 */
describe('system/bridge-data-backend integration', () => {
    let tempRoot;
    let dataServerHandle;
    let client;

    beforeAll(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'emobit-bridge-integration-'));

        const { server, store } = createDataServer({
            rootDir: path.join(tempRoot, 'data'),
            legacyStatePath: path.join(tempRoot, 'missing-legacy.json'),
        });
        await store.initialize();

        // 启动在随机端口
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                server.off('error', reject);
                resolve();
            });
        });

        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        dataServerHandle = {
            server,
            store,
            port,
            close: () => new Promise<void>((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            }),
        };

        client = new DataClient({
            baseUrl: `http://127.0.0.1:${port}`,
            defaultElderId: 'elder_test',
            timeoutMs: 5000,
        });
    });

    afterAll(async () => {
        if (dataServerHandle) {
            await dataServerHandle.close();
        }
        if (tempRoot) {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });

    // ─── 读写回路 ──────────────────────────────────────────────────────

    it('写入 state → 回读验证 → context 聚合产出正确字段', async () => {
        // 1. 写入 health
        await client.updateSection('elder_test', 'health', {
            metrics: { heartRate: 78, bloodOxygen: 97 },
            alerts: [{ id: 'alert-1', level: 'warn', message: '心率偏低' }],
        });

        // 2. 写入 carePlan
        await client.updateSection('elder_test', 'care-plan', {
            items: [
                { id: 'care-1', title: '散步', enabled: true, time: '08:00' },
                { id: 'care-2', title: '吃药', enabled: true, time: '12:00' },
            ],
            events: [],
            trend: { adherence: 85 },
        });

        // 3. 写入 sundowning snapshot
        await client.updateSection('elder_test', 'sundowning', {
            snapshot: { riskScore: 65, riskLevel: 'medium', timeOfDay: 'evening' },
        });

        // 4. 回读并验证
        const elder = await client.getElder('elder_test');

        expect(elder.health.metrics).toMatchObject({ heartRate: 78 });
        expect(elder.health.alerts).toHaveLength(1);
        expect(elder.carePlan.items).toHaveLength(2);
        expect(elder.carePlan.trend).toMatchObject({ adherence: 85 });
        expect(elder.sundowning.snapshot).toMatchObject({ riskScore: 65, riskLevel: 'medium' });

        // 5. 验证默认空结构字段存在
        expect(elder.faces).toEqual([]);
        expect(elder.timeAlbum).toEqual([]);
        expect(elder.uiCommands).toEqual([]);
        expect(elder.outbound).toEqual([]);
        expect(elder.wandering).toMatchObject({ state: null, events: [] });
        expect(elder.locationAutomation).toMatchObject({ state: null, events: [] });
    });

    // ─── 事件写入回读 ──────────────────────────────────────────────────

    it('appendEvent 写入后能通过 getElder 回读', async () => {
        const { event } = await client.appendEvent('elder_test', {
            type: 'simulation.fall',
            severity: 'critical',
            payload: { gForce: 3.4, source: 'test' },
        });

        expect(event.type).toBe('simulation.fall');

        const elder = await client.getElder('elder_test');
        const found = elder.events.find((e) => e.type === 'simulation.fall');
        expect(found).toBeTruthy();
        expect(found.payload).toMatchObject({ gForce: 3.4 });
    });

    // ─── uiCommands / outbound 集合操作 ────────────────────────────────

    it('uiCommands prepend 写入后可正确回读', async () => {
        await client.updateSection('elder_test', 'uiCommands', {
            op: 'prepend',
            item: {
                type: 'elder.message',
                timestamp: Date.now(),
                payload: { message: '测试消息', purpose: 'test' },
            },
        });

        const elder = await client.getElder('elder_test');
        const cmd = elder.uiCommands.find((c) => c.type === 'elder.message');
        expect(cmd).toBeTruthy();
        expect(cmd.payload.message).toBe('测试消息');
    });

    it('outboundEvents prepend 写入后双向同步到 outbound', async () => {
        await client.updateSection('elder_test', 'outboundEvents', {
            op: 'prepend',
            item: {
                audience: 'guardians',
                channel: 'feishu',
                targets: ['user:test'],
                message: '测试通知',
                purpose: 'test_outbound',
                metadata: {},
                results: [],
            },
        });

        const elder = await client.getElder('elder_test');
        const ob = elder.outboundEvents.find((e) => e.purpose === 'test_outbound');
        expect(ob).toBeTruthy();
        expect(ob.audience).toBe('guardians');
        // outbound 和 outboundEvents 应保持同步
        expect(elder.outbound.length).toBe(elder.outboundEvents.length);
    });

    // ─── 并发写入不丢事件 ──────────────────────────────────────────────

    it('并发发送 10 条事件全部持久化，不丢失', async () => {
        const concurrencyElderId = 'elder_concurrent';
        const eventCount = 10;

        await Promise.all(
            Array.from({ length: eventCount }, (_, i) =>
                client.appendEvent(concurrencyElderId, {
                    type: `concurrent.event_${i}`,
                    severity: 'info',
                    payload: { index: i },
                }),
            ),
        );

        const elder = await client.getElder(concurrencyElderId);
        expect(elder.events.length).toBe(eventCount);

        const types = new Set(elder.events.map((e) => e.type));
        for (let i = 0; i < eventCount; i++) {
            expect(types.has(`concurrent.event_${i}`)).toBe(true);
        }
    });

    it('并发更新不同 section 不会互相覆盖', async () => {
        const concurrencyElderId = 'elder_section_concurrent';

        await Promise.all([
            client.updateSection(concurrencyElderId, 'health', {
                metrics: { heartRate: 90 },
                alerts: [],
            }),
            client.updateSection(concurrencyElderId, 'care-plan', {
                items: [{ id: 'x', title: '测试', enabled: true, time: '09:00' }],
                events: [],
                trend: null,
            }),
            client.updateSection(concurrencyElderId, 'sundowning', {
                snapshot: { riskScore: 30, riskLevel: 'low' },
            }),
            client.appendEvent(concurrencyElderId, {
                type: 'face.known',
                severity: 'info',
                payload: { name: '儿子' },
            }),
        ]);

        const elder = await client.getElder(concurrencyElderId);
        expect(elder.health.metrics).toMatchObject({ heartRate: 90 });
        expect(elder.carePlan.items).toHaveLength(1);
        expect(elder.sundowning.snapshot).toMatchObject({ riskScore: 30 });
        expect(elder.events.length).toBe(1);
        expect(elder.faceEvents.length).toBe(1);
    });

    // ─── 错误映射 ──────────────────────────────────────────────────────

    it('发送非法 section 返回 400 + 错误信息', async () => {
        try {
            await client.updateSection('elder_test', 'nonexistent_section', { foo: 'bar' });
            expect.unreachable('Should have thrown');
        } catch (error) {
            expect(error.status).toBe(400);
            expect(error.message).toContain('Unsupported state section');
        }
    });

    // ─── healthCheck ────────────────────────────────────────────────────

    it('healthCheck 返回 ok: true', async () => {
        const health = await client.healthCheck();
        expect(health.ok).toBe(true);
    });

    it('healthCheck 对不可达地址返回 ok: false', async () => {
        const badClient = new DataClient({
            baseUrl: 'http://127.0.0.1:1',
            timeoutMs: 1000,
        });
        const health = await badClient.healthCheck();
        expect(health.ok).toBe(false);
    });

    // ─── elder 完整结构验证 ─────────────────────────────────────────────

    it('新 elder 返回完整默认结构，包含所有约定字段', async () => {
        const elder = await client.getElder('elder_fresh_' + Date.now());

        const requiredTopLevelKeys = [
            'profile', 'health', 'cognitive', 'medications',
            'carePlan', 'wandering', 'locationAutomation',
            'sundowning', 'events', 'outbound', 'uiCommands',
            'faces', 'timeAlbum',
        ];

        for (const key of requiredTopLevelKeys) {
            expect(elder).toHaveProperty(key);
        }

        // 嵌套结构验证
        expect(elder.health).toHaveProperty('metrics');
        expect(elder.health).toHaveProperty('alerts');
        expect(elder.cognitive).toHaveProperty('conversations');
        expect(elder.cognitive).toHaveProperty('assessments');
        expect(elder.carePlan).toHaveProperty('items');
        expect(elder.carePlan).toHaveProperty('events');
        expect(elder.wandering).toHaveProperty('state');
        expect(elder.wandering).toHaveProperty('events');
        expect(elder.sundowning).toHaveProperty('snapshot');
        expect(elder.sundowning).toHaveProperty('alerts');
        expect(elder.sundowning).toHaveProperty('interventions');
    });
});
