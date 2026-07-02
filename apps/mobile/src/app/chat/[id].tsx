import { useStore } from '@nanostores/react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import * as ImagePicker from 'expo-image-picker';

import { DiffLines } from '@/components/diff-lines';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ensureNotificationPermission } from '@/lib/notifications';
import type { ChatItem } from '@/store/message-stream';
import { emptyStream } from '@/store/message-stream';
import {
  $pendingAttachments,
  $streams,
  attachImage,
  interrupt,
  openSession,
  respondApproval,
  respondClarify,
  sendPrompt,
} from '@/store/chat';

function MessageRow({ item }: { item: ChatItem }) {
  const colors = useTheme();
  switch (item.kind) {
    case 'user':
      return (
        <View style={[styles.bubble, styles.userBubble, { backgroundColor: colors.backgroundSelected }]}>
          <ThemedText>{item.text}</ThemedText>
        </View>
      );
    case 'assistant':
      return (
        <View style={styles.assistantBlock}>
          <ThemedText>{item.text}</ThemedText>
        </View>
      );
    case 'thinking':
      return (
        <View style={styles.assistantBlock}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.thinking}>
            {item.text}
          </ThemedText>
        </View>
      );
    case 'tool':
      return (
        <View style={[styles.toolCard, { backgroundColor: colors.backgroundElement }]}>
          <View style={styles.toolHeader}>
            <ThemedText type="smallBold">
              {item.status === 'running' ? '⚙️' : item.status === 'error' ? '⚠️' : '✓'} {item.name}
            </ThemedText>
            {item.status === 'running' ? <ActivityIndicator size="small" /> : null}
          </View>
          {item.detail ? (
            <ThemedText type="code" themeColor="textSecondary" numberOfLines={6}>
              {item.detail}
            </ThemedText>
          ) : null}
          {item.diff ? <DiffLines diff={item.diff} /> : null}
        </View>
      );
    case 'notice':
      return (
        <ThemedText type="small" style={styles.notice}>
          {item.text}
        </ThemedText>
      );
  }
}

export default function ChatThread() {
  const colors = useTheme();
  const params = useLocalSearchParams<{ id: string; live?: string }>();
  const [liveId, setLiveId] = useState<string | null>(params.live ? params.id : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [clarifyDraft, setClarifyDraft] = useState('');
  const listRef = useRef<FlatList<ChatItem>>(null);

  const streams = useStore($streams);
  const stream = (liveId && streams[liveId]) || emptyStream;
  const attachments = useStore($pendingAttachments);
  const attachedCount = (liveId && attachments[liveId]) || 0;

  useEffect(() => {
    void ensureNotificationPermission();
  }, []);

  const pickAndAttach = async () => {
    if (!liveId) {
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      base64: true,
      quality: 0.8,
    });
    const asset = picked.assets?.[0];
    if (picked.canceled || !asset?.base64) {
      return;
    }
    await attachImage(liveId, asset.base64, asset.fileName ?? undefined);
  };

  useEffect(() => {
    if (liveId) {
      return;
    }
    openSession(params.id)
      .then(setLiveId)
      .catch(error => setLoadError(error instanceof Error ? error.message : String(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    if (stream.items.length > 0) {
      const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
      return () => clearTimeout(timer);
    }
  }, [stream.items.length]);

  const submit = () => {
    const text = draft.trim();
    if (!text || !liveId) {
      return;
    }
    setDraft('');
    void sendPrompt(liveId, text).catch(() => {});
  };

  const pending = stream.pending;

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: liveId ? `Session ${liveId}` : 'Chat' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        {loadError ? (
          <ThemedText type="small" style={styles.notice}>
            {loadError}
          </ThemedText>
        ) : null}

        <FlatList
          ref={listRef}
          data={stream.items}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <MessageRow item={item} />}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />

        {stream.statusText ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.status}>
            {stream.statusText}
          </ThemedText>
        ) : null}

        {pending ? (
          <View style={[styles.pendingBar, { backgroundColor: colors.backgroundElement }]}>
            <ThemedText type="smallBold">
              {pending.kind === 'approval' ? 'Approval requested' : `${pending.kind} requested`}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {String(
                pending.payload.prompt ??
                  pending.payload.message ??
                  pending.payload.question ??
                  pending.payload.command ??
                  '',
              )}
            </ThemedText>
            {pending.kind === 'approval' ? (
              <View style={styles.pendingActions}>
                <Pressable
                  style={[styles.pendingButton, { backgroundColor: colors.backgroundSelected }]}
                  onPress={() => liveId && void respondApproval(liveId, true).catch(() => {})}>
                  <ThemedText type="smallBold">Approve</ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.pendingButton, { backgroundColor: colors.backgroundSelected }]}
                  onPress={() => liveId && void respondApproval(liveId, false).catch(() => {})}>
                  <ThemedText type="smallBold">Deny</ThemedText>
                </Pressable>
              </View>
            ) : (
              <View style={styles.pendingActions}>
                <TextInput
                  style={[styles.pendingInput, { color: colors.text, backgroundColor: colors.background }]}
                  placeholder="Reply…"
                  placeholderTextColor={colors.textSecondary}
                  value={clarifyDraft}
                  onChangeText={setClarifyDraft}
                  onSubmitEditing={() => {
                    if (liveId && clarifyDraft.trim()) {
                      void respondClarify(liveId, clarifyDraft.trim()).catch(() => {});
                      setClarifyDraft('');
                    }
                  }}
                />
              </View>
            )}
          </View>
        ) : null}

        {attachedCount > 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.status}>
            📎 {attachedCount} image{attachedCount > 1 ? 's' : ''} attached to next message
          </ThemedText>
        ) : null}

        <View style={[styles.composer, { borderTopColor: colors.backgroundElement }]}>
          <Pressable
            style={[styles.sendButton, { backgroundColor: colors.backgroundElement }]}
            onPress={() => void pickAndAttach().catch(() => {})}
            disabled={!liveId}>
            <ThemedText type="smallBold">＋</ThemedText>
          </Pressable>
          <TextInput
            style={[styles.input, { color: colors.text, backgroundColor: colors.backgroundElement }]}
            placeholder={liveId ? 'Message Hermes…' : 'Connecting to session…'}
            placeholderTextColor={colors.textSecondary}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            editable={!!liveId}
            multiline
          />
          {stream.streaming ? (
            <Pressable
              style={[styles.sendButton, { backgroundColor: colors.backgroundSelected }]}
              onPress={() => liveId && void interrupt(liveId).catch(() => {})}>
              <ThemedText type="smallBold">■</ThemedText>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.sendButton, { backgroundColor: colors.backgroundSelected }]}
              onPress={submit}
              disabled={!draft.trim() || !liveId}>
              <ThemedText type="smallBold">↑</ThemedText>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.two },
  bubble: { borderRadius: 14, padding: Spacing.three, maxWidth: '85%' },
  userBubble: { alignSelf: 'flex-end' },
  assistantBlock: { paddingVertical: Spacing.one },
  thinking: { fontStyle: 'italic' },
  toolCard: { borderRadius: 10, padding: Spacing.two, gap: Spacing.one },
  toolHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  notice: { color: '#ef5350', paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  status: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.one },
  pendingBar: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  pendingActions: { flexDirection: 'row', gap: Spacing.two },
  pendingButton: {
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  pendingInput: { flex: 1, borderRadius: 8, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    maxHeight: 120,
    fontSize: 16,
  },
  sendButton: {
    borderRadius: 16,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
