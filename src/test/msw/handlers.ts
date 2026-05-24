import { http, HttpResponse } from 'msw';

export type BridgeRequestLogItem = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
};

export const bridgeRequestLog: BridgeRequestLogItem[] = [];

export function resetBridgeRequestLog(): void {
  bridgeRequestLog.splice(0, bridgeRequestLog.length);
}

export const bridgeHandlers = [
  http.post('http://127.0.0.1:4318/api/events', async ({ request }) => {
    const body = await request.json().catch(() => undefined);
    bridgeRequestLog.push({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    });
    return HttpResponse.json({ ok: true });
  }),

  http.post('http://127.0.0.1:4318/api/state/:key', async ({ request }) => {
    const body = await request.json().catch(() => undefined);
    bridgeRequestLog.push({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    });
    return HttpResponse.json({ ok: true });
  }),

  http.post('http://127.0.0.1:4318/api/outbound/notify-guardians', async ({ request }) => {
    const body = await request.json().catch(() => undefined);
    bridgeRequestLog.push({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    });
    return HttpResponse.json({ ok: true, channel: 'feishu', targets: [], results: [] });
  }),

  http.post('http://127.0.0.1:4318/api/outbound/elder-action', async ({ request }) => {
    const body = await request.json().catch(() => undefined);
    bridgeRequestLog.push({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    });
    return HttpResponse.json({ ok: true });
  }),
];

