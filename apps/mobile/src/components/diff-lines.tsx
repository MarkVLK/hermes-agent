import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

const ADD = '#2e7d32';
const DEL = '#c62828';
const ADD_BG = 'rgba(76, 175, 80, 0.12)';
const DEL_BG = 'rgba(239, 83, 80, 0.12)';

/** Colored unified-diff renderer (mobile take on desktop's diff-lines.tsx). */
export function DiffLines({ diff }: { diff: string }) {
  const lines = diff.replace(/\n+$/, '').split('\n');
  return (
    <ScrollView horizontal contentContainerStyle={styles.wrap}>
      <View>
        {lines.map((line, index) => {
          const added = line.startsWith('+') && !line.startsWith('+++');
          const removed = line.startsWith('-') && !line.startsWith('---');
          return (
            <View
              key={index}
              style={[styles.line, added && { backgroundColor: ADD_BG }, removed && { backgroundColor: DEL_BG }]}>
              <ThemedText
                type="code"
                style={[added && { color: ADD }, removed && { color: DEL }]}
                numberOfLines={1}>
                {line || ' '}
              </ThemedText>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: Spacing.one },
  line: { paddingHorizontal: Spacing.one },
});
