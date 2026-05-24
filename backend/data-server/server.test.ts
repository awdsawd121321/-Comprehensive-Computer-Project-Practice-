import { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataStore } from './store.mjs';
import { createDataServer } from './server.mjs';

describe('backend/data-server', () => {
    let tempRoot: string;

    beforeEach(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'emobit-data-server-'));
    });

    afterEach(async () => {
        if (tempRoot) {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('returns a normalized elder shape and can bootstrap from legacy state', async () => {
        const legacyStatePath = path.join(tempRoot, 'legacy-state.json');
        await fs.writeFile(legacyStatePath, JSON.stringify({
            elders: {
                elder_demo: {
                    profile: { name: '张爷爷' },
                    health: { metrics: { heartRate: 72 } },
                },
            },
        }), 'utf8');

        const store = new DataStore({
            rootDir: path.join(tempRoot, 'data'),
            legacyStatePath,
        });

        await store.initialize();
        const elder = await store.getElder('elder_demo');

        expect(elder.profile).toMatchObject({ name: '张爷爷' });
        expect(elder.health.metrics).toMatchObject({ heartRate: 72 });
        expect(elder.faces).toEqual([]);
        expect(elder.timeAlbum).toEqual([]);
        expect(elder.uiCommands).toEqual([]);
        expect(elder.outbound).toEqual([]);
    });

    it('serializes same-elder concurrent writes without losing sections or events', async () => {
        const store = new DataStore({
            rootDir: path.join(tempRoot, 'data'),
            legacyStatePath: path.join(tempRoot, 'missing-legacy.json'),
        });

        await store.initialize();

        await Promise.all([
            store.updateSection('elder_demo', 'health', {
                metrics: { heartRate: 81 },
                alerts: [{ id: 'alert-1', level: 'warn' }],
            }),
            store.updateSection('elder_demo', 'care-plan', {
                items: [{ id: 'care-1', title: '散步', enabled: true, time: '08:00' }],
                events: [],
                trend: { adherence: 90 },
            }),
            store.appendEvent('elder_demo', {
                type: 'simulation.fall',
                severity: 'critical',
                payload: { gForce: 3.4 },
            }),
            store.appendEvent('elder_demo', {
                type: 'face.known',
                severity: 'info',
                payload: { id: 'face-1', name: '儿子' },
            }),
        ]);

        const elder = await store.getElder('elder_demo');
        const eventLog = await store.readEventLog('elder_demo');

        expect(elder.health.metrics).toMatchObject({ heartRate: 81 });
        expect(elder.carePlan.items).toHaveLength(1);
        expect(elder.events).toHaveLength(2);
        expect(elder.faceEvents[0]).toMatchObject({ id: 'face-1', name: '儿子', eventType: 'face.known' });
        expect(eventLog).toHaveLength(2);
        expect(new Set(eventLog.map((event) => event.type))).toEqual(new Set(['simulation.fall', 'face.known']));
    });

    it('supports append/upsert collection operations for faces without concurrent lost writes', async () => {
        const store = new DataStore({
            rootDir: path.join(tempRoot, 'data'),
            legacyStatePath: path.join(tempRoot, 'missing-legacy.json'),
        });

        await store.initialize();

        await Promise.all(
            Array.from({ length: 12 }, (_, index) =>
                store.updateSection('elder_demo', 'faces', {
                    op: 'append',
                    item: {
                        id: `face-${index}`,
                        name: `家人${index}`,
                        relation: '家人',
                        imageUrl: `/media/elder_demo/faces/face-${index}.png`,
                        createdAt: Date.now() + index,
                    },
                }),
            ),
        );

        await store.updateSection('elder_demo', 'faces', {
            op: 'upsertById',
            item: {
                id: 'face-3',
                name: '家人3-更新',
                relation: '家人',
                imageUrl: '/media/elder_demo/faces/face-3-updated.png',
                createdAt: Date.now(),
            },
        });

        const elder = await store.getElder('elder_demo');

        expect(elder.faces).toHaveLength(12);
        expect(elder.faces.find((item) => item.id === 'face-3')).toMatchObject({
            name: '家人3-更新',
            imageUrl: '/media/elder_demo/faces/face-3-updated.png',
        });
    });

    it('serves elder APIs and uploaded media over the request handler', async () => {
        const { server } = createDataServer({
            rootDir: path.join(tempRoot, 'data'),
            legacyStatePath: path.join(tempRoot, 'missing-legacy.json'),
        });
        const handler = server.listeners('request')[0];

        const healthzResponse = await dispatch(handler, {
            method: 'GET',
            url: '/healthz',
        });
        expect(healthzResponse.statusCode).toBe(200);
        expect(healthzResponse.json).toMatchObject({
            ok: true,
            service: 'emobit-data-server',
        });

        const elderResponse = await dispatch(handler, {
            method: 'GET',
            url: '/api/elder?elderId=elder_demo',
        });
        expect(elderResponse.statusCode).toBe(200);
        expect(elderResponse.json.elder.faces).toEqual([]);

        const stateResponse = await dispatch(handler, {
            method: 'POST',
            url: '/api/elder/state/timeAlbum',
            body: {
                elderId: 'elder_demo',
                payload: {
                    op: 'append',
                    item: {
                        id: 'album-1',
                        url: '/media/demo.png',
                        date: '2026-03-23',
                        location: '北京',
                        story: '一家人的回忆',
                        tags: ['家庭'],
                    },
                },
            },
        });
        expect(stateResponse.statusCode).toBe(200);

        const eventResponse = await dispatch(handler, {
            method: 'POST',
            url: '/api/elder/events',
            body: {
                elderId: 'elder_demo',
                type: 'cognitive.report',
                severity: 'info',
                payload: {
                    id: 'report-1',
                    summary: '今天状态稳定',
                },
            },
        });
        expect(eventResponse.statusCode).toBe(200);
        expect(eventResponse.json.event.type).toBe('cognitive.report');

        const uploadResponse = await dispatch(handler, {
            method: 'POST',
            url: '/api/media/upload',
            body: {
                elderId: 'elder_demo',
                type: 'faces',
                filename: 'face.png',
                mimeType: 'image/png',
                contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ysAAAAASUVORK5CYII=',
            },
        });
        expect(uploadResponse.statusCode).toBe(200);
        expect(uploadResponse.json.url).toContain('/media/elder_demo/faces/');

        const mediaPath = new URL(uploadResponse.json.url).pathname;
        const mediaResponse = await dispatch(handler, {
            method: 'GET',
            url: mediaPath,
        });
        expect(mediaResponse.statusCode).toBe(200);
        expect(mediaResponse.headers['content-type']).toBe('image/png');
        expect(mediaResponse.body.length).toBeGreaterThan(0);

        const updatedElderResponse = await dispatch(handler, {
            method: 'GET',
            url: '/api/elder?elderId=elder_demo',
        });
        expect(updatedElderResponse.json.elder.timeAlbum).toHaveLength(1);
        expect(updatedElderResponse.json.elder.cognitive.reports).toHaveLength(1);
    });

    it('returns 400 for unsupported sections and invalid uploads', async () => {
        const { server } = createDataServer({
            rootDir: path.join(tempRoot, 'data'),
            legacyStatePath: path.join(tempRoot, 'missing-legacy.json'),
        });
        const handler = server.listeners('request')[0];

        const badSectionResponse = await dispatch(handler, {
            method: 'POST',
            url: '/api/elder/state/unknown',
            body: {
                elderId: 'elder_demo',
                payload: {},
            },
        });
        expect(badSectionResponse.statusCode).toBe(400);
        expect(badSectionResponse.json.error).toContain('Unsupported state section');

        const badUploadResponse = await dispatch(handler, {
            method: 'POST',
            url: '/api/media/upload',
            body: {
                elderId: 'elder_demo',
                type: 'faces',
                filename: 'broken.png',
                mimeType: 'image/png',
                contentBase64: 'not-valid-base64',
            },
        });
        expect(badUploadResponse.statusCode).toBe(400);
        expect(badUploadResponse.json.code).toBe('invalid_content');
    });
});

async function dispatch(handler: any, options: {
    method: string;
    url: string;
    body?: unknown;
    headers?: Record<string, string>;
}) {
    const bodyText = options.body === undefined ? '' : JSON.stringify(options.body);
    const req = Readable.from(bodyText ? [Buffer.from(bodyText)] : []);
    Object.assign(req, {
        method: options.method,
        url: options.url,
        headers: {
            host: '127.0.0.1:4328',
            ...(bodyText ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(bodyText)) } : {}),
            ...(options.headers || {}),
        },
    });

    let resolved = false;
    const headers = {} as Record<string, string>;
    const chunks: Buffer[] = [];

    const response = {
        statusCode: 200,
        setHeader(name: string, value: string) {
            headers[name.toLowerCase()] = String(value);
        },
        writeHead(statusCode: number, extraHeaders?: Record<string, string>) {
            this.statusCode = statusCode;
            for (const [name, value] of Object.entries(extraHeaders || {})) {
                headers[name.toLowerCase()] = String(value);
            }
            return this;
        },
        end(chunk?: Buffer | string) {
            if (chunk) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            resolved = true;
        },
    };

    await handler(req, response);
    if (!resolved) {
        response.end();
    }

    const body = Buffer.concat(chunks);
    const contentType = headers['content-type'] || '';
    return {
        statusCode: response.statusCode,
        headers,
        body,
        json: contentType.includes('application/json') ? JSON.parse(body.toString('utf8') || '{}') : null,
    };
}
