// You > Recovery phrase: show the 12 or 24 words that restore this wallet
// and its Pubky identity, behind a confirmation.
//
// Handling the phrase:
// - read from WDK's encrypted seed only after the person confirms;
// - held in component state while shown, dropped on "Hide", when the app
//   leaves the foreground (so the app-switcher snapshot does not carry it)
//   and when the screen unmounts;
// - never logged, never copied to the clipboard (other apps can read it),
//   and the error path shows a fixed message, never the thrown error.
import { useEffect, useState } from 'react';
import { Alert, AppState, StyleSheet, View } from 'react-native';

import { Button, Text, space } from '../../ui';
import { useWalletLifecycle } from '../../wallet';

function confirmReveal(): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      'Show your recovery phrase?',
      'Anyone who sees these words can take this wallet and its identity. Check that nobody is watching and nothing is recording the screen.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Show', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

export function RecoveryPhraseSection() {
  const { getMnemonic } = useWalletLifecycle();
  const [words, setWords] = useState<string[]>();
  const [error, setError] = useState<string>();

  // Hide as soon as the app is no longer in front.
  useEffect(() => {
    if (!words) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') setWords(undefined);
    });
    return () => subscription.remove();
  }, [words]);

  const onReveal = async () => {
    setError(undefined);
    if (!(await confirmReveal())) return;
    try {
      setWords((await getMnemonic()).split(' '));
    } catch {
      setError("Couldn't read the recovery phrase from this device.");
    }
  };

  return (
    <View style={styles.root}>
      <Text color="graphite" variant="secondary">
        These words restore your Bitcoin and Ethereum keys and your Pubky identity. Write them down and keep them offline.
      </Text>
      {words ? (
        <>
          <View style={styles.grid} testID="recovery-words">
            {words.map((word, index) => (
              <View key={index} style={styles.word}>
                <Text variant="caption" color="graphite" style={styles.number}>
                  {index + 1}
                </Text>
                <Text variant="bodyStrong">{word}</Text>
              </View>
            ))}
          </View>
          <Button label="Hide recovery phrase" variant="secondary" compact onPress={() => setWords(undefined)} testID="hide-phrase" />
        </>
      ) : (
        <Button label="Show recovery phrase" variant="secondary" compact onPress={onReveal} testID="show-phrase" />
      )}
      {error ? <Text color="alert">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.m, alignItems: 'flex-start' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.s, alignSelf: 'stretch' },
  word: { width: '33.33%', flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  number: { minWidth: 20, textAlign: 'right' },
});
