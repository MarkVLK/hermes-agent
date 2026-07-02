import { useStore } from '@nanostores/react';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ProjectTreeNode } from '@/gateway/types';
import { createSession } from '@/store/chat';
import { $projects, loadProjects } from '@/store/projects';

function ProjectCard({ project }: { project: ProjectTreeNode }) {
  const colors = useTheme();

  const startChatHere = async () => {
    if (!project.path) {
      return;
    }
    const sessionId = await createSession(project.path);
    router.push({ pathname: '/chat/[id]', params: { id: sessionId, live: '1' } });
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
      <View style={styles.cardHeader}>
        <ThemedText type="smallBold">
          {project.icon ? `${project.icon} ` : ''}
          {project.label}
          {project.isAuto ? '  (auto)' : ''}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {project.sessionCount ?? 0} sessions
        </ThemedText>
      </View>
      {project.path ? (
        <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
          {project.path}
        </ThemedText>
      ) : null}
      {(project.repos ?? []).map(repo => (
        <ThemedText key={repo.id} type="small" themeColor="textSecondary" numberOfLines={1}>
          ⌥ {repo.label} — {repo.sessionCount ?? 0} sessions
        </ThemedText>
      ))}
      {(project.previewSessions ?? []).map(session => (
        <Pressable
          key={session.id}
          onPress={() => router.push({ pathname: '/chat/[id]', params: { id: session.id } })}>
          <ThemedText type="small" numberOfLines={1}>
            💬 {session.title || session.preview || session.id}
          </ThemedText>
        </Pressable>
      ))}
      <Pressable
        style={[styles.newChat, { backgroundColor: colors.backgroundSelected }]}
        onPress={() => void startChatHere().catch(() => {})}>
        <ThemedText type="smallBold">＋ New chat in project</ThemedText>
      </Pressable>
    </View>
  );
}

export default function ProjectsTab() {
  const snapshot = useStore($projects);

  useFocusEffect(
    useCallback(() => {
      void loadProjects();
    }, []),
  );

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Projects</ThemedText>
        </View>

        {snapshot.unsupported ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            This gateway predates first-class Projects (Hermes v0.18.0). Update the gateway with
            `hermes update`, then pull to refresh.
          </ThemedText>
        ) : (
          <FlatList
            data={snapshot.tree?.projects ?? []}
            keyExtractor={project => project.id}
            renderItem={({ item }) => <ProjectCard project={item} />}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={snapshot.loading} onRefresh={() => void loadProjects()} />
            }
            ListEmptyComponent={
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                {snapshot.error ?? 'No projects yet. Create one from the desktop app, or start a chat in a repo folder.'}
              </ThemedText>
            }
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  list: { paddingHorizontal: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.five },
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  newChat: {
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    marginTop: Spacing.one,
  },
  empty: { textAlign: 'center', marginTop: Spacing.five, paddingHorizontal: Spacing.four },
});
