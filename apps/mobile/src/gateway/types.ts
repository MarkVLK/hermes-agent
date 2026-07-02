/**
 * Typed payloads for the slice of the Hermes gateway protocol the mobile app
 * uses. The server truth is `tui_gateway/server.py`; the fully-typed REST
 * reference is `web/src/lib/api.ts`. Keep these minimal — only fields the UI
 * actually reads — and tolerant (server adds fields freely).
 */

export interface GatewayStatus {
  version?: string;
  release_date?: string;
  auth_required: boolean;
  auth_providers?: string[];
  active_sessions?: number;
}

export interface SessionSummary {
  id: string;
  title?: string | null;
  preview?: string | null;
  cwd?: string | null;
  model?: string | null;
  source?: string | null;
  message_count?: number;
  is_active?: boolean;
  archived?: boolean;
  started_at?: number | string | null;
  last_active?: number | string | null;
}

export interface SessionInfo {
  model?: string;
  cwd?: string;
  branch?: string;
  profile_name?: string;
  desktop_contract?: number;
}

export interface SessionCreateResult {
  session_id: string;
  stored_session_id?: string;
  message_count?: number;
  messages?: HistoryMessage[];
  info?: SessionInfo;
}

export interface HistoryMessage {
  role: 'user' | 'assistant' | 'system' | 'tool' | (string & {});
  content?: unknown;
  [key: string]: unknown;
}

// --- projects.* (v0.18.0+) ----------------------------------------------

export interface ProjectFolder {
  path: string;
  label?: string | null;
  is_primary?: boolean;
}

export interface ProjectInfo {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  board_slug?: string | null;
  primary_path?: string | null;
  archived?: boolean;
  folders?: ProjectFolder[];
}

export interface ProjectTreeRepo {
  id: string;
  label: string;
  path: string;
  sessionCount?: number;
  groups?: unknown[];
}

export interface ProjectTreeNode {
  id: string;
  label: string;
  path?: string;
  color?: string | null;
  icon?: string | null;
  isAuto?: boolean;
  sessionCount?: number;
  lastActive?: number;
  repos?: ProjectTreeRepo[];
  previewSessions?: SessionSummary[];
}

export interface ProjectsTreeResult {
  projects: ProjectTreeNode[];
  active_id?: string | null;
  scoped_session_ids?: string[];
}

export interface ProjectsListResult {
  projects: ProjectInfo[];
  active_id?: string | null;
}

// --- /api/fs (Code tab) ---------------------------------------------------

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number;
}

// --- streaming event payloads --------------------------------------------

export interface TextDeltaPayload {
  text?: string;
}

export interface ToolStartPayload {
  tool_id?: string;
  call_id?: string;
  id?: string;
  name?: string;
  tool?: string;
  args?: unknown;
  [key: string]: unknown;
}

export interface ToolCompletePayload extends ToolStartPayload {
  output?: unknown;
  result?: unknown;
  error?: string;
  /** Server-rendered unified diff for file-editing tools (tui_gateway/server.py). */
  inline_diff?: string;
}

export interface StatusUpdatePayload {
  text?: string;
  status?: string;
  [key: string]: unknown;
}

/** approval.request / clarify.request / sudo.request / secret.request */
export interface InteractiveRequestPayload {
  id?: string | number;
  request_id?: string | number;
  prompt?: string;
  message?: string;
  question?: string;
  tool?: string;
  command?: string;
  options?: unknown[];
  [key: string]: unknown;
}
