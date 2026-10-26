// Request money (modal): person -> asset -> amount -> note, expiry, repeat.
//
// Phase 4 opens it from a Person's page with them filled in (`pubky`), so
// the slot shows who the request is for.
//
// TODO(Phase 5 — Requests): only linked contacts can receive requests;
// build FfiPaymentRequestTerms in src/paykit/requests.ts (amounts via
// toPaykitDecimal), propose, flush the sync loop, show "Waiting for {name}
// to pay" / "queued, will send automatically".
import { StyleSheet, View } from 'react-native';

import type { RootScreenProps } from '../../navigation/types';
import { SheetScreen, Text, space } from '../../ui';
import { PersonHeader } from '../wallet/send/PersonRecipient';

export function RequestMoneyScreen({ navigation, route }: RootScreenProps<'RequestMoney'>) {
  const pubky = route.params?.pubky;
  return (
    <SheetScreen title="Request money" onClose={() => navigation.goBack()} testID="request-money-screen">
      <View style={styles.body}>
        {pubky ? <PersonHeader publicKey={pubky} sealSize={44} /> : null}
        <Text color="graphite">Coming in Phase 5.</Text>
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.l },
});
