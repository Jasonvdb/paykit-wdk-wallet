// Private payments: Private Payment Lists shared over the Encrypted Link,
// and paying a contact at the private address they shared with you.
//
// How the two SDKs meet here:
//
//   our side    WDK derives one Bitcoin account per contact (account 1, 2, …)
//               plus the shared EVM account 0. The address cache holds them
//               (./addressCache.ts). Every sync round, a hook shares that
//               contact's list with them once the link is Linked:
//                 reservationInputsFor(cache, peer)        (./paymentAdapter.ts)
//                 -> syncPrivatePaymentListsWithReservationsAndProcessOutbound
//               The list is sent again only when it or the link changes
//               (./privatePaymentLists.ts decides). `clearUnlistedLinkedPeers`
//               is false: a contact skipped this round (an address not
//               derived yet) must keep the list they have, not get an empty one.
//
//   their side  the SDK stores the lists contacts send us. A second hook
//               reads them with `currentPrivatePaymentLists` when a contact
//               sent us something (or every few minutes), so screens can say
//               "Private addresses shared with you" and put names on
//               activity rows.
//
//   paying      privatePaymentAddressesFor (the Send screen asks it before
//               public endpoints) calls `prepareAndResolvePrivateContactPayment`:
//               the SDK advances the link, receives and sends pending
//               private messages for that one contact, then resolves only
//               their Private Payment List through our adapter's private
//               select/build callbacks. It never falls back to public
//               endpoints; this app does, when no private list is payable.
//               The wallet then sends on chain with useSend, as for any
//               address.
//
// What the SDK does NOT need from us for a plain contact payment:
// - No reservation or claim is made when resolving: it only reads.
// - `afterPrivatePaymentListVersion` lets a payer refuse a list it already
//   used, for payees that hand out single-use addresses. Our lists carry
//   stable, reusable per-contact addresses, so we pass undefined.
// - `recordPaymentOutcome` belongs to Allowance accounting (reserve, begin,
//   record), not to paying a contact's list, so it is not called here.
//
// Every SDK call goes through `service.call(label, task)`. Records are never
// logged: the event log gets short keys, endpoint ids and asset names.
import {
  FfiLinkedPeerState,
  FfiPrivatePaymentResolutionState,
  FfiPrivatePaymentResolutionStatus,
  type FfiPrivateContactPaymentResolution,
} from '@synonymdev/react-native-paykit';

import { ASSETS } from '../wallet/assets';
import { PAYKIT_LINK_ADVANCE_STEPS } from '../config/sync';
import { describeError } from './errors';
import { shortKey } from './keys';
import { reservationInputsFor } from './paymentAdapter';
import type { PaykitService } from './PaykitService';
import { assetsOf, planPrivateListShares, privateAddressesFrom, type PayeeAddresses } from './privatePaymentLists';
import type { SyncRoundContext } from './syncLoop';

/** Read a contact's list again after this long, even if they sent nothing new. */
const RECEIVED_LIST_MAX_AGE_MS = 5 * 60_000;

/** Called once per connected service, before the sync loop starts. */
export function registerPrivatePaymentHooks(service: PaykitService): void {
  service.syncLoop.addRoundHook('private-payment-lists', (context) => sharePrivateLists(service, context));
  service.syncLoop.addRoundHook('received-private-lists', (context) => readReceivedLists(service, context));
  // A contact's Bitcoin address was just derived: share now instead of on the next tick.
  service.addressCache.subscribe(() => {
    if (service.privateLists.isWaitingForAddresses()) service.syncLoop.flush();
  });
}

/** Saved contacts whose link is Linked, from the last observed state. */
function linkedContacts(service: PaykitService): string[] {
  const state = service.getState();
  if (!state) return [];
  const contacts = new Set(state.contacts.map((c) => c.publicKey));
  return state.linkedPeers.filter((p) => p.state === FfiLinkedPeerState.Linked && contacts.has(p.counterparty)).map((p) => p.counterparty);
}

/** Round hook: share our list with every Linked contact whose list is new or changed. */
async function sharePrivateLists(service: PaykitService, context: SyncRoundContext): Promise<void> {
  const store = service.privateLists;
  const contacts = new Set(service.getState()?.contacts.map((c) => c.publicKey) ?? []);
  const plan = planPrivateListShares({
    contacts,
    links: context.linkedPeers.map((peer) => ({
      counterparty: peer.counterparty,
      linked: peer.state === FfiLinkedPeerState.Linked,
      localAttemptId: peer.localRecoveryAttemptId,
      remoteAttemptId: peer.remoteRecoveryAttemptId,
    })),
    inputsFor: (peer) => reservationInputsFor(service.addressCache, peer),
    sharedKeys: store.sharedKeys(),
  });

  for (const peer of plan.stale) store.forgetOutgoing(peer);
  for (const peer of plan.waiting) store.setOutgoing(peer, { state: 'waiting-for-address' });
  for (const peer of plan.tooLarge) {
    service.log.error(`private list for ${shortKey(peer)} is too large for one message; not sent`);
    store.setOutgoing(peer, { state: 'failed', at: Date.now() });
  }
  if (plan.share.length === 0) return;

  for (const { counterparty } of plan.share) store.setOutgoing(counterparty, { state: 'sharing' });
  const report = await service.call(
    'syncPrivatePaymentListsWithReservationsAndProcessOutbound',
    (sdk, signal) =>
      sdk.syncPrivatePaymentListsWithReservationsAndProcessOutbound(
        plan.share.map(({ counterparty, inputs }) => ({ counterparty, reservations: inputs })),
        false,
        { signal },
      ),
    'background',
  );

  const failures = new Map<string, string>();
  for (const change of report.failedToQueue) failures.set(change.counterparty, change.error ? `${change.error.category()}/${change.error.code()}` : 'not queued');
  for (const failure of report.failedToDeliver) failures.set(failure.counterparty, `${failure.error.category()}/${failure.error.code()}`);

  for (const { counterparty, inputs, key } of plan.share) {
    const failure = failures.get(counterparty);
    if (failure) {
      service.log.warn(`share private list with ${shortKey(counterparty)}: ${failure} (retrying next round)`);
      store.setOutgoing(counterparty, { state: 'failed', at: Date.now() });
      continue;
    }
    const assets = assetsOf(privateAddressesFrom(inputs.map((i) => ({ identifier: i.identifier, payloadText: i.payload }))));
    service.log.info(`shared private list with ${shortKey(counterparty)}: ${inputs.map((i) => i.identifier).join(', ')}`);
    store.setOutgoing(counterparty, { state: 'shared', at: Date.now(), assets }, key);
  }
}

/** Round hook: read the lists Linked contacts shared with us, when something may have changed. */
async function readReceivedLists(service: PaykitService, context: SyncRoundContext): Promise<void> {
  for (const peer of linkedContacts(service)) {
    const known = service.privateLists.incomingList(peer);
    const due = !known || context.receivedFrom.includes(peer) || Date.now() - known.loadedAt > RECEIVED_LIST_MAX_AGE_MS;
    if (!due) continue;
    try {
      await loadReceivedPrivateList(service, peer, 'background');
    } catch (error) {
      service.log.warn(`read private list from ${shortKey(peer)}: ${describeError(error)}`);
    }
  }
}

/**
 * Read what one contact shared with us (`currentPrivatePaymentLists`),
 * check it, and keep it for screens. Returns the checked addresses.
 */
export async function loadReceivedPrivateList(
  service: PaykitService,
  publicKey: string,
  priority: 'user' | 'background' = 'user',
): Promise<PayeeAddresses> {
  const views = await service.call(
    'currentPrivatePaymentLists',
    (sdk, signal) => sdk.currentPrivatePaymentLists(publicKey, { signal }),
    priority,
  );
  const endpoints = views.flatMap((view) => view.paymentEndpoints.map((e) => ({ identifier: e.identifier, payloadText: e.payload.exportText() })));
  const addresses = privateAddressesFrom(endpoints);
  const receivedAt = views
    .map((view) => view.lastRefreshAt)
    .filter((at): at is string => !!at)
    .sort()
    .pop();
  const before = service.privateLists.incomingList(publicKey);
  if (!before || assetsOf(before.addresses).join() !== assetsOf(addresses).join()) {
    const what = assetsOf(addresses).map((a) => ASSETS[a].displayName).join(', ') || 'nothing yet';
    service.log.info(`private list from ${shortKey(publicKey)}: ${what}`);
  }
  service.privateLists.setIncoming(publicKey, { addresses, receivedAt, loadedAt: Date.now() });
  return addresses;
}

/**
 * The Send screen's first choice for a person: the private, per-contact
 * addresses a Linked contact shared with us, or undefined to fall back to
 * their public endpoints (not a Linked contact, no list yet, nothing we can
 * pay, or the lookup failed).
 */
export async function privatePaymentAddressesFor(service: PaykitService, publicKey: string): Promise<PayeeAddresses | undefined> {
  if (!linkedContacts(service).includes(publicKey)) return undefined;

  let resolution: FfiPrivateContactPaymentResolution;
  try {
    const prepared = await service.call('prepareAndResolvePrivateContactPayment', (sdk, signal) =>
      sdk.prepareAndResolvePrivateContactPayment(publicKey, undefined, undefined, PAYKIT_LINK_ADVANCE_STEPS, { signal }),
    );
    resolution = prepared.resolution;
  } catch (error) {
    // Usually the network. The list we already received still names the
    // same stable addresses, so resolve from local state only.
    service.log.warn(`prepare private payment to ${shortKey(publicKey)}: ${describeError(error)}; using the saved list`);
    try {
      resolution = await service.call('resolvePrivateContactPayment', (sdk, signal) =>
        sdk.resolvePrivateContactPayment(publicKey, undefined, undefined, { signal }),
      );
    } catch (fallbackError) {
      service.log.warn(`resolve private payment to ${shortKey(publicKey)}: ${describeError(fallbackError)}`);
      return undefined;
    }
  }

  if (resolution.status !== FfiPrivatePaymentResolutionStatus.Payable) {
    service.log.info(
      `private payment to ${shortKey(publicKey)}: ${FfiPrivatePaymentResolutionStatus[resolution.status]} (${FfiPrivatePaymentResolutionState[resolution.state]}); using public endpoints`,
    );
    return undefined;
  }
  // Each endpoint must be theirs, and its payload must parse as one of ours.
  const addresses = privateAddressesFrom(
    resolution.payableEndpoints
      .filter((endpoint) => endpoint.counterparty === publicKey)
      .map((endpoint) => ({ identifier: endpoint.identifier, payloadText: endpoint.target.payload.exportText() })),
  );
  if (assetsOf(addresses).length === 0) return undefined;
  const known = service.privateLists.incomingList(publicKey);
  service.privateLists.setIncoming(publicKey, { addresses, receivedAt: known?.receivedAt, loadedAt: Date.now() });
  service.log.info(`paying ${shortKey(publicKey)} privately: ${assetsOf(addresses).map((a) => ASSETS[a].displayName).join(', ')}`);
  return addresses;
}
