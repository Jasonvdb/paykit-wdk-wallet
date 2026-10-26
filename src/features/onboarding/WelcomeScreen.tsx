// Onboarding 1/5: what this app is. The only main-UI screen that names
// the SDKs (docs/DESIGN.md, "Writing"): this app exists to show them.
//
// The illustration is two people's seals forming a private connection:
// their rings start dashed and rotating, then close with the app's one
// orchestrated animation (src/ui/seal/Seal.tsx). It plays once, a moment
// after the screen opens, so the first thing a person sees is what the
// seal ring means. With reduce motion on, the rings close without
// rotating. The two keys are fixed samples, not real identities.
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { OnboardingScreenProps } from '../../navigation/types';
import { Button, Screen, Seal, Text, space, type SealRing } from '../../ui';

const SAMPLE_KEYS = [
  'pubky8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo',
  'pubky3rsduhcxpw74snwyct86m38c63j3pq8x4ycqikxg64roik8yw37y',
] as const;

/** How long the rings stay dashed before they close. */
const LINK_FORMS_AFTER_MS = 1_400;

const SEAL_SIZE = 112;

export function WelcomeScreen({ navigation }: OnboardingScreenProps<'Welcome'>) {
  const [ring, setRing] = useState<SealRing>('linking');
  useEffect(() => {
    const timer = setTimeout(() => setRing('linked'), LINK_FORMS_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Screen scroll footer={<Button label="Get started" onPress={() => navigation.navigate('CreateOrRestore')} testID="welcome-start" />}>
      <View style={styles.body}>
        <View style={styles.seals} accessible accessibilityLabel="Two people's seals. Their rings close when they connect privately.">
          {SAMPLE_KEYS.map((key) => (
            <Seal key={key} pubky={key} size={SEAL_SIZE} ring={ring} />
          ))}
        </View>
        <Text variant="title">A testnet wallet where you pay people, not addresses.</Text>
        <Text>
          Add someone once, by their key or their code, and the wallet works out where to pay them. The ring around their seal closes when
          the two of you have a private connection.
        </Text>
        <Text color="graphite">
          This reference app shows two libraries working together. Tether WDK holds your keys and moves the money. Pubky Paykit turns
          people into payable contacts: private addresses, payment requests, receipts and automatic payments.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl, paddingTop: space.xl },
  seals: { flexDirection: 'row', gap: space.l, paddingVertical: space.m },
});
