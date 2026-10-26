// Onboarding 5/5: your seal and pubky, then into the app.
//
// Finishing sets the onboarding flag; the root navigator then swaps the
// onboarding stack for the tabs and Paykit reconnects automatically on
// later launches.
//
// TODO(Phase 3 — Identity): "Add someone" (opens Add person after the
// switch), share your pay-me code / QR.
import { StyleSheet, View } from 'react-native';

import { useOnboardingComplete } from '../../settings/appSettings';
import type { OnboardingScreenProps } from '../../navigation/types';
import { usePaykitService } from '../../paykit';
import { Button, KeyText, Screen, Text, space } from '../../ui';
import { PersonSeal } from '../people/PersonSeal';

export function ReadyScreen(_props: OnboardingScreenProps<'Ready'>) {
  const service = usePaykitService();
  const [, setOnboarded] = useOnboardingComplete();

  return (
    <Screen footer={<Button label="Go to wallet" onPress={() => setOnboarded(true)} testID="go-to-wallet" />}>
      <View style={styles.body}>
        {service ? <PersonSeal pubky={service.publicKey} size={120} /> : null}
        <Text variant="title">You’re ready.</Text>
        <Text color="graphite">This is your seal. It is drawn from your public key, so it looks the same on every phone.</Text>
        {service ? <KeyText value={service.publicKey} full /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl, paddingTop: space.xxl },
});
