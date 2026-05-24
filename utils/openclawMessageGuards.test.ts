import { describe, expect, it } from 'vitest';
import { isGuardianOnlyBridgeMessage } from './openclawMessageGuards';

describe('utils/openclawMessageGuards', () => {
  describe('isGuardianOnlyBridgeMessage', () => {
    it('returns false for empty inputs', () => {
      expect(isGuardianOnlyBridgeMessage(undefined)).toBe(false);
      expect(isGuardianOnlyBridgeMessage(null)).toBe(false);
      expect(isGuardianOnlyBridgeMessage({})).toBe(false);
      expect(isGuardianOnlyBridgeMessage({ text: '', purpose: '' })).toBe(false);
    });

    it('returns true for guardian_* purposes', () => {
      expect(isGuardianOnlyBridgeMessage({ purpose: 'guardian_message_via_elder' })).toBe(true);
      expect(isGuardianOnlyBridgeMessage({ purpose: 'guardian_alert' })).toBe(true);
      expect(isGuardianOnlyBridgeMessage({ purpose: 'guardian_follow_up' })).toBe(true);
    });

    it('returns true for daily_report purpose', () => {
      expect(isGuardianOnlyBridgeMessage({ purpose: 'daily_report' })).toBe(true);
    });

    it('returns true when text contains guardian hints', () => {
      expect(isGuardianOnlyBridgeMessage({ text: '【发送给家属】请注意今晚安排家属陪伴' })).toBe(true);
      expect(isGuardianOnlyBridgeMessage({ text: '建议家属视频通话：老人情绪波动' })).toBe(true);
    });
  });
});

