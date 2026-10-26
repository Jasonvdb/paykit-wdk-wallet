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
// your payment keys…"). Sign-up failures share one message that names the
// usual cause (a used or mistyped invite code); telling "used" from
// "invalid" needs the homeserver's error codes, which the SDK does not
// expose as tags yet.
// TODO(Phase 6 — Polish): distinct messages per sign-up error once the SDK
// reports them, and an optional Homegate self-serve invite.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { demoPrefill } from '../../config/demo';
import type { OnboardingScreenProps } from '../../navigation/types';
import { describeError, usePaykit, userMessageFor } from '../../paykit';
import { walletOrigin } from '../../settings/appSettings';
import { Button, Input, Screen, Text, space } from '../../ui';

export function InviteCodeScreen({ navigation }: OnboardingScreenProps<'InviteCode'>) {
  const { connect, log } = usePaykit();
  const [isNewIdentity, setIsNewIdentity] = useState(() => walletOrigin() === 'created');
  const [code, setCode] = useState(demoPrefill.signupCode ?? '');
  const [step, setStep] = useState<string>();
  const [error, setError] = useState<string>();

  const signupCode = isNewIdentity ? code.trim() : undefined;

  const onConnect = async () => {
    setError(undefined);
    let connected = false;
    try {
      setStep('Connecting your identity…');
      const service = await connect({ signupCode });
      connected = true;
      setStep('Publishing your payment keys…');
      await service.setUpIdentity();
      navigation.navigate('YourName');
    } catch (e) {
      if (connected) {
        log.error(`set up identity: ${describeError(e)}`);
        setError(userMessageFor(e, "Couldn't publish your payment keys. Try again."));
      } else {
        setError(
          userMessageFor(
            e,
            isNewIdentity
              ? "Couldn't create your identity. Check the invite code; each one works only once."
              : "Couldn't sign in. Try again in a minute.",
          ),
        );
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
});
