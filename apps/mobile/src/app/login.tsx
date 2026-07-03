import { useStore } from '@nanostores/react';
import { Redirect, router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

// Present a stock browser UA. CAPTCHA providers (Privy → Cloudflare
// Turnstile on Nous Portal) score embedded webviews as low-trust partly by
// their app-specific UA suffix; a plain Safari/Chrome UA lets the challenge
// run the same checks it runs in the real browser.
const BROWSER_UA = Platform.select({
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  default:
    'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
});

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
        userAgent={BROWSER_UA}
        thirdPartyCookiesEnabled
        javaScriptCanOpenWindowsAutomatically
        setSupportMultipleWindows={false}
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
