// Private Payment Lists as plain data: what we share with each contact,
// what each contact shared with us, and when to share again.
//
// A Private Payment List is an encrypted message over the Encrypted Link
// that carries one app's COMPLETE list of payment endpoints for that one
// contact. Each new list replaces the previous one, so:
//
// - we never share an empty or partial list by accident (a list without
//   BTC would remove BTC from what the contact sees);
// - re-sharing the same list is harmless: the SDK reuses an unchanged list
//   already sent on the current link (until the app restarts, when it sends
//   it once more).
//
// When to share (planPrivateListShares): with every contact whose link is
// Linked, once both of our addresses for them are known, and again when
// the list or the link changes. "The link changed" is the pair of
// recovery attempt ids in the link record: they name the link's current
// stream generation, so a link that was torn down and formed again gets
// new ids and therefore a fresh share.
//
// This file has no native imports (types only) and is unit tested. The SDK
// calls that use it are in ./privatePayments.ts.
import type { FfiPrivatePaymentEndpointReservationInput } from '@synonymdev/react-native-paykit';

import { parseEndpoint, PRIVATE_MESSAGE_LIMIT_BYTES, utf8ByteLength } from './endpoints';
import type { PayeeAsset } from './publicPaymentOptions';

export type PayeeAddresses = Partial<Record<PayeeAsset, string>>;

/** One endpoint as plain text, from a list view or a payment resolution. */
export type EndpointText = { identifier: string; payloadText: string };

/** Our list for one contact, as the Person screen and Network details show it. */
export type OutgoingListStatus =
  /** Linked, but their own Bitcoin address is not derived yet. */
  | { state: 'waiting-for-address' }
  | { state: 'sharing' }
  | { state: 'shared'; at: number; assets: PayeeAsset[] }
  | { state: 'failed'; at: number };

/** What a contact shared with us, checked. */
export type IncomingList = {
  addresses: PayeeAddresses;
  /** When the SDK received their latest list (RFC3339), if known. */
  receivedAt?: string;
  /** When this app last read it (ms). */
  loadedAt: number;
};

/** The parts of a link record that decide whether to share again. */
export type LinkGeneration = {
  counterparty: string;
  linked: boolean;
  localAttemptId?: string;
  remoteAttemptId?: string;
};

/**
 * Room the Paykit envelope (version, kind, app id, list version) takes in a
 * private message besides the endpoints. Generous on purpose: the check is
 * here to catch a list that grew by mistake, not to fill the message.
 */
const ENVELOPE_ALLOWANCE_BYTES = 300;

/** A rough upper bound for the private message that carries these inputs. */
export function estimatedListBytes(inputs: readonly Pick<FfiPrivatePaymentEndpointReservationInput, 'identifier' | 'payload'>[]): number {
  const endpoints = inputs.map(({ identifier, payload }) => ({ identifier, payload }));
  return utf8ByteLength(JSON.stringify(endpoints)) + ENVELOPE_ALLOWANCE_BYTES;
}

export function fitsInPrivateMessage(inputs: readonly Pick<FfiPrivatePaymentEndpointReservationInput, 'identifier' | 'payload'>[]): boolean {
  return estimatedListBytes(inputs) <= PRIVATE_MESSAGE_LIMIT_BYTES;
}

/** The assets a list carries, in display order. */
export function assetsOf(addresses: PayeeAddresses): PayeeAsset[] {
  return (['btc', 'usdt'] as const).filter((asset) => addresses[asset] !== undefined);
}

/**
 * Checked addresses per asset from someone's private endpoints. Someone
 * else's data: every payload goes through our own parser (./endpoints.ts),
 * and the first valid endpoint per asset wins.
 */
export function privateAddressesFrom(endpoints: readonly EndpointText[]): PayeeAddresses {
  const addresses: PayeeAddresses = {};
  for (const endpoint of endpoints) {
    const parsed = parseEndpoint(endpoint.identifier, endpoint.payloadText);
    if (parsed && addresses[parsed.asset] === undefined) addresses[parsed.asset] = parsed.address;
  }
  return addresses;
}

/** Identifies "this list on this link": a change in either means share again. */
export function shareKeyFor(link: LinkGeneration, inputs: readonly Pick<FfiPrivatePaymentEndpointReservationInput, 'reservationId' | 'payload'>[]): string {
  const list = inputs.map((input) => `${input.reservationId}=${input.payload}`).join(',');
  return `${link.localAttemptId ?? '-'}/${link.remoteAttemptId ?? '-'}|${list}`;
}

export type SharePlan<Input> = {
  /** Linked contacts whose list is new or changed. */
  share: { counterparty: string; inputs: Input[]; key: string }[];
  /** Linked contacts whose addresses are not all known yet: skip this round. */
  waiting: string[];
  /** Lists that would not fit in one private message: never sent. */
  tooLarge: string[];
  /** Peers we shared with before that are no longer linked contacts: forget what we sent. */
  stale: string[];
};

/**
 * Who gets our list this round. Pure: the caller supplies each contact's
 * reservation inputs (undefined until both addresses are cached; see
 * reservationInputsFor in ./paymentAdapter.ts) and the keys of lists
 * already shared.
 */
export function planPrivateListShares<Input extends Pick<FfiPrivatePaymentEndpointReservationInput, 'reservationId' | 'identifier' | 'payload'>>(input: {
  contacts: ReadonlySet<string>;
  links: readonly LinkGeneration[];
  inputsFor: (counterparty: string) => Input[] | undefined;
  sharedKeys: ReadonlyMap<string, string>;
}): SharePlan<Input> {
  const plan: SharePlan<Input> = { share: [], waiting: [], tooLarge: [], stale: [] };
  const current = new Set<string>();
  for (const link of input.links) {
    if (!link.linked || !input.contacts.has(link.counterparty)) continue;
    current.add(link.counterparty);
    const inputs = input.inputsFor(link.counterparty);
    // Never a partial or empty list: wait until both addresses are known.
    if (!inputs || inputs.length === 0) {
      plan.waiting.push(link.counterparty);
      continue;
    }
    if (!fitsInPrivateMessage(inputs)) {
      plan.tooLarge.push(link.counterparty);
      continue;
    }
    const key = shareKeyFor(link, inputs);
    if (input.sharedKeys.get(link.counterparty) !== key) plan.share.push({ counterparty: link.counterparty, inputs, key });
  }
  for (const counterparty of input.sharedKeys.keys()) {
    if (!current.has(counterparty)) plan.stale.push(counterparty);
  }
  return plan;
}

/**
 * Per-service record of private lists, for screens: what we shared with
 * each contact and what they shared with us. Memory only: after a restart
 * the sync loop shares again and reads lists again within a few rounds.
 */
export class PrivateListStore {
  private readonly outgoing = new Map<string, OutgoingListStatus>();
  private readonly keys = new Map<string, string>();
  private readonly incoming = new Map<string, IncomingList>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private book: { revision: number; owners: Map<string, string> } | undefined;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Changes whenever anything here changes; a snapshot for useSyncExternalStore. */
  getRevision(): number {
    return this.revision;
  }

  private changed(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  outgoingStatus(counterparty: string): OutgoingListStatus | undefined {
    return this.outgoing.get(counterparty);
  }

  incomingList(counterparty: string): IncomingList | undefined {
    return this.incoming.get(counterparty);
  }

  /** True while some Linked contact waits for one of our addresses to be derived. */
  isWaitingForAddresses(): boolean {
    for (const status of this.outgoing.values()) if (status.state === 'waiting-for-address') return true;
    return false;
  }

  sharedKeys(): ReadonlyMap<string, string> {
    return this.keys;
  }

  setOutgoing(counterparty: string, status: OutgoingListStatus, key?: string): void {
    const previous = this.outgoing.get(counterparty);
    if (key !== undefined) this.keys.set(counterparty, key);
    else if (status.state !== 'shared') this.keys.delete(counterparty);
    if (previous?.state === status.state && status.state !== 'shared' && status.state !== 'failed') return;
    this.outgoing.set(counterparty, status);
    this.changed();
  }

  setIncoming(counterparty: string, list: IncomingList): void {
    this.incoming.set(counterparty, list);
    this.changed();
  }

  /** Forget what we shared with them (the link ended or they were removed). */
  forgetOutgoing(counterparty: string): void {
    const had = this.outgoing.delete(counterparty);
    this.keys.delete(counterparty);
    if (had) this.changed();
  }

  /** Forget everything about them. */
  forget(counterparty: string): void {
    this.outgoing.delete(counterparty);
    this.keys.delete(counterparty);
    this.incoming.delete(counterparty);
    this.changed();
  }

  /** How many contacts have our list, and how many shared theirs, for Network details. */
  summary(): { sharedWith: number; receivedFrom: number } {
    let sharedWith = 0;
    for (const status of this.outgoing.values()) if (status.state === 'shared') sharedWith += 1;
    let receivedFrom = 0;
    for (const list of this.incoming.values()) if (assetsOf(list.addresses).length > 0) receivedFrom += 1;
    return { sharedWith, receivedFrom };
  }

  /**
   * Every address a contact shared with us privately -> their pubky. EVM
   * addresses are lowercased (they are case-insensitive). Used to put a
   * name on activity rows.
   */
  addressOwners(): ReadonlyMap<string, string> {
    if (this.book?.revision === this.revision) return this.book.owners;
    const owners = new Map<string, string>();
    for (const [counterparty, list] of this.incoming) {
      for (const address of Object.values(list.addresses)) {
        if (address) owners.set(addressKey(address), counterparty);
      }
    }
    this.book = { revision: this.revision, owners };
    return owners;
  }
}

/** How addresses are compared: EVM addresses ignore case, Bitcoin bech32 is lowercase anyway. */
export function addressKey(address: string): string {
  return address.trim().toLowerCase();
}
