/**
 * dataClient.mjs — Bridge → Data Backend HTTP 通信层
 *
 * 封装对 Data Backend 的所有读写操作，使 Bridge 的路由处理函数不再直接碰
 * 本地 state.json，而是通过 HTTP 调用 Data Backend 完成持久化。
 *
 * 环境变量：
 *   EMOBIT_DATA_BACKEND_URL  — Data Backend 基地址（默认 http://127.0.0.1:4328）
 */

const DEFAULT_TIMEOUT_MS = 10_000;

export class DataClientError extends Error {
    constructor(status, message, code = 'data_client_error', originalMessage = '') {
        super(message);
        this.name = 'DataClientError';
        /** @type {number} */
        this.status = status;
        /** @type {string} */
        this.code = code;
        /** @type {string} */
        this.originalMessage = originalMessage || message;
    }
}

export class DataClient {
    /**
     * @param {object} options
     * @param {string} [options.baseUrl]
     * @param {string} [options.defaultElderId]
     * @param {number} [options.timeoutMs]
     */
    constructor(options = {}) {
        this.baseUrl = (options.baseUrl || process.env.EMOBIT_DATA_BACKEND_URL || 'http://127.0.0.1:4328').replace(/\/$/, '');
        this.defaultElderId = options.defaultElderId || process.env.EMOBIT_ELDER_ID || 'elder_demo';
        this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    }

    // ─── Read ───────────────────────────────────────────────────────────

    /**
     * GET /api/elder?elderId=...
     * @param {string} [elderId]
     * @returns {Promise<object>} — the elder object (ensured shape from backend)
     */
    async getElder(elderId) {
        const id = elderId || this.defaultElderId;
        const url = `${this.baseUrl}/api/elder?elderId=${encodeURIComponent(id)}`;
        const json = await this.#fetch(url, { method: 'GET' });
        return json.elder || json.state || {};
    }

    // ─── Write ──────────────────────────────────────────────────────────

    /**
     * POST /api/elder/state/:key
     * @param {string} elderId
     * @param {string} key     — state section key (e.g. 'health', 'care-plan')
     * @param {*}      payload
     * @returns {Promise<object>} — updated elder object
     */
    async updateSection(elderId, key, payload) {
        const id = elderId || this.defaultElderId;
        const url = `${this.baseUrl}/api/elder/state/${encodeURIComponent(key)}`;
        const json = await this.#fetch(url, {
            method: 'POST',
            body: JSON.stringify({ elderId: id, payload }),
        });
        return json.elder || json.state || {};
    }

    /**
     * POST /api/elder/events
     * @param {string} elderId
     * @param {object} event   — { type, severity?, payload? }
     * @returns {Promise<{ elder: object, event: object }>}
     */
    async appendEvent(elderId, event) {
        const id = elderId || this.defaultElderId;
        const url = `${this.baseUrl}/api/elder/events`;
        const json = await this.#fetch(url, {
            method: 'POST',
            body: JSON.stringify({ elderId: id, ...event }),
        });
        return {
            elder: json.elder || json.state || {},
            event: json.event || {},
        };
    }

    // ─── Health ─────────────────────────────────────────────────────────

    /**
     * GET /healthz — 检查 Data Backend 连通性
     * @returns {Promise<{ ok: boolean }>}
     */
    async healthCheck() {
        try {
            const json = await this.#fetch(`${this.baseUrl}/healthz`, { method: 'GET' });
            return { ok: !!json.ok, detail: json };
        } catch (error) {
            return { ok: false, error: error.message };
        }
    }

    // ─── Internal ───────────────────────────────────────────────────────

    /**
     * @param {string} url
     * @param {RequestInit} init
     * @returns {Promise<object>}
     */
    async #fetch(url, init) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const headers = {
                ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            };
            const res = await fetch(url, {
                ...init,
                headers,
                signal: controller.signal,
            });

            const text = await res.text();
            let json;
            try {
                json = text ? JSON.parse(text) : {};
            } catch {
                json = {};
            }

            if (!res.ok) {
                const backendMessage = json.error || json.message || text || 'Unknown Data Backend error';
                const backendCode = json.code || 'backend_error';

                // 规范化映射：4xx → 400, 5xx → 500
                const mappedStatus = res.status >= 400 && res.status < 500 ? 400 : 500;

                console.error(
                    `[DataClient] ${init.method} ${url} → ${res.status}: ${backendMessage} (code: ${backendCode})`,
                );

                throw new DataClientError(
                    mappedStatus,
                    `Data Backend error: ${backendMessage}`,
                    backendCode,
                    backendMessage,
                );
            }

            return json;
        } catch (error) {
            if (error instanceof DataClientError) {
                throw error;
            }
            if (error.name === 'AbortError') {
                console.error(`[DataClient] ${init.method} ${url} → timeout (${this.timeoutMs}ms)`);
                throw new DataClientError(
                    500,
                    `Data Backend request timed out after ${this.timeoutMs}ms`,
                    'timeout',
                );
            }
            // 网络/连接错误
            console.error(`[DataClient] ${init.method} ${url} → network error: ${error.message}`);
            throw new DataClientError(
                500,
                `Data Backend unreachable: ${error.message}`,
                'network_error',
                error.message,
            );
        } finally {
            clearTimeout(timer);
        }
    }
}
