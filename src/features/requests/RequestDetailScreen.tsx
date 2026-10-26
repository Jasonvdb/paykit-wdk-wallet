// Request detail (pushed): amount, asset, note, due date, recurring
// schedule, and a vertical status timeline:
// Requested -> Accepted -> Paid (proof) -> Verified -> Receipt.
//
// TODO(Phase 5 — Requests): look up the record by `counterparty` +
// `requestId`, actions (accept and pay, decline, cancel), proof, on-chain
// verification and receipt. Keep request, payment, proof and verification
// statuses separate: a submitted proof is not a settlement.
import type { RootScreenProps } from '../../navigation/types';
import { PushedScreen, Text } from '../../ui';

export function RequestDetailScreen({ navigation }: RootScreenProps<'RequestDetail'>) {
  return (
    <PushedScreen title="Request" onBack={() => navigation.goBack()}>
      <Text color="graphite">Coming in Phase 5.</Text>
    </PushedScreen>
  );
}
