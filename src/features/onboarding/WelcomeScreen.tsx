// Onboarding 1/5: what this app is. The only main-UI screen that names
// the SDKs (docs/DESIGN.md, "Writing"): this app exists to show them.
//
// TODO(Phase 6 — Polish): final copy and illustration (e.g. a larger seal
// animation). The sample seal and the copy below are the Phase 2 version.
import { StyleSheet, View } from 'react-native';

import type { OnboardingScreenProps } from '../../navigation/types';
import { Button, Screen, Seal, Text, space } from '../../ui';

const SAMPLE_KEY = 'pubky8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo';

export function WelcomeScreen({ navigation }: OnboardingScreenProps<'Welcome'>) {
  return (
    <Screen footer={<Button label="Get started" onPress={() => navigation.navigate('CreateOrRestore')} testID="welcome-start" />}>
      <View style={styles.body}>
        <Seal pubky={SAMPLE_KEY} size={96} ring="linked" />
        <Text variant="title">A testnet wallet where you pay people, not addresses.</Text>
        <Text color="graphite">
          Tether WDK holds your keys and moves the money. Pubky Paykit turns people into payable contacts.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl, paddingTop: space.xxl },
});
