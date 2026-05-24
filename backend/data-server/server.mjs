import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';

import { DataStore, HttpError } from './store.mjs';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const DEFAULT_HOST = process.env.EMOBIT_DATA_SERVER_HOST || '0.0.0.0';
const DEFAULT_PORT = Number(process.env.EMOBIT_DATA_SERVER_PORT || 4328);
const DEFAULT_PUBLIC_BASE_URL = process.env.EMOBIT_DATA_SERVER_PUBLIC_BASE_URL || '';
const DEFAULT_DATA_ROOT = process.env.EMOBIT_DATA_SERVER_ROOT || path.join(process.cwd(), 'backend', 'data-server', 'data');
const DEFAULT_LEGACY_STATE_PATH = process.env.EMOBIT_DATA_SERVER_LEGACY_STATE_PATH || path.join(process.cwd(), 'openclaw', 'bridge', 'data', 'state.json');
const DEFAULT_ELDER_ID = process.env.EMOBIT_ELDER_ID || 'elder_demo';
const MAX_BODY_BYTES = Number(process.env.EMOBIT_DATA_SERVER_MAX_BODY_BYTES || 15 * 1024 * 1024);

export function createDataServer(options = {}) {
    const store = options.store || new DataStore({
        rootDir: options.rootDir || DEFAULT_DATA_ROOT,
        legacyStatePath: options.legacyStatePath || DEFAULT_LEGACY_STATE_PATH,
        publicBaseUrl: options.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL,
        defaultElderId: options.defaultElderId || DEFAULT_ELDER_ID,
    });

    const server = http.createServer(async (req, res) => {
        const startedAt = Date.now();
        let statusCode = 500;
        try {
            setCors(res);
            if (req.method === 'OPTIONS') {
                statusCode = 204;
                res.writeHead(statusCode);
                res.end();
                return;
            }

            const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

            if (req.method === 'GET' && url.pathname === '/healthz') {
                await store.initialize();
                statusCode = 200;
                sendJson(res, statusCode, {
                    ok: true,
                    service: 'emobit-data-server',
                    rootDir: store.rootDir,
                    legacyStatePath: store.legacyStatePath,
                });
                return;
            }

            if (req.method === 'GET' && url.pathname === '/api/elder') {
                await store.initialize();
                const elderId = url.searchParams.get('elderId') || store.defaultElderId;
                const elder = await store.getElder(elderId);
                statusCode = 200;
                sendJson(res, statusCode, { ok: true, elderId, elder, state: elder });
                return;
            }

            if (req.method === 'POST' && url.pathname.startsWith('/api/elder/state/')) {
                await store.initialize();
                const body = await readJson(req);
                const elderId = body.elderId || store.defaultElderId;
                const key = decodeURIComponent(url.pathname.replace('/api/elder/state/', ''));
                const payload = Object.prototype.hasOwnProperty.call(body, 'payload') ? body.payload : body;
                const elder = await store.updateSection(elderId, key, payload);
                statusCode = 200;
                sendJson(res, statusCode, { ok: true, elderId, section: key, elder, state: elder });
                return;
            }

            if (req.method === 'POST' && url.pathname === '/api/elder/events') {
                await store.initialize();
                const body = await readJson(req);
                const elderId = body.elderId || store.defaultElderId;
                const { elder, event } = await store.appendEvent(elderId, body);
                statusCode = 200;
                sendJson(res, statusCode, { ok: true, elderId, event, elder, state: elder });
                return;
            }

            if (req.method === 'POST' && url.pathname === '/api/media/upload') {
                await store.initialize();
                const body = await readJson(req);
                const upload = await store.uploadMedia(body, resolveRequestBaseUrl(req));
                statusCode = 200;
                sendJson(res, statusCode, { ok: true, ...upload });
                return;
            }

            if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
                await store.initialize();
                const mediaId = decodeURIComponent(url.pathname.replace(/^\/media\//, ''));
                const filePath = store.resolveMediaPath(mediaId);
                const data = await fs.readFile(filePath);
                const contentType = guessContentType(filePath);
                statusCode = 200;
                res.writeHead(statusCode, {
                    'Content-Type': contentType,
                    'Cache-Control': 'public, max-age=31536000, immutable',
                });
                res.end(data);
                return;
            }

            throw new HttpError(404, 'Not found.', 'not_found');
        } catch (error) {
            const httpError = normalizeError(error);
            statusCode = httpError.status;
            sendJson(res, statusCode, {
                ok: false,
                error: httpError.message,
                code: httpError.code,
            });
        } finally {
            const durationMs = Date.now() - startedAt;
            const target = req.url || '/';
            console.info(`[EmoBitDataServer] ${req.method} ${target} -> ${statusCode} (${durationMs}ms)`);
        }
    });

    return { server, store };
}

export async function startDataServer(options = {}) {
    const host = options.host ?? DEFAULT_HOST;
    const port = Number(options.port ?? DEFAULT_PORT);
    const { server, store } = createDataServer(options);
    await store.initialize();

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            server.off('error', reject);
            resolve();
        });
    });

    return {
        server,
        store,
        host,
        port: server.address().port,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) reject(error);
                else resolve();
            });
        }),
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    startDataServer().then(({ host, port }) => {
        console.log(`[EmoBitDataServer] Listening on http://${host}:${port}`);
    }).catch((error) => {
        console.error('[EmoBitDataServer] Failed to start:', error);
        process.exitCode = 1;
    });
}

async function readJson(req) {
    const body = await readBody(req);
    if (!body) return {};
    try {
        return JSON.parse(body);
    } catch {
        throw new HttpError(400, 'Request body must be valid JSON.', 'invalid_json');
    }
}

async function readBody(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) {
            throw new HttpError(413, `Request body exceeds ${MAX_BODY_BYTES} bytes.`, 'body_too_large');
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function resolveRequestBaseUrl(req) {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return `${proto}://${req.headers.host || '127.0.0.1'}`;
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify(payload));
}

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function normalizeError(error) {
    if (error instanceof HttpError) return error;
    if (error && error.code === 'ENOENT') {
        return new HttpError(404, 'Resource not found.', 'not_found');
    }
    return new HttpError(500, error instanceof Error ? error.message : String(error), 'internal_error');
}

function guessContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.png':
            return 'image/png';
        case '.gif':
            return 'image/gif';
        case '.webp':
            return 'image/webp';
        case '.mp3':
            return 'audio/mpeg';
        case '.wav':
            return 'audio/wav';
        case '.webm':
            return 'audio/webm';
        case '.mp4':
            return 'video/mp4';
        case '.txt':
            return 'text/plain; charset=utf-8';
        case '.json':
            return 'application/json; charset=utf-8';
        default:
            return 'application/octet-stream';
    }
}
