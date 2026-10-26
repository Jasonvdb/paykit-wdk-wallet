// Onboarding 3/5: connect the Pubky identity on the staging homeserver,
// then publish what peers need (Noise key authorization, app registry and
// public payment endpoints).
//
// Sign in or sign up is decided up front, never guessed from a failed
// sign-in (see src/paykit/session.ts for why):
// - a wallet created on this device has a brand-new identity: it signs up
//   with a single-use staging invite code;
// - a restored wallet signs in. If that phrase never had an identity, the
//   person says so explicitly and enters a code.
//
// The button shows each step ("Connecting your identity…", "Publishing
// your payment keys…"). A failed sign-up says which step failed
// (src/paykit/signUpErrors.ts): the server refused to create the identity
// (a used or mistyped code, or no connection; the SDK can't tell those
// apart), or the identity exists and only signing in is left, in which
// case the screen switches to Sign in so no second code is spent.
//
// A restored wallet can also bring back its contacts and requests: paste a
// backup made in You (src/paykit/backup.ts). It is opened with the
// recovery phrase and restored as part of signing in, before anything
// else is written, because Paykit restores only into an identity with no
// state on this phone yet.
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { demoPrefill } from '../../config/demo';
import type { OnboardingScreenProps } from '../../navigation/types';
import { describeError, identityExistsAfter, looksLikeBackup, signUpFailureMessage, signUpFailureOf, usePaykit, userMessageFor } from '../../paykit';
import { walletOrigin } from '../../settings/appSettings';
import { Button, Input, Screen, Text, space } from '../../ui';

export function InviteCodeScreen({ navigation }: OnboardingScreenProps<'InviteCode'>) {
  const { connect, log } = usePaykit();
  const [isNewIdentity, setIsNewIdentity] = useState(() => walletOrigin() === 'created');
  const [code, setCode] = useState(demoPrefill.signupCode ?? '');
  const [step, setStep] = useState<string>();
  const [error, setError] = useState<string>();
  const [backup, setBackup] = useState<string>();
  const [backupNote, setBackupNote] = useState<string>();

  const pasteBackup = async () => {
    const text = await Clipboard.getStringAsync();
    if (!looksLikeBackup(text)) {
      setBackupNote("The clipboard doesn't hold a backup. Copy the whole backup text, then paste again.");
      return;
    }
    setBackup(text);
    setBackupNote(undefined);
  };

  const signupCode = isNewIdentity ? code.trim() : undefined;

  const onConnect = async () => {
    setError(undefined);
    let connected = false;
    try {
      setStep('Connecting your identity…');
      const service = await connect({ signupCode, restoreBackup: isNewIdentity ? undefined : backup });
      connected = true;
      setStep('Publishing your payment keys…');
      await service.setUpIdentity();
      navigation.navigate('YourName');
    } catch (e) {
      if (connected) {
        log.error(`set up identity: ${describeError(e)}`);
        setError(userMessageFor(e, "Couldn't publish your payment keys. Try again."));
      } else if (isNewIdentity) {
        log.error(`sign up: ${describeError(e)}`);
        const failure = signUpFailureOf(e);
        if (identityExistsAfter(failure)) setIsNewIdentity(false);
        setError(signUpFailureMessage(failure) ?? userMessageFor(e, "Couldn't create your identity. Check the invite code; each one works only once."));
      } else {
        log.error(`sign in: ${describeError(e)}`);
        setError(userMessageFor(e, "Couldn't sign in. Try again in a minute."));
      }
    } finally {
      setStep(undefined);
    }
  };

  return (
    <Screen
      scroll
      title="Your identity"
      footer={
        <Button
          label={isNewIdentity ? 'Create my identity' : 'Sign in'}
          onPress={onConnect}
          loading={step !== undefined}
          disabled={isNewIdentity && !signupCode}
          testID="connect-identity"
        />
      }
    >
      <View style={styles.body}>
        <Text color="graphite">
          Your recovery phrase also creates a Pubky identity: a public key people can pay. It lives on Pubky’s staging
          server.
        </Text>
        {isNewIdentity ? (
          <Input
            label="Invite code"
            value={code}
            onChangeText={setCode}
            placeholder="XXXX-XXXX-XXXX"
            secret
            secureTextEntry
            hint="A new identity needs a staging invite code. Each code works once."
            testID="invite-code"
          />
        ) : (
          <>
            <Text color="graphite">This wallet was restored, so it signs in to the identity it already has.</Text>
            <Button
              label="This phrase has no identity yet"
              variant="secondary"
              compact
              onPress={() => setIsNewIdentity(true)}
              testID="use-invite-code"
            />
            <View style={styles.backup}>
              <Text variant="bodyStrong">Contacts and requests</Text>
              {backup ? (
                <>
                  <Text color="seal" testID="backup-pasted">
                    Backup pasted. It is opened with your recovery phrase and restored when you sign in.
                  </Text>
                  <Button label="Don't restore it" variant="secondary" compact onPress={() => setBackup(undefined)} testID="backup-remove" />
                </>
              ) : (
                <>
                  <Text color="graphite">
                    If you backed them up in the You tab, paste that backup to bring them back. Without it you start with no contacts.
                  </Text>
                  <Button label="Paste a backup" variant="secondary" compact onPress={() => void pasteBackup()} testID="backup-paste" />
                </>
              )}
              {backupNote ? <Text color="alert">{backupNote}</Text> : null}
            </View>
          </>
        )}
        {step ? <Text color="seal">{step}</Text> : null}
        {error ? <Text color="alert">{error}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
  backup: { gap: space.s, alignItems: 'flex-start' },
});
