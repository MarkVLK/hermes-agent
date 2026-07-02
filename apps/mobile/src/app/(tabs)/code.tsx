import { useStore } from '@nanostores/react';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { FsEntry } from '@/gateway/types';
import { $connection, peekGateway } from '@/store/connection';

export default function CodeTab() {
  const colors = useTheme();
  const connection = useStore($connection);
  const [cwd, setCwd] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (path: string | null) => {
    const gateway = peekGateway();
    if (!gateway) {
      return;
    }
    setError(null);
    try {
      const target = path ?? (await gateway.fsDefaultCwd().then(r => r.cwd ?? r.path ?? '/'));
      const result = await gateway.fsList(target ?? undefined);
      setCwd(result.path ?? target ?? '/');
      setEntries(
        [...(result.entries ?? [])].sort((a, b) =>
          a.is_dir === b.is_dir ? a.name.localeCompare(b.name) : a.is_dir ? -1 : 1,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (connection.phase === 'connected' && cwd === null) {
        void load(null);
      }
    }, [connection.phase, cwd, load]),
  );

  const parent = cwd && cwd !== '/' ? cwd.replace(/\/[^/]+\/?$/, '') || '/' : null;

  const open = (entry: FsEntry) => {
    if (entry.is_dir) {
      void load(entry.path);
    } else {
      router.push({ pathname: '/file', params: { path: entry.path } });
    }
  };

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Code</ThemedText>
          <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
            {cwd ?? '…'}
          </ThemedText>
        </View>

        {error ? (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}

        <FlatList
          data={entries}
          keyExtractor={entry => entry.path}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            parent ? (
              <Pressable
                style={[styles.row, { backgroundColor: colors.backgroundElement }]}
                onPress={() => void load(parent)}>
                <ThemedText type="small">↰ ..</ThemedText>
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={[styles.row, { backgroundColor: colors.backgroundElement }]}
              onPress={() => open(item)}>
              <ThemedText type="small" numberOfLines={1}>
                {item.is_dir ? '📁' : '📄'} {item.name}
              </ThemedText>
            </Pressable>
          )}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {cwd ? 'Empty directory.' : 'Browsing the gateway filesystem…'}
            </ThemedText>
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
  },
  list: { paddingHorizontal: Spacing.three, gap: Spacing.one, paddingBottom: Spacing.five },
  row: { borderRadius: 8, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  error: { color: '#ef5350', paddingHorizontal: Spacing.three },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
