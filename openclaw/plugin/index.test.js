import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import register from './index.js';

function createApi() {
  const tools = [];
  return {
    config: {
      bridgeBaseUrl: 'http://127.0.0.1:4318',
      bridgeToken: 'demo-token',
      defaultElderId: 'elder_demo',
    },
    registerGatewayMethod: vi.fn(),
    registerTool(tool) {
      tools.push(tool);
    },
    tools,
  };
}

describe('openclaw/plugin/index', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async (input, init = {}) => {
      const url = String(input);
      if (url.includes('/api/state')) {
        return new Response(JSON.stringify({
          ok: true,
          state: {
            profile: {
              name: '张爷爷',
            },
            guardianContacts: [
              {
                name: '张明',
                priority: 1,
              },
            ],
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/outbound/elder-action')) {
        return new Response(JSON.stringify({
          ok: true,
          queued: true,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not found', { status: 404 });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('registers emobit_deliver_guardian_message and posts speak_text to the bridge', async () => {
    const api = createApi();
    register(api);

    const tool = api.tools.find((item) => item.name === 'emobit_deliver_guardian_message');
    expect(tool).toBeTruthy();

    await tool.execute('test-tool-call', {
      rawText: '给老人留言：今晚降温了，记得关窗。',
      senderName: 'ou_demo_sender',
      senderId: 'ou_demo_sender',
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);

    const firstCallUrl = String(global.fetch.mock.calls[0][0]);
    expect(firstCallUrl).toContain('/api/state');
    expect(firstCallUrl).toContain('elderId=elder_demo');

    const secondCallUrl = String(global.fetch.mock.calls[1][0]);
    expect(secondCallUrl).toContain('/api/outbound/elder-action');

    const secondCallBody = JSON.parse(String(global.fetch.mock.calls[1][1]?.body || '{}'));
    expect(secondCallBody).toMatchObject({
      elderId: 'elder_demo',
      action: 'speak_text',
      purpose: 'family_message_from_guardian',
      payload: {
        text: '张爷爷，张明给您留言：今晚降温了，记得关窗。',
        originalMessage: '今晚降温了，记得关窗。',
        senderName: '张明',
        senderId: 'ou_demo_sender',
        sourceChannel: 'feishu',
      },
    });
  });
});
