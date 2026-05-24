function normalizeBaseUrl(input: string): string {
  return String(input || '').trim().replace(/\/$/, '');
}

/**
 * OpenClaw Bridge base URL.
 *
 * - Desktop dev (Node bridge): http://127.0.0.1:4318
 * - Android embedded bridge:  http://127.0.0.1:4318 (device-local)
 *
 * Can be overridden with VITE_OPENCLAW_BRIDGE_URL.
 */
export function getOpenClawBridgeBaseUrl(): string {
  const fromEnv = normalizeBaseUrl((import.meta as any).env?.VITE_OPENCLAW_BRIDGE_URL || '');
  return fromEnv || 'http://127.0.0.1:4318';
}

/**
 * Data Backend base URL (for /api/elder/*, /media/*).
 * Can be overridden with VITE_DATA_BACKEND_URL.
 */
export function getDataBackendBaseUrl(): string {
  const fromEnv = normalizeBaseUrl((import.meta as any).env?.VITE_DATA_BACKEND_URL || '');
  return fromEnv || 'http://127.0.0.1:4328';
}

