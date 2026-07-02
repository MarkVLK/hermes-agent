/**
 * Gateway credentials live in the iOS Keychain / Android Keystore via
 * expo-secure-store — never in AsyncStorage or plain files.
 */

import * as SecureStore from 'expo-secure-store';

import type { ConnectionConfig } from '../gateway/connection';

const KEY = 'hermes.gateway.connection';

export async function saveConnection(config: ConnectionConfig): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(config));
}

export async function loadConnection(): Promise<ConnectionConfig | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as ConnectionConfig;
    return parsed.baseUrl ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
