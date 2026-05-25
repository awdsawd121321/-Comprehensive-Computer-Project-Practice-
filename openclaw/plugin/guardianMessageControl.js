const GUARDIAN_MESSAGE_PREFIX_PATTERNS = [
  /^\/?(?:给老人留言|给长辈留言|给爷爷留言|给奶奶留言|给爸留言|给妈留言|给老人带话|对老人说|转告老人|告诉老人|播放家属信息|播放家属留言|让老人播放家属信息|让老人听留言|请老人听留言)\s*[:：]?\s*/u,
  /^\/?留言\s*[:：]?\s*/u,
];

const QUOTE_EDGE_PATTERN = /^[“"'`「『]+|[”"'`」』]+$/gu;

export const GUARDIAN_MESSAGE_EXAMPLES = [
  '给老人留言：今晚降温了，记得关窗。',
  '播放家属信息：明天中午我来看您。',
  '留言：爸，晚饭后别忘了吃药。',
];

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unwrapQuotedText(value) {
  return normalizeText(value).replace(QUOTE_EDGE_PATTERN, '').trim();
}

function resolveElderReplyLabel(elderName = '') {
  const normalized = normalizeText(elderName);
  if (!normalized) return '爷爷';
  const relationLabels = ['爷爷', '奶奶', '外公', '外婆', '爸爸', '妈妈', '爸', '妈'];
  return relationLabels.find((label) => normalized.includes(label)) || normalized;
}

export function extractGuardianMessageContent({ rawText = '', message = '' } = {}) {
  const explicit = unwrapQuotedText(message);
  if (explicit) return explicit;

  const normalizedRaw = normalizeText(rawText);
  if (!normalizedRaw) return '';

  for (const pattern of GUARDIAN_MESSAGE_PREFIX_PATTERNS) {
    const matched = normalizedRaw.match(pattern);
    if (!matched) continue;
    return unwrapQuotedText(normalizedRaw.slice(matched[0].length));
  }

  return '';
}

export function isDirectElderSpeech(message, elderName = '') {
  const normalizedMessage = normalizeText(message);
  if (!normalizedMessage) return false;

  const directPrefixes = [
    elderName,
    '张爷爷',
    '爷爷',
    '奶奶',
    '外公',
    '外婆',
    '爸爸',
    '妈妈',
    '爸',
    '妈',
    '您',
  ]
    .map((item) => normalizeText(item))
    .filter(Boolean);

  return directPrefixes.some((prefix) => normalizedMessage.startsWith(prefix));
}

export function buildGuardianSpeechText({ message, senderName = '', elderName = '' } = {}) {
  const normalizedMessage = extractGuardianMessageContent({ message });
  if (!normalizedMessage) return '';
  if (isDirectElderSpeech(normalizedMessage, elderName)) {
    return normalizedMessage;
  }

  const normalizedSender = normalizeText(senderName);
  const spokenIntro = normalizedSender ? `${normalizedSender}给您留言：` : '家里人给您留言：';
  if (normalizeText(elderName)) {
    return `${normalizeText(elderName)}，${spokenIntro}${normalizedMessage}`;
  }
  return `${spokenIntro}${normalizedMessage}`;
}

export function buildGuardianMessageDelivery({ rawText = '', message = '', senderName = '', elderName = '' } = {}) {
  const guardianMessage = extractGuardianMessageContent({ rawText, message });
  if (!guardianMessage) {
    return {
      handled: false,
      intent: null,
      action: null,
      reason: '未识别到可播报的留言内容，请使用“给老人留言：内容”或“播放家属信息：内容”。',
      examples: [...GUARDIAN_MESSAGE_EXAMPLES],
    };
  }

  const speechText = buildGuardianSpeechText({
    message: guardianMessage,
    senderName,
    elderName,
  });

  const elderLabel = resolveElderReplyLabel(elderName);
  const senderLabel = normalizeText(senderName) || '家属';
  return {
    handled: true,
    intent: 'leave_message',
    action: 'speak_text',
    guardianMessage,
    speechText,
    replyText: `好的${senderLabel}，你的消息我已经帮你告知${elderLabel}啦，请放心`,
  };
}
