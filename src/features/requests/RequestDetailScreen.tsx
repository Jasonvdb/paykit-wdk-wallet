// Request detail (pushed): amount, asset, note, due date, recurring
// schedule, and a vertical status timeline:
// Requested -> Accepted -> Paid (proof) -> Verified -> Receipt.
//
// TODO(Phase 5 — Requests): look up the record by `counterparty` +
// `requestId`, actions (accept and pay, decline, cancel), proof, on-chain
// verification and receipt. Keep request, payment, proof and verification
// statuses separate: a submitted proof is not a settlement.
import type { RootScreenProps } from '../../navigation/types';
import { Button, Screen, Text } from '../../ui';

export function RequestDetailScreen({ navigation }: RootScreenProps<'RequestDetail'>) {
  return (
    <Screen title="Request" footer={<Button label="Back" variant="secondary" onPress={() => navigation.goBack()} />}>
      <Text color="graphite">Coming in Phase 5.</Text>
    </Screen>
  );
}
