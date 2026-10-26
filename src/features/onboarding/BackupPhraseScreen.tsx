// Onboarding, after "Create a new wallet": write the new recovery phrase
// down before going on. It is the only backup of the wallet and of the
// Pubky identity it creates.
//
// The words appear only after a tap (someone may be looking), and are
// dropped when the app leaves the foreground (useForegroundSecret). They are
// never logged or copied. Restored wallets skip this step: their owner
// already has the phrase.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { OnboardingScreenProps } from '../../navigation/types';
import { Button, RecoveryWords, Screen, Text, space, useForegroundSecret } from '../../ui';
import { useWalletLifecycle } from '../../wallet';

export function BackupPhraseScreen({ navigation }: OnboardingScreenProps<'BackupPhrase'>) {
  const { getMnemonic } = useWalletLifecycle();
  const [words, setWords] = useForegroundSecret<string[]>();
  const [seen, setSeen] = useState(false);
  const [error, setError] = useState<string>();

  const onShow = async () => {
    setError(undefined);
    try {
      setWords((await getMnemonic()).split(' '));
      setSeen(true);
    } catch {
      setError("Couldn't read the new recovery phrase. Try again.");
    }
  };

  return (
    <Screen
      scroll
      title="Your recovery phrase"
      footer={
        <Button
          label="I wrote it down"
          onPress={() => {
            setWords(undefined);
            navigation.navigate('InviteCode');
          }}
          disabled={!seen}
          testID="backup-done"
        />
      }
    >
      <View style={styles.body}>
        <Text color="graphite">
          These words are the only way to get this wallet and your Pubky identity back. Write them down on paper, in order, and
          keep them somewhere safe. Anyone who has them can take both.
        </Text>
        {words ? (
          <RecoveryWords words={words} testID="backup-words" />
        ) : (
          <Button label={seen ? 'Show the words again' : 'Show my recovery phrase'} variant="secondary" compact onPress={onShow} testID="backup-show" />
        )}
        {error ? <Text color="alert">{error}</Text> : null}
        <Text variant="caption" color="graphite">
          This is a testnet wallet. Never put real funds on a phrase shown by a demo app.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl, alignItems: 'flex-start' },
});
