// Activity detail (pushed): one on-chain transaction, or later a Paykit
// request/receipt, with amount, fee, status, counterparty and explorer link.
//
// TODO(Phase 2 — Wallet): look the item up in useActivity() by
// `activityId`, show amount (AssetAmount size="hero"), fee, status,
// counterparty address (KeyText) and transactionUrl().
// TODO(Phase 5 — Requests): link to the payment request and receipt.
import type { RootScreenProps } from '../../navigation/types';
import { PushedScreen, Text } from '../../ui';

export function ActivityDetailScreen({ navigation }: RootScreenProps<'ActivityDetail'>) {
  return (
    <PushedScreen title="Activity" onBack={() => navigation.goBack()}>
      <Text color="graphite">Coming in Phase 2.</Text>
    </PushedScreen>
  );
}
