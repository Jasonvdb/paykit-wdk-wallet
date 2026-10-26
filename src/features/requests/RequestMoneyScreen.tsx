// Request money (modal): person -> asset -> amount -> note, expiry, repeat.
//
// TODO(Phase 5 — Requests): only linked contacts can receive requests;
// build FfiPaymentRequestTerms in src/paykit/requests.ts (amounts via
// toPaykitDecimal), propose, flush the sync loop, show "Waiting for {name}
// to pay" / "queued, will send automatically".
import type { RootScreenProps } from '../../navigation/types';
import { SheetScreen, Text } from '../../ui';

export function RequestMoneyScreen({ navigation }: RootScreenProps<'RequestMoney'>) {
  return (
    <SheetScreen title="Request money" onClose={() => navigation.goBack()} testID="request-money-screen">
      <Text color="graphite">Coming in Phase 5.</Text>
    </SheetScreen>
  );
}
