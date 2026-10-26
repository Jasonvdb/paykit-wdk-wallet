// Onboarding 2/5: create a new wallet, restore one from a phrase, or keep the
// wallet already on this device.
//
// A wallet can already be here for two reasons: an onboarding that was not
// finished, or an earlier install of this app (iOS keeps Keychain items, so
// WDK's seed survives an uninstall). It may hold funds either way, so
// replacing it asks first.
//
// Replacing also deletes the saved Pubky session secret: it is a live
// credential for the old identity. The old identity's encrypted Paykit files
// stay (keyed by its pubky), so restoring that phrase later keeps its links.
//
// Dev builds can restore the git-ignored demo phrase (src/config/demo.ts)
// without it ever being put on screen.
//
// Paste reads the phrase from the clipboard and then empties the clipboard
// (the app's rule: a phrase never stays where other apps, or clipboard
// sync, can read it), and says so under the field.
//
// "Create" continues to BackupPhrase (write the new phrase down). A wallet
// that is about to be replaced can show its phrase first, so its funds are
// not lost by accident.
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { demoPrefill } from '../../config/demo';
import type { OnboardingScreenProps } from '../../navigation/types';
import { clearSessionSecret } from '../../paykit';
import { setWalletOrigin } from '../../settings/appSettings';
import { Button, Divider, Input, Screen, Text, space } from '../../ui';
import { normalizeMnemonic, useWalletLifecycle } from '../../wallet';
import { RecoveryPhraseSection } from '../you/RecoveryPhraseSection';

/** "7 of 12 words", or a hint when the words do not form a phrase. */
function phraseHint(text: string, valid: boolean): string | undefined {
  const count = normalizeMnemonic(text).split(' ').filter(Boolean).length;
  if (count === 0) return undefined;
  if (valid) return `${count} words. Looks right.`;
  if (count === 12 || count === 24) return 'These words do not form a valid phrase. Check the spelling and the order.';
  return `${count} of ${count > 12 ? 24 : 12} words`;
}

/** Ask before deleting the wallet on this device. Resolves true to go ahead. */
function confirmReplace(): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      'Replace the wallet on this device?',
      'The wallet on this device will be deleted. If it holds funds, you can only get them back with its recovery phrase.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Replace', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

export function CreateOrRestoreScreen({ navigation }: OnboardingScreenProps<'CreateOrRestore'>) {
  const wallet = useWalletLifecycle();
  // The demo phrase is used directly and never shown, so it cannot end up in
  // a screenshot or the app-switcher snapshot.
  const [useDemoPhrase, setUseDemoPhrase] = useState(demoPrefill.mnemonic !== undefined);
  const [typedPhrase, setTypedPhrase] = useState('');
  const [clipboardCleared, setClipboardCleared] = useState(false);

  const pastePhrase = async () => {
    const pasted = (await Clipboard.getStringAsync()) ?? '';
    setTypedPhrase(pasted);
    // Anything shaped like a phrase leaves the clipboard, typos included.
    const words = normalizeMnemonic(pasted).split(' ').filter(Boolean).length;
    if (words >= 12) {
      await Clipboard.setStringAsync('');
      setClipboardCleared(true);
    }
  };
  const [busy, setBusy] = useState<'create' | 'restore' | null>(null);
  const [error, setError] = useState<string>();

  const hasWallet = wallet.status === 'ready';
  const phrase = useDemoPhrase ? (demoPrefill.mnemonic ?? '') : typedPhrase;

  const onCreate = async () => {
    setBusy('create');
    setError(undefined);
    try {
      await wallet.createWallet();
      setWalletOrigin('created');
      navigation.navigate('BackupPhrase');
    } catch {
      setError("Couldn't create the wallet. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const onRestore = async () => {
    if (hasWallet && !(await confirmReplace())) return;
    setBusy('restore');
    setError(undefined);
    try {
      await wallet.restoreWallet(phrase);
      setWalletOrigin('restored');
      if (hasWallet) await clearSessionSecret();
      navigation.navigate('InviteCode');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen scroll title="Your wallet">
      <View style={styles.section}>
        {hasWallet ? (
          <>
            <Text color="graphite">
              This device already has a wallet, from an unfinished setup or an earlier install of this app.
            </Text>
            <Button label="Continue with this wallet" onPress={() => navigation.navigate('InviteCode')} testID="continue-wallet" />
            <RecoveryPhraseSection />
          </>
        ) : (
          <>
            <Text color="graphite">One recovery phrase holds your Bitcoin and Ethereum keys and your Pubky identity.</Text>
            <Button
              label="Create a new wallet"
              onPress={onCreate}
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
        {useDemoPhrase ? (
          <>
            <Text color="graphite" testID="demo-phrase-note">
              Dev build: restores this device’s demo phrase from demo.local.ts. It is not shown on screen.
            </Text>
            <Button label="Type a different phrase" variant="secondary" compact onPress={() => setUseDemoPhrase(false)} />
            {error ? <Text color="alert">{error}</Text> : null}
          </>
        ) : (
          <Input
            label="Recovery phrase"
            value={typedPhrase}
            onChangeText={setTypedPhrase}
            placeholder="12 or 24 words"
            multiline
            secret
            error={error}
            hint={
              [phraseHint(typedPhrase, wallet.isValidMnemonic(typedPhrase)), clipboardCleared ? 'Removed from the clipboard.' : undefined]
                .filter(Boolean)
                .join(' ') || undefined
            }
            accessory={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Paste"
                hitSlop={8}
                onPress={() => void pastePhrase()}
                testID="paste-phrase"
              >
                <Text variant="bodyStrong" color="seal">
                  Paste
                </Text>
              </Pressable>
            }
            testID="restore-phrase"
          />
        )}
        <Button
          label={hasWallet ? 'Replace with this phrase' : 'Restore'}
          variant="secondary"
          onPress={onRestore}
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
