import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
    applyStateUpdate,
    defaultElderState,
    ensureElderShape,
    ingestEvent,
    normalizeEvent,
} from './state.mjs';

const DEFAULT_ELDER_ID = 'elder_demo';

export class HttpError extends Error {
    constructor(status, message, code = 'bad_request') {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        this.code = code;
    }
}

export class DataStore {
    constructor(options = {}) {
        this.rootDir = options.rootDir || path.join(process.cwd(), 'backend', 'data-server', 'data');
        this.eldersDir = options.eldersDir || path.join(this.rootDir, 'elders');
        this.eventsDir = options.eventsDir || path.join(this.rootDir, 'events');
        this.uploadsDir = options.uploadsDir || path.join(this.rootDir, 'uploads');
        this.legacyStatePath = options.legacyStatePath || path.join(process.cwd(), 'openclaw', 'bridge', 'data', 'state.json');
        this.defaultElderId = options.defaultElderId || DEFAULT_ELDER_ID;
        this.publicBaseUrl = options.publicBaseUrl || '';
        this.writeQueues = new Map();
    }

    async initialize() {
        await fs.mkdir(this.eldersDir, { recursive: true });
        await fs.mkdir(this.eventsDir, { recursive: true });
        await fs.mkdir(this.uploadsDir, { recursive: true });
    }

    async getElder(elderId = this.defaultElderId) {
        const normalizedElderId = normalizeElderId(elderId);
        const elder = await this.#readOrBootstrapElder(normalizedElderId);
        return ensureElderShape(elder);
    }

    async updateSection(elderId, key, payload) {
        const normalizedElderId = normalizeElderId(elderId);
        return this.#withWriteQueue(normalizedElderId, async () => {
            const elder = await this.#readOrBootstrapElder(normalizedElderId);
            try {
                applyStateUpdate(elder, key, payload);
            } catch (error) {
                if (error instanceof HttpError) {
                    throw error;
                }
                throw new HttpError(400, error instanceof Error ? error.message : String(error), 'invalid_section');
            }
            elder.updatedAt = new Date().toISOString();
            await this.#writeElder(normalizedElderId, elder);
            return ensureElderShape(elder);
        });
    }

    async appendEvent(elderId, input) {
        const normalizedElderId = normalizeElderId(elderId);
        return this.#withWriteQueue(normalizedElderId, async () => {
            const elder = await this.#readOrBootstrapElder(normalizedElderId);
            const event = ingestEvent(elder, input);
            elder.updatedAt = new Date().toISOString();
            await this.#appendEventLog(normalizedElderId, event);
            await this.#writeElder(normalizedElderId, elder);
            return {
                elder: ensureElderShape(elder),
                event,
            };
        });
    }

    async uploadMedia(input, requestBaseUrl) {
        const elderId = normalizeElderId(input?.elderId || this.defaultElderId);
        const mediaType = normalizeMediaType(input?.type);
        const filename = String(input?.filename || '').trim();
        const mimeType = String(input?.mimeType || '').trim().toLowerCase();
        const contentBase64 = String(input?.contentBase64 || '').trim();

        if (!filename) {
            throw new HttpError(400, 'Media filename is required.', 'invalid_filename');
        }
        if (!mimeType) {
            throw new HttpError(400, 'Media mimeType is required.', 'invalid_mime_type');
        }
        if (!contentBase64) {
            throw new HttpError(400, 'Media contentBase64 is required.', 'invalid_content');
        }

        const buffer = decodeBase64Content(contentBase64);
        const extension = resolveExtension(filename, mimeType);
        const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20);
        const storedName = `${hash}${extension}`;
        const mediaId = `${elderId}/${mediaType}/${storedName}`;
        const filePath = path.join(this.uploadsDir, elderId, mediaType, storedName);

        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, buffer);

        const publicBaseUrl = String(this.publicBaseUrl || requestBaseUrl || '').replace(/\/$/, '');
        const url = publicBaseUrl ? `${publicBaseUrl}/media/${mediaId}` : `/media/${mediaId}`;

        return {
            elderId,
            mediaId,
            url,
            mimeType,
            size: buffer.byteLength,
        };
    }

    resolveMediaPath(mediaId) {
        const normalized = normalizeMediaId(mediaId);
        return path.join(this.uploadsDir, normalized);
    }

    async readEventLog(elderId) {
        const filePath = this.#getEventLogPath(normalizeElderId(elderId));
        try {
            const content = await fs.readFile(filePath, 'utf8');
            return content
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line));
        } catch (error) {
            if (error && error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    async #withWriteQueue(elderId, task) {
        const previous = this.writeQueues.get(elderId) || Promise.resolve();
        const queued = previous.catch(() => undefined).then(task);
        this.writeQueues.set(elderId, queued);
        try {
            return await queued;
        } finally {
            if (this.writeQueues.get(elderId) === queued) {
                this.writeQueues.delete(elderId);
            }
        }
    }

    async #readOrBootstrapElder(elderId) {
        const elderPath = this.#getElderPath(elderId);
        try {
            const content = await fs.readFile(elderPath, 'utf8');
            return ensureElderShape(JSON.parse(content));
        } catch (error) {
            if (!error || error.code !== 'ENOENT') {
                throw error;
            }
        }

        const bootstrapped = await this.#loadLegacyElder(elderId) || defaultElderState();
        await this.#writeElder(elderId, bootstrapped);
        return ensureElderShape(bootstrapped);
    }

    async #loadLegacyElder(elderId) {
        try {
            const raw = await fs.readFile(this.legacyStatePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed?.elders?.[elderId]) {
                return ensureElderShape(parsed.elders[elderId]);
            }
            return null;
        } catch (error) {
            if (error && error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    async #writeElder(elderId, elder) {
        const elderPath = this.#getElderPath(elderId);
        const tmpPath = `${elderPath}.${process.pid}.${Date.now()}.tmp`;
        const serialized = `${JSON.stringify(ensureElderShape(elder), null, 2)}\n`;
        await fs.mkdir(path.dirname(elderPath), { recursive: true });
        await fs.writeFile(tmpPath, serialized, 'utf8');
        await fs.rename(tmpPath, elderPath);
    }

    async #appendEventLog(elderId, event) {
        const filePath = this.#getEventLogPath(elderId);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const line = `${JSON.stringify(normalizeEvent(event))}\n`;
        await fs.appendFile(filePath, line, 'utf8');
    }

    #getElderPath(elderId) {
        return path.join(this.eldersDir, `${elderId}.json`);
    }

    #getEventLogPath(elderId) {
        return path.join(this.eventsDir, `${elderId}.ndjson`);
    }
}

function normalizeElderId(value) {
    const elderId = String(value || '').trim();
    if (!elderId) {
        throw new HttpError(400, 'elderId is required.', 'invalid_elder_id');
    }
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(elderId)) {
        throw new HttpError(400, 'elderId must match /^[a-zA-Z0-9_-]{1,120}$/.', 'invalid_elder_id');
    }
    return elderId;
}

function normalizeMediaType(value) {
    const mediaType = String(value || '').trim();
    if (!mediaType) {
        throw new HttpError(400, 'Media type is required.', 'invalid_media_type');
    }
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(mediaType)) {
        throw new HttpError(400, 'Media type must match /^[a-zA-Z0-9_-]{1,80}$/.', 'invalid_media_type');
    }
    return mediaType;
}

function decodeBase64Content(value) {
    const normalized = value.includes(',')
        ? value.slice(value.lastIndexOf(',') + 1)
        : value;
    const cleaned = normalized.replace(/\s+/g, '');
    if (!cleaned || cleaned.length % 4 === 1 || !/^[a-zA-Z0-9+/=]+$/.test(cleaned)) {
        throw new HttpError(400, 'contentBase64 must be valid base64 data.', 'invalid_content');
    }
    try {
        return Buffer.from(cleaned, 'base64');
    } catch {
        throw new HttpError(400, 'contentBase64 must be valid base64 data.', 'invalid_content');
    }
}

function resolveExtension(filename, mimeType) {
    const safeExt = path.extname(filename).trim().toLowerCase();
    if (safeExt && /^[.][a-z0-9]{1,10}$/.test(safeExt)) {
        return safeExt;
    }

    const byMimeType = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'audio/mpeg': '.mp3',
        'audio/wav': '.wav',
        'audio/webm': '.webm',
        'video/mp4': '.mp4',
        'text/plain': '.txt',
        'application/json': '.json',
    };
    return byMimeType[mimeType] || '.bin';
}

function normalizeMediaId(mediaId) {
    const normalized = String(mediaId || '').trim().replace(/^\/+/, '');
    if (!normalized) {
        throw new HttpError(404, 'Media not found.', 'media_not_found');
    }
    if (normalized.includes('..')) {
        throw new HttpError(404, 'Media not found.', 'media_not_found');
    }
    return normalized;
}
