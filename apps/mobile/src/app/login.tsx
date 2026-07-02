import { useStore } from '@nanostores/react';
import { Redirect, router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { loginUrl } from '@/gateway/connection';
import { $connection, completeLogin } from '@/store/connection';

/**
 * In-app browser login for OAuth-gated gateways (e.g. behind Nous Portal).
 *
 * The WebView loads the gateway's own `/login` page, which round-trips
 * through the identity provider and back to `/auth/callback`, where the
 * gateway sets its session cookies. `sharedCookiesEnabled` makes those
 * cookies visible to the app's fetch/WebSocket layer (iOS: WKWebView ↔
 * NSHTTPCookieStorage; Android: CookieManager is shared already), so once
 * we detect a logged-in session via `/api/auth/me` we can mint WS tickets
 * and open the gateway socket.
 */
export default function LoginScreen() {
  const connection = useStore($connection);
  const [checking, setChecking] = useState(false);
  const checkScheduled = useRef(false);

  if (connection.phase === 'connected') {
    return <Redirect href="/" />;
  }
  if (!connection.config) {
    return <Redirect href="/connect" />;
  }

  const base = connection.config.baseUrl;

  const tryComplete = async () => {
    if (checkScheduled.current) {
      return;
    }
    checkScheduled.current = true;
    setChecking(true);
    try {
      const ok = await completeLogin();
      if (ok) {
        router.replace('/');
      }
    } finally {
      checkScheduled.current = false;
      setChecking(false);
    }
  };

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: 'Sign in' }} />
      <WebView
        source={{ uri: loginUrl(base) }}
        sharedCookiesEnabled
        incognito={false}
        onNavigationStateChange={nav => {
          // Any post-login landing back on the gateway (the SPA shell, the
          // login page's success redirect, …) is our cue to re-check the
          // cookie session. Cheap and idempotent — just a /api/auth/me probe.
          if (!nav.loading && nav.url.startsWith(base) && !nav.url.includes('/auth/')) {
            void tryComplete();
          }
        }}
        style={styles.flex}
      />
      <Pressable style={styles.footer} onPress={() => void tryComplete()} disabled={checking}>
        <ThemedText type="smallBold">{checking ? 'Checking session…' : "I've signed in — continue"}</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: { alignItems: 'center', padding: Spacing.three },
});
