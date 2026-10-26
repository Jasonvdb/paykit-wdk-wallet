// Onboarding 5/5: your seal, then your pay-me code (pubky as a QR, copy,
// share), then into the app.
//
// Finishing sets the onboarding flag; the root navigator then swaps the
// onboarding stack for the tabs and Paykit reconnects automatically on
// later launches. Adding someone happens from People (its empty state
// offers "Add person"), because the tab routes only exist after the
// switch. After a restore from a backup it says what came back.
import { StyleSheet, View } from 'react-native';

import { useOnboardingComplete } from '../../settings/appSettings';
import type { OnboardingScreenProps } from '../../navigation/types';
import { backupSummaryWords, usePaykitService } from '../../paykit';
import { Button, Screen, Text, space } from '../../ui';
import { PersonSeal } from '../people/PersonSeal';
import { PayMeCode } from '../wallet/receive/PayMeCode';

export function ReadyScreen(_props: OnboardingScreenProps<'Ready'>) {
  const service = usePaykitService();
  const [, setOnboarded] = useOnboardingComplete();
  const restored = service?.restoredFromBackup;
  // A backup can be older than your last payment (src/paykit/restoreReview.ts).
  const restoredWords = !restored
    ? undefined
    : [
        restored.payerRequestKeys.length > 0 || restored.paysAutomatically ? 'Anything you paid after the backup was made isn’t in it.' : undefined,
        restored.payerRequestKeys.length > 0 ? 'Requests from the backup are paid by hand: check Activity before you pay one.' : undefined,
        restored.paysAutomatically ? 'Automatic payments are paused until you check Activity and resume them in You.' : undefined,
      ]
        .filter(Boolean)
        .join(' ') || undefined;

  return (
    <Screen scroll footer={<Button label="Go to wallet" onPress={() => setOnboarded(true)} testID="go-to-wallet" />}>
      <View style={styles.body}>
        {service ? <PersonSeal pubky={service.publicKey} size={120} /> : null}
        <Text variant="title">You’re ready.</Text>
        <Text color="graphite">This is your seal. It is drawn from your public key, so it looks the same on every phone.</Text>
        {service?.restoredFromBackup ? (
          <Text color="seal" testID="ready-restored">
            {`Restored from your backup: ${backupSummaryWords(service.restoredFromBackup)}. Private connections form again once your contacts' phones are online.`}
          </Text>
        ) : null}
        {restoredWords ? (
          <Text color="graphite" testID="ready-restored-requests">
            {restoredWords}
          </Text>
        ) : null}
        <Text color="graphite">Share your pay-me code so people can pay you or add you.</Text>
        {service ? <PayMeCode qrSize={168} showHeading={false} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl, paddingTop: space.xxl },
});
