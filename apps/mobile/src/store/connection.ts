/**
 * Connection lifecycle store. Owns the singleton HermesGateway and the
 * app-layer reconnect policy the shared client deliberately leaves out
 * (see the desktop's `use-gateway-boot.ts`): reconnect when the app returns
 * to the foreground, since iOS tears sockets down on suspend.
 */

import { atom } from 'nanostores';
import { AppState } from 'react-native';

import { HermesGateway } from '../gateway/client';
import { resolveConnection, type ConnectionConfig } from '../gateway/connection';
import type { GatewayStatus } from '../gateway/types';
import { clearConnection, loadConnection, saveConnection } from '../lib/credentials';

export type ConnectionPhase = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectionSnapshot {
  phase: ConnectionPhase;
  config: ConnectionConfig | null;
  status: GatewayStatus | null;
  error: string | null;
}

export const $connection = atom<ConnectionSnapshot>({
  phase: 'disconnected',
  config: null,
  status: null,
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
    if (status.auth_required) {
      throw new Error(
        'This gateway requires OAuth login. Gated gateways are not supported yet — bind the dashboard on a private/Tailscale interface, or use --insecure on a trusted LAN.',
      );
    }
    await openGateway(config, status);
    await saveConnection(config);
  } catch (error) {
    setSnapshot({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
    throw error;
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
    // rotates on every gateway restart.
    await connectTo(saved.baseUrl);
    return true;
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
  $connection.set({ phase: 'disconnected', config: null, status: null, error: null });
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
    if (snap.config && snap.phase !== 'connected' && snap.phase !== 'connecting') {
      void reconnect().catch(() => {});
    }
  });
}
