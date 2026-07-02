/**
 * Gateway connection + auth plumbing, mirrored from the desktop's
 * `apps/desktop/electron/connection-config.cjs` and the web dashboard's
 * `web/src/lib/api.ts`. Pure functions over fetch/URL so the whole module
 * runs unchanged in React Native, Node (tests), and the browser.
 *
 * Two auth modes, advertised by the public `GET /api/status` probe:
 *  - token  (auth_required: false): per-boot session token, injected into the
 *    served SPA as `window.__HERMES_SESSION_TOKEN__`. REST wants the
 *    `X-Hermes-Session-Token` header; the WS upgrade wants `?token=`.
 *  - gated  (auth_required: true): cookie session from an OAuth/password
 *    login; the WS upgrade wants a single-use 30s ticket minted via
 *    `POST /api/auth/ws-ticket`. `?token=` is rejected in this mode.
 */

import type { GatewayStatus } from './types';

export interface ConnectionConfig {
  /** Normalized origin + optional base path, no trailing slash. */
  baseUrl: string;
  /** Static session token (token mode). Absent in gated mode. */
  token?: string;
  authMode: 'token' | 'gated';
}

const TOKEN_RE = /__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/;

/** "myhost:8899" → "http://myhost:8899"; strips trailing slashes. */
export function normalizeBaseUrl(input: string): string {
  let raw = input.trim();
  if (!raw) {
    throw new Error('Gateway URL is empty');
  }
  if (!/^https?:\/\//i.test(raw)) {
    raw = `http://${raw}`;
  }
  const url = new URL(raw);
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

export function buildWsUrl(config: ConnectionConfig, credential?: string): string {
  const ws = config.baseUrl.replace(/^http/i, 'ws');
  if (config.authMode === 'gated') {
    if (!credential) {
      throw new Error('gated gateway requires a ws ticket');
    }
    return `${ws}/api/ws?ticket=${encodeURIComponent(credential)}`;
  }
  const token = credential ?? config.token;
  return token ? `${ws}/api/ws?token=${encodeURIComponent(token)}` : `${ws}/api/ws`;
}

export function restHeaders(config: ConnectionConfig): Record<string, string> {
  return config.authMode === 'token' && config.token
    ? { 'X-Hermes-Session-Token': config.token }
    : {};
}

export async function probeStatus(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<GatewayStatus> {
  const res = await fetchImpl(`${baseUrl}/api/status`);
  if (!res.ok) {
    throw new Error(`gateway status probe failed: HTTP ${res.status}`);
  }
  return (await res.json()) as GatewayStatus;
}

export function extractSessionToken(indexHtml: string): string | null {
  return TOKEN_RE.exec(indexHtml)?.[1] ?? null;
}

/**
 * Token mode: the token is only published inside the served index.html
 * (same trick as `apps/desktop/electron/dashboard-token.cjs`).
 */
export async function scrapeSessionToken(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${baseUrl}/`);
  if (!res.ok) {
    throw new Error(`could not load gateway UI to read session token: HTTP ${res.status}`);
  }
  const token = extractSessionToken(await res.text());
  if (!token) {
    throw new Error('gateway did not expose a session token (is it gated?)');
  }
  return token;
}

/** Gated mode: mint a fresh single-use WS ticket. Requires a cookie session. */
export async function mintWsTicket(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${baseUrl}/api/auth/ws-ticket`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`ws-ticket mint failed: HTTP ${res.status} (are you logged in?)`);
  }
  const body = (await res.json()) as { ticket?: string };
  if (!body.ticket) {
    throw new Error('ws-ticket response had no ticket');
  }
  return body.ticket;
}

/**
 * Resolve a user-entered URL into a ready-to-connect config: probe the auth
 * mode, then acquire the token when the gateway is in token mode.
 */
export async function resolveConnection(input: string, fetchImpl: typeof fetch = fetch): Promise<{
  config: ConnectionConfig;
  status: GatewayStatus;
}> {
  const baseUrl = normalizeBaseUrl(input);
  const status = await probeStatus(baseUrl, fetchImpl);
  if (status.auth_required) {
    return { config: { baseUrl, authMode: 'gated' }, status };
  }
  const token = await scrapeSessionToken(baseUrl, fetchImpl);
  return { config: { baseUrl, token, authMode: 'token' }, status };
}

/** WS credential for a connect attempt: static token, or a fresh ticket. */
export async function acquireWsCredential(config: ConnectionConfig, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (config.authMode === 'gated') {
    return mintWsTicket(config.baseUrl, fetchImpl);
  }
  if (!config.token) {
    throw new Error('missing session token');
  }
  return config.token;
}
