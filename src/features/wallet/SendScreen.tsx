// Send (modal): To (a person or an address) -> asset -> amount -> review
// fee -> sent.
//
// TODO(Phase 2 — Wallet): address sends: asset picker, amount field
// (parseAssetAmount), fee quote and review with useSend().quote(), then
// useSend().send() and a "Sent" state with the explorer link.
// TODO(Phase 3 — Public payments): when `to` is a pubky, resolve it with
// PaykitService.resolvePeer() and pay one of its public endpoints.
// TODO(Phase 4 — Private payments): for linked contacts, pay their private
// endpoints (src/paykit/privatePayments.ts).
import type { RootScreenProps } from '../../navigation/types';
import { SheetScreen, Text } from '../../ui';

export function SendScreen({ navigation, route }: RootScreenProps<'Send'>) {
  return (
    <SheetScreen title="Send" onClose={() => navigation.goBack()} testID="send-screen">
      <Text color="graphite">
        Coming in Phase 2.{route.params?.to ? ` Prefilled recipient: ${route.params.to.slice(0, 12)}…` : ''}
      </Text>
    </SheetScreen>
  );
}
