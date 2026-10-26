// A recovery phrase as a numbered grid of words, three per row.
//
// The words are a secret. Callers fetch them only when the person asked to
// see them, keep them out of logs and the clipboard, and drop them when the
// app leaves the foreground (see src/features/you/RecoveryPhraseSection.tsx).
// The words use the text face, not mono: they are read and written down,
// not compared character by character.
import { StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { space } from './theme';

export function RecoveryWords({ words, testID }: { words: string[]; testID?: string }) {
  return (
    <View style={styles.grid} testID={testID}>
      {words.map((word, index) => (
        <View key={index} style={styles.word}>
          <Text variant="caption" color="graphite" style={styles.number}>
            {index + 1}
          </Text>
          <Text variant="bodyStrong">{word}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.s, alignSelf: 'stretch' },
  word: { width: '33.33%', flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  number: { minWidth: 20, textAlign: 'right' },
});
