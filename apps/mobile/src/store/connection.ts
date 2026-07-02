/**
 * Connection lifecycle store. Owns the singleton HermesGateway and the
 * app-layer reconnect policy the shared client deliberately leaves out
 * (see the desktop's `use-gateway-boot.ts`): reconnect when the app returns
 * to the foreground, since iOS tears sockets down on suspend.
 *
 * Gated (OAuth) gateways: the user logs in once inside an in-app WebView
 * (`/login` on the gateway, which round-trips through Nous Portal or any
 * other registered provider). The WebView shares its cookie jar with the
 * app's fetch, so afterwards `/api/auth/me` succeeds, every REST call rides
 * the rotating session cookies, and each WS connect mints a fresh
 * single-use `?ticket=`. When the refresh cookie finally dies (~30 days),
 * ticket minting 401s and we drop back to `login_required`.
 */

import { atom } from 'nanostores';
import { AppState } from 'react-native';

import { HermesGateway } from '../gateway/client';
import {
  fetchAuthMe,
  NotLoggedInError,
  resolveConnection,
  type AuthPrincipal,
  type ConnectionConfig,
} from '../gateway/connection';
import type { GatewayStatus } from '../gateway/types';
import { clearConnection, loadConnection, saveConnection } from '../lib/credentials';

export type ConnectionPhase = 'disconnected' | 'connecting' | 'login_required' | 'connected' | 'error';

export interface ConnectionSnapshot {
  phase: ConnectionPhase;
  config: ConnectionConfig | null;
  status: GatewayStatus | null;
  principal: AuthPrincipal | null;
  error: string | null;
}

export const $connection = atom<ConnectionSnapshot>({
  phase: 'disconnected',
  config: null,
  status: null,
  principal: null,
  error: null,
});

let gateway: HermesGateway | null = null;
let appStateWired = false;

export function getGateway(): HermesGateway {
  if (!gateway) {
    throw new Error('gateway not connected');
  }
  return gateway;
}

export function peekGateway(): HermesGateway | null {
  return gateway;
}

function setSnapshot(patch: Partial<ConnectionSnapshot>): void {
  $connection.set({ ...$connection.get(), ...patch });
}

async function openGateway(config: ConnectionConfig, status: GatewayStatus | null): Promise<void> {
  gateway?.close();
  const next = new HermesGateway(config);
  gateway = next;
  next.onState(state => {
    if (gateway !== next) {
      return;
    }
    if (state === 'closed' || state === 'error') {
      // Keep config so the foreground listener / retry button can reconnect.
      setSnapshot({ phase: $connection.get().phase === 'connecting' ? 'error' : 'disconnected' });
    }
  });
  setSnapshot({ phase: 'connecting', config, status, error: null });
  await next.open();
  setSnapshot({ phase: 'connected', error: null });
  wireAppStateReconnect();
}

/** Connect to a user-entered URL, then persist it for next launch. */
export async function connectTo(input: string): Promise<void> {
  setSnapshot({ phase: 'connecting', error: null });
  try {
    const { config, status } = await resolveConnection(input);
    await saveConnection(config);
    if (status.auth_required) {
      const principal = await fetchAuthMe(config.baseUrl);
      if (!principal) {
        setSnapshot({ phase: 'login_required', config, status, principal: null, error: null });
        return;
      }
      setSnapshot({ principal });
    }
    await openGateway(config, status);
  } catch (error) {
    if (error instanceof NotLoggedInError) {
      setSnapshot({ phase: 'login_required', error: null });
      return;
    }
    setSnapshot({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Called after the in-app WebView login lands back on the gateway: verify
 * the cookie session took, then bring the WebSocket up.
 */
export async function completeLogin(): Promise<boolean> {
  const { config, status } = $connection.get();
  if (!config) {
    return false;
  }
  const principal = await fetchAuthMe(config.baseUrl);
  if (!principal) {
    return false;
  }
  setSnapshot({ principal });
  try {
    await openGateway(config, status);
    return true;
  } catch (error) {
    setSnapshot({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** Try the credentials saved from a previous launch. */
export async function restoreConnection(): Promise<boolean> {
  const saved = await loadConnection();
  if (!saved) {
    return false;
  }
  try {
    // Re-resolve instead of trusting the stored token: the session token
    // rotates on every gateway restart (cookie sessions survive in the OS
    // cookie store and are re-checked by connectTo).
    await connectTo(saved.baseUrl);
    return $connection.get().phase === 'connected';
  } catch {
    return false;
  }
}

export async function reconnect(): Promise<void> {
  const { config } = $connection.get();
  if (!config) {
    return;
  }
  await connectTo(config.baseUrl);
}

export async function disconnect(): Promise<void> {
  gateway?.close();
  gateway = null;
  await clearConnection();
  $connection.set({ phase: 'disconnected', config: null, status: null, principal: null, error: null });
}

function wireAppStateReconnect(): void {
  if (appStateWired) {
    return;
  }
  appStateWired = true;
  AppState.addEventListener('change', state => {
    if (state !== 'active') {
      return;
    }
    const snap = $connection.get();
    if (
      snap.config &&
      snap.phase !== 'connected' &&
      snap.phase !== 'connecting' &&
      snap.phase !== 'login_required'
    ) {
      void reconnect().catch(() => {});
    }
  });
}
