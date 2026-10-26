// Requests tab: Incoming / Sent segments, each row a payment request with
// its status.
//
// TODO(Phase 5 — Requests): read `usePaykitState().paymentRequests`
// (refreshed every sync round), split by localRole, rows with the
// counterparty's seal, amount and status words; open RequestDetail.
import type { MainTabScreenProps } from '../../navigation/types';
import { EmptyState, Screen } from '../../ui';

export function RequestsScreen({ navigation }: MainTabScreenProps<'Requests'>) {
  return (
    <Screen title="Requests" edges={['top']} testID="requests-screen">
      <EmptyState
        title="No requests yet"
        message="Ask a contact for money. (Coming in Phase 5.)"
        action={{ label: 'Request money', onPress: () => navigation.navigate('RequestMoney') }}
      />
    </Screen>
  );
}
