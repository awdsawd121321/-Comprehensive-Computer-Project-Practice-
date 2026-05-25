import { describe, expect, it } from 'vitest';

import {
  buildGuardianMessageDelivery,
  buildGuardianSpeechText,
  extractGuardianMessageContent,
  isDirectElderSpeech,
} from './guardianMessageControl.js';

describe('openclaw/plugin/guardianMessageControl', () => {
  it('extracts guardian message content from supported Feishu command prefixes', () => {
    expect(extractGuardianMessageContent({ rawText: '给老人留言：今晚降温了，记得关窗。' })).toBe('今晚降温了，记得关窗。');
    expect(extractGuardianMessageContent({ rawText: '播放家属信息：明天中午我来看您。' })).toBe('明天中午我来看您。');
    expect(extractGuardianMessageContent({ rawText: '留言：爸，晚饭后别忘了吃药。' })).toBe('爸，晚饭后别忘了吃药。');
  });

  it('treats already-addressed content as direct elder speech', () => {
    expect(isDirectElderSpeech('张爷爷，今晚早点休息。', '张爷爷')).toBe(true);
    expect(isDirectElderSpeech('爷爷，明天我来看您。', '张爷爷')).toBe(true);
    expect(isDirectElderSpeech('今晚早点休息。', '张爷爷')).toBe(false);
  });

  it('builds a spoken elder message with sender and elder names when needed', () => {
    expect(buildGuardianSpeechText({
      message: '今晚降温了，记得关窗。',
      senderName: '张明',
      elderName: '张爷爷',
    })).toBe('张爷爷，张明给您留言：今晚降温了，记得关窗。');
  });

  it('keeps direct elder speech unchanged to avoid double-prefixing', () => {
    expect(buildGuardianSpeechText({
      message: '张爷爷，明天中午我来看您。',
      senderName: '张明',
      elderName: '张爷爷',
    })).toBe('张爷爷，明天中午我来看您。');
  });

  it('returns a handled delivery payload for valid leave-message commands', () => {
    expect(buildGuardianMessageDelivery({
      rawText: '给老人留言：今晚降温了，记得关窗。',
      senderName: '张明',
      elderName: '张爷爷',
    })).toMatchObject({
      handled: true,
      intent: 'leave_message',
      action: 'speak_text',
      guardianMessage: '今晚降温了，记得关窗。',
      speechText: '张爷爷，张明给您留言：今晚降温了，记得关窗。',
      replyText: '好的张明，你的消息我已经帮你告知爷爷啦，请放心',
    });
  });

  it('returns guidance when no message content can be parsed', () => {
    expect(buildGuardianMessageDelivery({
      rawText: '给老人留言：',
      senderName: '张明',
      elderName: '张爷爷',
    })).toMatchObject({
      handled: false,
      intent: null,
      action: null,
    });
  });
});
