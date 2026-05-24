export interface LocalUiCommand {
  id?: string;
  type: string;
  timestamp?: number;
  payload?: Record<string, unknown>;
}

const EVENT_NAME = 'emobit-local-ui-command';

function buildCommandId(): string {
  return `local_ui_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCommand(command: LocalUiCommand): Required<LocalUiCommand> {
  return {
    id: command.id || buildCommandId(),
    type: command.type,
    timestamp: typeof command.timestamp === 'number' ? command.timestamp : Date.now(),
    payload: command.payload || {},
  };
}

export function publishLocalUiCommand(command: LocalUiCommand): Required<LocalUiCommand> {
  const normalized = normalizeCommand(command);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: normalized }));
  }
  return normalized;
}

export function subscribeLocalUiCommands(callback: (command: Required<LocalUiCommand>) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<Required<LocalUiCommand>>).detail;
    if (!detail?.type) return;
    callback(detail);
  };

  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
