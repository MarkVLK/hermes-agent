import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { peekGateway } from '@/store/connection';

export default function FileViewer() {
  const { path } = useLocalSearchParams<{ path: string }>();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const gateway = peekGateway();
    if (!gateway || !path) {
      return;
    }
    gateway
      .fsReadText(path)
      .then(result => setContent(result.content ?? result.text ?? ''))
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [path]);

  const name = path?.split('/').pop() ?? 'File';

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: name }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ScrollView horizontal contentContainerStyle={styles.codeWrap}>
          <ThemedText type="code">
            {error ?? content ?? 'Loading…'}
          </ThemedText>
        </ScrollView>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three },
  codeWrap: { paddingBottom: Spacing.five },
});
