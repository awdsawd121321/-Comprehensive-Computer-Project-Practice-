import { describe, expect, it } from 'vitest';
import { OpenClawActionService } from './openclawActionService';

describe('services/openclawActionService', () => {
  it('throws when bridge is not configured', async () => {
    const svc = new OpenClawActionService({ baseUrl: '' });
    await expect(svc.notifyGuardians({ message: 'hi' })).rejects.toThrow('OpenClaw bridge is not configured.');
  });
});

