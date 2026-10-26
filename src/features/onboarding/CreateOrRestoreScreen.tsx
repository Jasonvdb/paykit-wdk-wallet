// Onboarding 2/5: create a new wallet, restore one from a phrase, or keep the
// wallet already on this device (an onboarding that was not finished).
//
// Functional for Phase 1 so the demo identities can be restored. Dev builds
// prefill the phrase from the git-ignored src/config/demo.local.ts.
//
// TODO(Phase 2 — Wallet): show the new phrase after "Create" (with a "write
// it down" step), paste button, word-count feedback, nicer errors.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { demoPrefill } from '../../config/demo';
import type { OnboardingScreenProps } from '../../navigation/types';
import { Button, Divider, Input, Screen, Text, space } from '../../ui';
import { useWalletLifecycle } from '../../wallet';

export function CreateOrRestoreScreen({ navigation }: OnboardingScreenProps<'CreateOrRestore'>) {
  const wallet = useWalletLifecycle();
  const [phrase, setPhrase] = useState(demoPrefill.mnemonic ?? '');
  const [busy, setBusy] = useState<'create' | 'restore' | null>(null);
  const [error, setError] = useState<string>();

  const run = async (kind: 'create' | 'restore', task: () => Promise<void>) => {
    setBusy(kind);
    setError(undefined);
    try {
      await task();
      navigation.navigate('InviteCode');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const hasWallet = wallet.status === 'ready';

  return (
    <Screen scroll title="Your wallet">
      <View style={styles.section}>
        {hasWallet ? (
          <>
            <Text color="graphite">This device already has a wallet that hasn’t finished setting up.</Text>
            <Button label="Continue with this wallet" onPress={() => navigation.navigate('InviteCode')} testID="continue-wallet" />
          </>
        ) : (
          <>
            <Text color="graphite">One recovery phrase holds your Bitcoin and Ethereum keys and your Pubky identity.</Text>
            <Button
              label="Create a new wallet"
              onPress={() => run('create', wallet.createWallet)}
              loading={busy === 'create'}
              disabled={busy !== null}
              testID="create-wallet"
            />
          </>
        )}
      </View>
      <Divider style={styles.divider} />
      <View style={styles.section}>
        <Text variant="heading">Restore from a recovery phrase</Text>
        <Input
          label="Recovery phrase"
          value={phrase}
          onChangeText={setPhrase}
          placeholder="12 or 24 words"
          multiline
          secret
          error={error}
          testID="restore-phrase"
        />
        <Button
          label={hasWallet ? 'Replace with this phrase' : 'Restore'}
          variant="secondary"
          onPress={() => run('restore', () => wallet.restoreWallet(phrase))}
          loading={busy === 'restore'}
          disabled={busy !== null || !wallet.isValidMnemonic(phrase)}
          testID="restore-wallet"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.l },
  divider: { marginVertical: space.xl },
});
