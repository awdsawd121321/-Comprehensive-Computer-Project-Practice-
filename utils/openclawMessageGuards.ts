export interface OpenClawBridgeMessageLike {
  text?: string | null;
  purpose?: string | null;
}

const GUARDIAN_TEXT_HINTS = [
  '【发送给家属】',
  '建议今晚安排家属陪伴',
  '建议家属',
  '请家属关注',
  '建议安排家属陪伴',
  '建议家属视频通话',
  '建议家属电话问候',
];

export const isGuardianOnlyBridgeMessage = (message?: OpenClawBridgeMessageLike | null): boolean => {
  const purpose = String(message?.purpose || '').trim().toLowerCase();
  const text = String(message?.text || '').trim();

  if (!text && !purpose) return false;
  if (purpose === 'guardian_message_via_elder') return true;
  if (purpose === 'daily_report') return true;
  if (purpose.startsWith('guardian_')) return true;

  return GUARDIAN_TEXT_HINTS.some((hint) => text.includes(hint));
};
