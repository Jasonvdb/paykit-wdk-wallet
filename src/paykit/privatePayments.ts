// EXTENSION POINT — Phase 4 (contacts and private payments) fills this in.
//
// What belongs here:
// - Share our private payment list with each Linked contact: their own BTC
//   account address + the shared USD₮ address. Use
//   `reservationInputsFor(service.addressCache, peer)` (./paymentAdapter.ts)
//   with `syncPrivatePaymentListsWithReservationsAndProcessOutbound`
//   (it returns undefined until both addresses are cached: skip that
//   contact this round, never send an empty list), and re-share when a contact's BTC address is first derived or a link
//   becomes Linked. Register that as a sync loop hook inside
//   registerPrivatePaymentHooks below (PaykitService.connect calls it once
//   per service, before the loop starts):
//     service.syncLoop.addRoundHook('private-payment-lists', async (ctx) => { ... })
// - Pay a contact privately: `prepareAndResolvePrivateContactPayment`, then
//   send with the wallet service (src/wallet/useSend.ts). The adapter's
//   select/build callbacks already validate peers' payloads.
// - Read what a contact shared with us: `currentPrivatePaymentLists`.
//
// Run every SDK call through `service.call(label, task)` so it stays in
// the serialized queue, and flush the loop (`service.syncLoop.flush()`)
// after a user action. Keep private messages under 1000 bytes
// (PRIVATE_MESSAGE_LIMIT_BYTES in ./endpoints.ts).
import type { PaykitService } from './PaykitService';

/** Called once per connected service, before the sync loop starts. Phase 4 adds its round hooks here. */
export function registerPrivatePaymentHooks(_service: PaykitService): void {
  // Phase 4.
}
