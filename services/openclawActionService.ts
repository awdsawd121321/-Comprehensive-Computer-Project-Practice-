import { getOpenClawBridgeBaseUrl } from '../utils/runtimeConfig';

interface BridgeActionOptions {
  elderId?: string;
}

interface NotifyGuardiansOptions extends BridgeActionOptions {
  message: string;
  purpose?: string;
  channel?: string;
  targets?: string[];
  metadata?: Record<string, unknown>;
}

interface ElderActionOptions extends BridgeActionOptions {
  action: string;
  purpose?: string;
  payload?: Record<string, unknown>;
}

const DEFAULT_ELDER_ID = 'elder_demo';

export type OpenClawActionServiceOptions = {
  baseUrl?: string;
  token?: string;
  elderId?: string;
};

export class OpenClawActionService {
  private baseUrl: string;
  private token: string;
  private elderId: string;

  constructor(options?: OpenClawActionServiceOptions) {
    this.baseUrl = (options?.baseUrl ?? getOpenClawBridgeBaseUrl()).replace(/\/$/, '');
    this.token = options?.token ?? import.meta.env.VITE_OPENCLAW_BRIDGE_TOKEN ?? '';
    this.elderId = options?.elderId ?? import.meta.env.VITE_OPENCLAW_ELDER_ID ?? DEFAULT_ELDER_ID;
  }

  isConfigured(): boolean {
    return !!this.baseUrl;
  }

  async notifyGuardians(options: NotifyGuardiansOptions): Promise<any> {
    return this.post('/api/outbound/notify-guardians', {
      elderId: options.elderId || this.elderId,
      message: options.message,
      purpose: options.purpose || 'general',
      channel: options.channel,
      targets: options.targets,
      metadata: options.metadata || {},
    });
  }

  async queueElderAction(options: ElderActionOptions): Promise<any> {
    return this.post('/api/outbound/elder-action', {
      elderId: options.elderId || this.elderId,
      action: options.action,
      purpose: options.purpose || 'family_control',
      payload: options.payload || {},
    });
  }

  private async post(pathname: string, body: Record<string, unknown>): Promise<any> {
    if (!this.baseUrl) {
      throw new Error('OpenClaw bridge is not configured.');
    }

    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { 'x-emobit-bridge-token': this.token } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Bridge POST ${pathname} failed with ${response.status}: ${text}`);
    }

    return response.json();
  }
}

export const openclawActionService = new OpenClawActionService();
