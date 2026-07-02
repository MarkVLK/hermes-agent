/**
 * Pure reducer that folds the gateway's streaming events into a renderable
 * chat transcript. Mobile port of the desktop's streaming logic
 * (`apps/desktop/src/app/session/hooks/use-message-stream.ts`), stripped to
 * the event set the phone UI renders. No React, no I/O — unit-testable.
 */

import type { GatewayEvent } from '@hermes/shared';

import type {
  HistoryMessage,
  InteractiveRequestPayload,
  StatusUpdatePayload,
  TextDeltaPayload,
  ToolCompletePayload,
  ToolStartPayload,
} from '../gateway/types';

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; complete: boolean }
  | { kind: 'thinking'; id: string; text: string }
  | {
      kind: 'tool';
      id: string;
      name: string;
      status: 'running' | 'done' | 'error';
      detail?: string;
      /** Unified diff (from tool.complete's inline_diff) for edit tools. */
      diff?: string;
    }
  | { kind: 'notice'; id: string; text: string };

export type InteractiveKind = 'approval' | 'clarify' | 'sudo' | 'secret';

export interface PendingInteractive {
  kind: InteractiveKind;
  payload: InteractiveRequestPayload;
}

export interface StreamState {
  items: ChatItem[];
  streaming: boolean;
  statusText: string;
  pending: PendingInteractive | null;
}

export const emptyStream: StreamState = {
  items: [],
  streaming: false,
  statusText: '',
  pending: null,
};

let nextLocalId = 0;
const localId = (prefix: string) => `${prefix}_${++nextLocalId}`;

function last(items: ChatItem[]): ChatItem | undefined {
  return items[items.length - 1];
}

function appendToTail(
  state: StreamState,
  kind: 'assistant' | 'thinking',
  text: string,
): StreamState {
  if (!text) {
    return state;
  }
  const tail = last(state.items);
  if (tail && tail.kind === kind && (kind !== 'assistant' || !(tail as { complete?: boolean }).complete)) {
    const updated = { ...tail, text: tail.text + text } as ChatItem;
    return { ...state, items: [...state.items.slice(0, -1), updated] };
  }
  const fresh: ChatItem =
    kind === 'assistant'
      ? { kind, id: localId('a'), text, complete: false }
      : { kind, id: localId('t'), text };
  return { ...state, items: [...state.items, fresh] };
}

function toolKey(payload: ToolStartPayload): string {
  return String(payload.tool_id ?? payload.call_id ?? payload.id ?? localId('tool'));
}

function toolName(payload: ToolStartPayload): string {
  return String(payload.name ?? payload.tool ?? 'tool');
}

function updateTool(
  state: StreamState,
  key: string,
  patch: Partial<Extract<ChatItem, { kind: 'tool' }>>,
): StreamState {
  const idx = state.items.findLastIndex(item => item.kind === 'tool' && item.id === key);
  if (idx < 0) {
    return state;
  }
  const items = [...state.items];
  items[idx] = { ...(items[idx] as Extract<ChatItem, { kind: 'tool' }>), ...patch };
  return { ...state, items };
}

const INTERACTIVE: Record<string, InteractiveKind> = {
  'approval.request': 'approval',
  'clarify.request': 'clarify',
  'sudo.request': 'sudo',
  'secret.request': 'secret',
};

export function appendUserMessage(state: StreamState, text: string): StreamState {
  return {
    ...state,
    streaming: true,
    items: [...state.items, { kind: 'user', id: localId('u'), text }],
  };
}

export function applyEvent(state: StreamState, event: GatewayEvent): StreamState {
  switch (event.type) {
    case 'message.start':
      return { ...state, streaming: true };

    case 'message.delta':
      return appendToTail(state, 'assistant', (event.payload as TextDeltaPayload)?.text ?? '');

    case 'thinking.delta':
    case 'reasoning.delta':
      return appendToTail(state, 'thinking', (event.payload as TextDeltaPayload)?.text ?? '');

    case 'message.complete': {
      const tail = last(state.items);
      const items =
        tail?.kind === 'assistant'
          ? [...state.items.slice(0, -1), { ...tail, complete: true }]
          : state.items;
      return { ...state, items, streaming: false, statusText: '' };
    }

    case 'status.update': {
      const payload = event.payload as StatusUpdatePayload | undefined;
      return { ...state, statusText: String(payload?.text ?? payload?.status ?? '') };
    }

    case 'tool.start': {
      const payload = (event.payload ?? {}) as ToolStartPayload;
      const item: ChatItem = {
        kind: 'tool',
        id: toolKey(payload),
        name: toolName(payload),
        status: 'running',
      };
      return { ...state, items: [...state.items, item] };
    }

    case 'tool.progress': {
      const payload = (event.payload ?? {}) as ToolCompletePayload;
      const detail = payload.output ?? payload.result;
      return updateTool(state, toolKey(payload), detail === undefined ? {} : { detail: String(detail).slice(-400) });
    }

    case 'tool.complete': {
      const payload = (event.payload ?? {}) as ToolCompletePayload;
      const diff = typeof payload.inline_diff === 'string' && payload.inline_diff.trim() ? payload.inline_diff : undefined;
      return updateTool(state, toolKey(payload), {
        status: payload.error ? 'error' : 'done',
        ...(payload.error ? { detail: String(payload.error) } : {}),
        ...(diff ? { diff } : {}),
      });
    }

    case 'error': {
      const text = String((event.payload as { message?: string })?.message ?? 'gateway error');
      return {
        ...state,
        streaming: false,
        items: [...state.items, { kind: 'notice', id: localId('e'), text }],
      };
    }

    case 'background.complete':
      return { ...state, streaming: false };

    default: {
      const interactive = INTERACTIVE[event.type];
      if (interactive) {
        return {
          ...state,
          pending: { kind: interactive, payload: (event.payload ?? {}) as InteractiveRequestPayload },
        };
      }
      return state;
    }
  }
}

export function clearPending(state: StreamState): StreamState {
  return { ...state, pending: null };
}

/** Fold a stored transcript (`session.history`) into renderable items. */
export function fromHistory(messages: HistoryMessage[]): StreamState {
  const items: ChatItem[] = [];
  for (const message of messages) {
    const text = historyText(message.content);
    if (!text) {
      continue;
    }
    if (message.role === 'user') {
      items.push({ kind: 'user', id: localId('u'), text });
    } else if (message.role === 'assistant') {
      items.push({ kind: 'assistant', id: localId('a'), text, complete: true });
    }
  }
  return { ...emptyStream, items };
}

function historyText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map(part =>
        typeof part === 'string'
          ? part
          : typeof (part as { text?: string })?.text === 'string'
            ? (part as { text: string }).text
            : '',
      )
      .join('');
  }
  return '';
}
