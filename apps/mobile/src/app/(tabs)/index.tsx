import { useStore } from '@nanostores/react';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { SessionSummary } from '@/gateway/types';
import { $sessions, $sessionsLoading, createSession, loadSessions } from '@/store/chat';
import { $connection, disconnect } from '@/store/connection';

function sessionTitle(session: SessionSummary): string {
  return session.title?.trim() || session.preview?.trim() || session.id;
}

function SessionRow({ session }: { session: SessionSummary }) {
  const colors = useTheme();
  return (
    <Pressable
      style={[styles.row, { backgroundColor: colors.backgroundElement }]}
      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: session.id } })}>
      <ThemedText numberOfLines={1}>{sessionTitle(session)}</ThemedText>
      <View style={styles.rowMeta}>
        {session.is_active ? <ThemedText type="small" style={styles.live}>● live</ThemedText> : null}
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {[session.model, session.cwd].filter(Boolean).join(' · ')}
        </ThemedText>
      </View>
    </Pressable>
  );
}

export default function ChatTab() {
  const colors = useTheme();
  const sessions = useStore($sessions);
  const loading = useStore($sessionsLoading);
  const connection = useStore($connection);

  useFocusEffect(
    useCallback(() => {
      if (connection.phase === 'connected') {
        void loadSessions().catch(() => {});
      }
    }, [connection.phase]),
  );

  const startNew = async () => {
    const sessionId = await createSession();
    router.push({ pathname: '/chat/[id]', params: { id: sessionId, live: '1' } });
  };

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Chats</ThemedText>
          <View style={styles.headerActions}>
            <Pressable onPress={() => void disconnect()}>
              <ThemedText type="small" themeColor="textSecondary">
                {connection.config?.baseUrl.replace(/^https?:\/\//, '')} ✕
              </ThemedText>
            </Pressable>
          </View>
        </View>

        <FlatList
          data={sessions}
          keyExtractor={session => session.id}
          renderItem={({ item }) => <SessionRow session={item} />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={() => void loadSessions().catch(() => {})} />
          }
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No sessions yet — start one below.
            </ThemedText>
          }
        />

        <Pressable
          style={[styles.newButton, { backgroundColor: colors.backgroundSelected }]}
          onPress={() => void startNew().catch(() => {})}>
          <ThemedText type="smallBold">＋ New chat</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerActions: { flexDirection: 'row', gap: Spacing.two },
  list: { paddingHorizontal: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.five },
  row: { borderRadius: 12, padding: Spacing.three, gap: Spacing.one },
  rowMeta: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  live: { color: '#4caf50' },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  newButton: {
    margin: Spacing.three,
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: Spacing.three,
  },
});
