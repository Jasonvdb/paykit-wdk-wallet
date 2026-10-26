// The wallet's own notes about payment requests: what the SDK does not
// keep for us, persisted in the encrypted app store (paykit-app-<id>).
//
// The Paykit SDK keeps the protocol state (proposals, acceptances, proofs,
// receipts) and the payment ledger (reserve / begin / outcome). The wallet
// still has to remember the parts only it knows:
//
//   payer  each payment in flight: the ledger attempt id, the transaction
//          hash once WDK broadcast it, and the proof once built. If the app
//          stops after the broadcast, the next sync round finishes the job
//          from here (submit the proof, record the outcome) instead of
//          offering to pay again.
//   payee  when it asked (a payment must not be older than the request),
//          each proof check: pending / verified / rejected and why, which
//          transfer it used (one transfer pays one request or period), and
//          the receipt issued for it.
//   both   recurring periods the payer put off (deferPaymentOccurrence).
//
// Keys: `paymentKey(counterparty, requestId, period)`, one per one-time
// request or per billing period. No native imports; unit tested with an
// in-memory store.
import type { StringStore } from './addressCache';
import { periodKey, type BillingPeriod } from './recurrence';

const BOOK_KEY = 'payment-requests-v1';

export function paymentKey(counterparty: string, requestId: string, period?: BillingPeriod): string {
  return `${counterparty}|${requestId}|${periodKey(period)}`;
}

/**
 * Payer: one payment's progress.
 *   sending    the ledger issued a handoff (beginPaymentExecution); WDK is broadcasting
 *   broadcast  WDK returned a transaction hash; the proof is not queued yet
 *   proof-sent submitPaymentProof queued the proof
 *   unknown    the send failed in a way that may have reached the network: never retried
 *   not-sent   nothing left the wallet, but recording Failed in the ledger
 *              failed too: the next round (or the next Pay) records it and
 *              forgets the entry, which frees the request to be paid again
 * `outcome` is set once the outcome is recorded in the ledger.
 */
export type OutgoingPayment = {
  counterparty: string;
  requestId: string;
  period?: BillingPeriod;
  asset: 'btc' | 'usdt';
  /** Base units, as a decimal string (JSON has no bigint). */
  amount: string;
  address: string;
  endpointIdentifier: string;
  paymentAppId: string;
  attemptId: string;
  stage: 'sending' | 'broadcast' | 'proof-sent' | 'unknown' | 'not-sent';
  txHash?: string;
  /** Outcome recorded in the ledger (recordPaymentOutcome). */
  outcome?: 'succeeded' | 'failed' | 'unknown';
  updatedAt: number;
  /** When the ledger issued the handoff, just before WDK sent (ms). */
  startedAt?: number;
  /** Not before this time (ms): background retries back off. */
  nextCheckAt?: number;
  /**
   * USD₮: since when every check said "dropped", and how many checks. WDK
   * says dropped when a lookup finds no receipt but the account's nonce has
   * moved on, which a lagging RPC node also says about a mined transaction.
   * Only a long, unbroken run of "dropped" counts as replaced.
   */
  droppedSince?: number;
  droppedChecks?: number;
  /**
   * 'sending' or 'unknown' without a hash (the app stopped mid-send, or the
   * send's outcome was unclear): since when, and how many times, a search of
   * our account's history found no matching transfer.
   */
  searchedSince?: number;
  searches?: number;
  /** Last background problem, for the request page. Safe words only. */
  problem?: string;
};

/** How long a USD₮ payment must look "dropped", without a break, before we believe it. */
export const DROPPED_GIVE_UP_MS = 10 * 60_000;
/** ...and over at least this many checks (they run every DROPPED_RECHECK_MS). */
export const DROPPED_MIN_CHECKS = 10;
export const DROPPED_RECHECK_MS = 30_000;

/** An unbroken run of the same answer: since when, and how many in a row. */
type Run = { since: number; count: number; long: boolean };

function extendRun(since: number | undefined, count: number | undefined, nowMs: number, minMs: number, minCount: number): Run {
  const start = since ?? nowMs;
  const next = (count ?? 0) + 1;
  return { since: start, count: next, long: nowMs - start >= minMs && next >= minCount };
}

/**
 * One more "dropped" answer for our USD₮ payment. `replaced` is true only
 * after an unbroken run of them, long enough that a mined transaction
 * would have shown its receipt on some check (any other answer resets the
 * run: see requestRounds.ts).
 */
export function afterDroppedCheck(
  payment: Pick<OutgoingPayment, 'droppedSince' | 'droppedChecks'>,
  nowMs: number,
): { replaced: boolean; droppedSince: number; droppedChecks: number } {
  const run = extendRun(payment.droppedSince, payment.droppedChecks, nowMs, DROPPED_GIVE_UP_MS, DROPPED_MIN_CHECKS);
  return { replaced: run.long, droppedSince: run.since, droppedChecks: run.count };
}

/** A payment without a hash is looked for this long after it started, so a send still running finishes first. */
export const SEARCH_GRACE_MS = 2 * 60_000;
/** Searches of our history for a payment without a hash: this often... */
export const SEARCH_RECHECK_MS = 60_000;
/** ...and it counts as never sent only after this long and this many searches that worked and found nothing. */
export const SEARCH_GIVE_UP_MS = 30 * 60_000;
export const SEARCH_MIN_COUNT = 15;

/**
 * One more search of our history that found no transfer for a payment that
 * has no hash. `neverSent` once the run is long enough: a broadcast
 * Bitcoin transaction shows in Electrum's history at once (mempool
 * included), so half an hour of empty searches means it never left.
 */
export function afterEmptySearch(
  payment: Pick<OutgoingPayment, 'searchedSince' | 'searches'>,
  nowMs: number,
): { neverSent: boolean; searchedSince: number; searches: number } {
  const run = extendRun(payment.searchedSince, payment.searches, nowMs, SEARCH_GIVE_UP_MS, SEARCH_MIN_COUNT);
  return { neverSent: run.long, searchedSince: run.since, searches: run.count };
}

/** Payee: what we found when checking one proof on chain. */
export type ProofCheck = {
  status: 'pending' | 'verified' | 'rejected';
  reason?: string;
  /** Proof event the check is about. */
  proofEventId: string;
  transferKey?: string;
  /** The transaction the proof named, for the receipt and activity links. */
  txHash?: string;
  checkedAt: number;
  nextCheckAt: number;
  /** Receipt issuance for a verified payment. */
  receiptId?: string;
  receipt?: 'preparing' | 'sent' | 'failed';
};

type BookData = {
  outgoing: Record<string, OutgoingPayment>;
  checks: Record<string, ProofCheck>;
  /** transferKey -> paymentKey that it paid. */
  claimedTransfers: Record<string, string>;
  /** paymentKey -> when the payer put that period off. */
  deferred: Record<string, number>;
  /** Payee: paymentKey(counterparty, requestId) -> when we proposed it (a payment must not be older). */
  asked: Record<string, number>;
};

const EMPTY: BookData = { outgoing: {}, checks: {}, claimedTransfers: {}, deferred: {}, asked: {} };

export class RequestBook {
  private data: BookData;
  private revision = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: StringStore) {
    this.data = this.load();
  }

  private load(): BookData {
    try {
      const parsed = JSON.parse(this.store.getString(BOOK_KEY) ?? 'null') as Partial<BookData> | null;
      return {
        outgoing: parsed?.outgoing ?? {},
        checks: parsed?.checks ?? {},
        claimedTransfers: parsed?.claimedTransfers ?? {},
        deferred: parsed?.deferred ?? {},
        asked: parsed?.asked ?? {},
      };
    } catch {
      return { ...EMPTY };
    }
  }

  private save(): void {
    this.store.set(BOOK_KEY, JSON.stringify(this.data));
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRevision(): number {
    return this.revision;
  }

  // Payer ------------------------------------------------------------------------

  outgoing(key: string): OutgoingPayment | undefined {
    return this.data.outgoing[key];
  }

  allOutgoing(): OutgoingPayment[] {
    return Object.values(this.data.outgoing);
  }

  setOutgoing(key: string, payment: OutgoingPayment): void {
    this.data.outgoing[key] = payment;
    this.save();
  }

  updateOutgoing(key: string, change: Partial<OutgoingPayment>): OutgoingPayment | undefined {
    const current = this.data.outgoing[key];
    if (!current) return undefined;
    const next = { ...current, ...change, updatedAt: Date.now() };
    this.data.outgoing[key] = next;
    this.save();
    return next;
  }

  /** Only for a payment that never left (the send failed before the broadcast). */
  forgetOutgoing(key: string): void {
    if (!(key in this.data.outgoing)) return;
    delete this.data.outgoing[key];
    this.save();
  }

  // Payee ------------------------------------------------------------------------

  check(key: string): ProofCheck | undefined {
    return this.data.checks[key];
  }

  setCheck(key: string, check: ProofCheck): void {
    this.data.checks[key] = check;
    if (check.status === 'verified' && check.transferKey) this.data.claimedTransfers[check.transferKey] = key;
    this.save();
  }

  updateCheck(key: string, change: Partial<ProofCheck>): void {
    const current = this.data.checks[key];
    if (!current) return;
    this.setCheck(key, { ...current, ...change });
  }

  /** When we proposed this request, if this wallet did (since the payment-time rule). */
  askedAt(counterparty: string, requestId: string): number | undefined {
    return this.data.asked[paymentKey(counterparty, requestId)];
  }

  setAskedAt(counterparty: string, requestId: string, at: number): void {
    this.data.asked[paymentKey(counterparty, requestId)] = at;
    this.save();
  }

  /** Which payment a transfer already paid, if any. */
  claimedBy(transferKey: string): string | undefined {
    return this.data.claimedTransfers[transferKey];
  }

  // Both -------------------------------------------------------------------------

  isDeferred(key: string): boolean {
    return key in this.data.deferred;
  }

  setDeferred(key: string, at: number): void {
    this.data.deferred[key] = at;
    this.save();
  }
}
