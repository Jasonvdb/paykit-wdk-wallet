// Onboarding 3/5: connect the Pubky identity on the staging homeserver.
//
// Restored identities sign in without a code. A new identity needs a
// single-use staging invite code; it is only used if sign-in fails, so a
// restore never burns one. After connecting, publish what peers need
// (Noise key authorization + app registry).
//
// Functional for Phase 1. Dev builds prefill the code from demo.local.ts.
//
// TODO(Phase 2 — Wallet): progress steps ("Deriving your keys…",
// "Connecting…"), map signup errors (token used / required / invalid) to
// plain words, optional Homegate self-serve invite.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { demoPrefill } from '../../config/demo';
import type { OnboardingScreenProps } from '../../navigation/types';
import { describeError, usePaykit } from '../../paykit';
import { Button, Input, Screen, Text, space } from '../../ui';

export function InviteCodeScreen({ navigation }: OnboardingScreenProps<'InviteCode'>) {
  const { connect } = usePaykit();
  const [code, setCode] = useState(demoPrefill.signupCode ?? '');
  const [step, setStep] = useState<string>();
  const [error, setError] = useState<string>();

  const onConnect = async () => {
    setError(undefined);
    try {
      setStep('Connecting your identity…');
      const service = await connect({ signupCode: code.trim() || undefined });
      setStep('Publishing your Paykit keys…');
      await service.setUpIdentity();
      navigation.navigate('YourName');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setStep(undefined);
    }
  };

  return (
    <Screen
      scroll
      title="Your identity"
      footer={<Button label="Connect" onPress={onConnect} loading={step !== undefined} testID="connect-identity" />}
    >
      <View style={styles.body}>
        <Text color="graphite">
          Your recovery phrase also creates a Pubky identity: a public key people can pay. It lives on Pubky’s staging
          server.
        </Text>
        <Input
          label="Invite code"
          value={code}
          onChangeText={setCode}
          placeholder="XXXX-XXXX-XXXX"
          secret
          hint="Only needed for a new identity. A restored wallet signs in without one."
          error={error}
          testID="invite-code"
        />
        {step ? <Text color="seal">{step}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
});
