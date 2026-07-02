/**
 * Typed Hermes gateway client for mobile: the shared JSON-RPC WebSocket
 * client plus the REST slice the app uses. Mirrors the desktop's
 * `HermesGateway extends JsonRpcGatewayClient` (`apps/desktop/src/hermes.ts`)
 * but goes straight to fetch/WebSocket — no Electron bridge.
 */

import { JsonRpcGatewayClient } from '@hermes/shared';

import {
  acquireWsCredential,
  buildWsUrl,
  restHeaders,
  type ConnectionConfig,
} from './connection';
import type {
  FsEntry,
  HistoryMessage,
  ProjectsListResult,
  ProjectsTreeResult,
  SessionCreateResult,
  SessionSummary,
} from './types';

export class HermesGateway extends JsonRpcGatewayClient {
  constructor(readonly config: ConnectionConfig) {
    super({ requestIdPrefix: 'm' });
  }

  /** Connect (or reconnect); in gated mode mints a fresh single-use ticket. */
  async open(): Promise<void> {
    const credential = await acquireWsCredential(this.config);
    await this.connect(buildWsUrl(this.config, credential));
  }

  // --- REST ----------------------------------------------------------------

  async rest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      credentials: 'include',
      ...init,
      headers: { ...restHeaders(this.config), ...(init.headers as Record<string, string> | undefined) },
    });
    if (!res.ok) {
      throw new Error(`${path}: HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  fsList(path?: string): Promise<{ entries: FsEntry[]; path?: string }> {
    const q = path ? `?path=${encodeURIComponent(path)}` : '';
    return this.rest(`/api/fs/list${q}`);
  }

  fsReadText(path: string): Promise<{ content?: string; text?: string; truncated?: boolean }> {
    return this.rest(`/api/fs/read-text?path=${encodeURIComponent(path)}`);
  }

  fsDefaultCwd(): Promise<{ cwd?: string; path?: string }> {
    return this.rest('/api/fs/default-cwd');
  }

  // --- sessions / chat -------------------------------------------------------

  sessionList(limit = 50): Promise<{ sessions: SessionSummary[] }> {
    return this.request('session.list', { limit });
  }

  sessionCreate(cwd?: string): Promise<SessionCreateResult> {
    return this.request('session.create', cwd ? { cwd } : {});
  }

  sessionResume(sessionId: string): Promise<SessionCreateResult> {
    return this.request('session.resume', { session_id: sessionId });
  }

  sessionHistory(sessionId: string): Promise<{ messages?: HistoryMessage[] }> {
    return this.request('session.history', { session_id: sessionId });
  }

  sessionInterrupt(sessionId: string): Promise<unknown> {
    return this.request('session.interrupt', { session_id: sessionId });
  }

  promptSubmit(sessionId: string, text: string): Promise<{ status?: string }> {
    return this.request('prompt.submit', { session_id: sessionId, text });
  }

  approvalRespond(sessionId: string, requestId: string | number | undefined, approved: boolean): Promise<unknown> {
    return this.request('approval.respond', { session_id: sessionId, id: requestId, approved });
  }

  clarifyRespond(sessionId: string, requestId: string | number | undefined, text: string): Promise<unknown> {
    return this.request('clarify.respond', { session_id: sessionId, id: requestId, text });
  }

  /**
   * Attach an image to the session's next prompt from raw base64 bytes —
   * the remote-client path (`image.attach_bytes`), since the phone's photo
   * only exists on the phone.
   */
  imageAttachBytes(sessionId: string, contentBase64: string, filename?: string): Promise<{ attached?: unknown }> {
    return this.request('image.attach_bytes', {
      session_id: sessionId,
      content_base64: contentBase64,
      ...(filename ? { filename } : {}),
    });
  }

  // --- projects (gateway v0.18.0+) -------------------------------------------

  projectsList(): Promise<ProjectsListResult> {
    return this.request('projects.list');
  }

  projectsTree(previewLimit = 3): Promise<ProjectsTreeResult> {
    return this.request('projects.tree', { preview_limit: previewLimit });
  }

  projectsCreate(name: string, folders: string[]): Promise<{ project: import('./types').ProjectInfo | null }> {
    return this.request('projects.create', { name, folders, use: true });
  }
}
