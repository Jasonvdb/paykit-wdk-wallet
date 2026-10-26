// Onboarding 1/5: what this app is.
//
// TODO(Phase 2 — Wallet): final copy and illustration (e.g. a large seal
// built from a sample key). Navigation is already wired.
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
