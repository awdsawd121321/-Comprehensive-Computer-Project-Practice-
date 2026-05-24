/**
 * 当前选中的克隆音色管理
 * 克隆一次即存储一个声音模型，可在此选择切换；选择结果持久化到 localStorage
 */

const STORAGE_KEY = 'emobit_selected_voice_id';
const EVENT_NAME = 'emobit-voice-selection-changed';

let selectedId: string | null = null;

function load(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function save(id: string | null): void {
  try {
    if (id == null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, id);
    }
  } catch (e) {
    console.warn('[voiceSelection] save failed', e);
  }
}

export const voiceSelectionService = {
  /** 当前选中的克隆声音 ID，无则 null（使用预设 Edge TTS） */
  getSelectedVoiceId(): string | null {
    if (selectedId !== null) return selectedId;
    selectedId = load();
    return selectedId;
  },

  /** 设为当前使用的克隆声音；传 null 则改回预设 */
  setSelectedVoiceId(id: string | null): void {
    selectedId = id;
    save(id);
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: id }));
    } catch {
      // ignore
    }
  },

  /** 订阅选择变化，便于 UI 刷新 */
  subscribe(callback: (id: string | null) => void): () => void {
    const handler = (e: Event) => callback((e as CustomEvent).detail ?? null);
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  },
};
