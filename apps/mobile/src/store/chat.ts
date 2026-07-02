/**
 * Chat state: the session list plus one StreamState per session, fed by the
 * gateway's event stream. Events carry `session_id`, so a single `onAny`
 * subscription fans out into the per-session reducers.
 */

import { map, atom } from 'nanostores';

import type { HermesGateway } from '../gateway/client';
import type { SessionSummary } from '../gateway/types';
import {
  appendUserMessage,
  applyEvent,
  clearPending,
  emptyStream,
  fromHistory,
  type StreamState,
} from './message-stream';
import { notifyIfBackgrounded } from '../lib/notifications';
import { peekGateway } from './connection';

export const $sessions = atom<SessionSummary[]>([]);
export const $sessionsLoading = atom(false);
export const $streams = map<Record<string, StreamState>>({});
/** Count of images attached to the next prompt, per session (composer chip). */
export const $pendingAttachments = map<Record<string, number>>({});

let eventsUnsub: (() => void) | null = null;
let wiredTo: HermesGateway | null = null;

function streamFor(sessionId: string): StreamState {
  return $streams.get()[sessionId] ?? emptyStream;
}

function requireGateway(): HermesGateway {
  const gateway = peekGateway();
  if (!gateway) {
    throw new Error('not connected');
  }
  wireEvents(gateway);
  return gateway;
}

/** Idempotent per-gateway event subscription. */
export function wireEvents(gateway: HermesGateway): void {
  if (wiredTo === gateway) {
    return;
  }
  eventsUnsub?.();
  wiredTo = gateway;
  eventsUnsub = gateway.onAny(event => {
    const sessionId = event.session_id;
    if (!sessionId) {
      return;
    }
    $streams.setKey(sessionId, applyEvent(streamFor(sessionId), event));
    if (event.type === 'approval.request' || event.type === 'clarify.request') {
      notifyIfBackgrounded('Hermes needs input', 'A running task is waiting for your response.');
    } else if (event.type === 'message.complete') {
      notifyIfBackgrounded('Hermes finished', 'The agent completed its turn.');
    }
  });
}

export async function loadSessions(): Promise<void> {
  const gateway = requireGateway();
  $sessionsLoading.set(true);
  try {
    const { sessions } = await gateway.sessionList();
    $sessions.set(sessions ?? []);
  } finally {
    $sessionsLoading.set(false);
  }
}

/** Create a fresh session; returns its live session id. */
export async function createSession(cwd?: string): Promise<string> {
  const gateway = requireGateway();
  const result = await gateway.sessionCreate(cwd);
  $streams.setKey(result.session_id, fromHistory(result.messages ?? []));
  return result.session_id;
}

/**
 * Attach to an existing session: `session.resume` binds this WS connection
 * to it and returns the transcript. Returns the live session id (which can
 * differ from the stored id passed in).
 */
export async function openSession(storedSessionId: string): Promise<string> {
  const gateway = requireGateway();
  const result = await gateway.sessionResume(storedSessionId);
  const liveId = result.session_id ?? storedSessionId;
  $streams.setKey(liveId, fromHistory(result.messages ?? []));
  return liveId;
}

export async function sendPrompt(sessionId: string, text: string): Promise<void> {
  const gateway = requireGateway();
  $streams.setKey(sessionId, appendUserMessage(streamFor(sessionId), text));
  $pendingAttachments.setKey(sessionId, 0);
  await gateway.promptSubmit(sessionId, text);
}

/** Attach a picked photo to the session's next prompt. */
export async function attachImage(sessionId: string, base64: string, filename?: string): Promise<void> {
  const gateway = requireGateway();
  await gateway.imageAttachBytes(sessionId, base64, filename);
  $pendingAttachments.setKey(sessionId, ($pendingAttachments.get()[sessionId] ?? 0) + 1);
}

export async function interrupt(sessionId: string): Promise<void> {
  await requireGateway().sessionInterrupt(sessionId);
}

export async function respondApproval(sessionId: string, approved: boolean): Promise<void> {
  const gateway = requireGateway();
  const pending = streamFor(sessionId).pending;
  const requestId = pending?.payload.id ?? pending?.payload.request_id;
  $streams.setKey(sessionId, clearPending(streamFor(sessionId)));
  await gateway.approvalRespond(sessionId, requestId, approved);
}

export async function respondClarify(sessionId: string, text: string): Promise<void> {
  const gateway = requireGateway();
  const pending = streamFor(sessionId).pending;
  const requestId = pending?.payload.id ?? pending?.payload.request_id;
  $streams.setKey(sessionId, clearPending(streamFor(sessionId)));
  await gateway.clarifyRespond(sessionId, requestId, text);
}
