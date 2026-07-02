import { useStore } from '@nanostores/react';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { $connection, connectTo } from '@/store/connection';

export default function ConnectScreen() {
  const colors = useTheme();
  const connection = useStore($connection);
  const [url, setUrl] = useState(connection.config?.baseUrl ?? '');
  const [busy, setBusy] = useState(false);

  if (connection.phase === 'connected') {
    return <Redirect href="/" />;
  }

  const submit = async () => {
    if (!url.trim() || busy) {
      return;
    }
    setBusy(true);
    try {
      await connectTo(url);
    } catch {
      // surfaced via $connection.error
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ThemedView style={styles.container}>
        <ThemedText type="title">Hermes</ThemedText>
        <ThemedText type="small" style={styles.hint}>
          Enter the URL of a running Hermes gateway (the machine where you ran{' '}
          <ThemedText type="code">hermes dashboard</ThemedText>). On a Tailscale or local
          network this looks like <ThemedText type="code">http://my-mac:8899</ThemedText>.
        </ThemedText>

        <TextInput
          style={[styles.input, { color: colors.text, backgroundColor: colors.backgroundElement }]}
          placeholder="http://gateway-host:8899"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={url}
          onChangeText={setUrl}
          onSubmitEditing={submit}
          editable={!busy}
        />

        <Pressable
          style={[styles.button, { backgroundColor: colors.backgroundSelected }]}
          onPress={submit}
          disabled={busy}>
          {busy ? (
            <ActivityIndicator />
          ) : (
            <ThemedText type="smallBold">Connect</ThemedText>
          )}
        </Pressable>

        {connection.error ? (
          <ThemedText type="small" style={styles.error}>
            {connection.error}
          </ThemedText>
        ) : null}
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
    justifyContent: 'center',
  },
  hint: { lineHeight: 20 },
  input: {
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  button: {
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: Spacing.three,
  },
  error: { color: '#ef5350' },
});
