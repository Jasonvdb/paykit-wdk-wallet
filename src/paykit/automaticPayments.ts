// Paying requests automatically, under an accepted Allowance, from a sync
// round hook. The payer's side of "automatic payments" (./allowances.ts
// has the lifecycle, ./allowanceTerms.ts the limits).
//
// Each round, for every request from a contact we have an accepted
// Allowance with (we are the Allower):
//
//   proposed   statically covered by one of our Allowances (asset, amount,
//              method, not expired)? Then, in the order the SDK expects:
//                1. claimPaymentRequestForPreparation  take the request for this app
//                2. evaluateAllowanceCandidates        which Allowances the SDK
//                                                      says may cover it now
//                3. resolve the bound address, WDK's fee and the balance;
//                   if the wallet can't pay now, leave the request for the
//                   person (no automatic acceptance)
//                4. acceptPaymentRequestAutomatically  persist the choice and
//                                                      queue the acceptance, in
//                                                      one transaction (a
//                                                      one-time request is
//                                                      also checked against
//                                                      the limits here)
//   accepted / when the acceptance has left the outbound queue before the
//   active     request expired (./acceptanceTiming.ts: one that left later
//              is never paid automatically, as the payee ignores its
//              proof), for the one occurrence due (a one-time request, or
//              the oldest unpaid billing period of a recurring one):
//                5. claim, resolve, fee and balance again
//                6. reserveAutomaticPayment  the ledger admits this occurrence
//                                            under the chosen Allowance and its
//                                            limits (Blocked: over a limit,
//                                            ended, already paid ...)
//                7. beginPaymentExecution    rechecks the request and the
//                                            Allowance right before the money
//                                            moves; issues the handoff
//                8. the request book records the attempt, WDK sends, and
//                   finishPayment carries on exactly like a manual payment
//                   (the proof names the Allowance; the payment-request
//                   round hook finishes the USD₮ proof and the outcome)
//
// No double payment: this uses the same ledger and request book as the
// Pay button. A manual answer (accept, decline, Pay) marks the request or
// period manual-only in the ledger, and automatic handling never touches
// it again; a manual payment in flight blocks the automatic reserve, and
// the other way round. After a backup restore, requests that came back
// are never paid automatically, and nothing is until the person resumes
// (./restoreReview.ts): the backup doesn't know what was paid after it.
// One payment per round at most, so a round stays
// short; a payment the hook can't make now is retried later with a
// back-off, and its reason shows on the request page.
//
// What a person does: offer limits to a contact (Person > Automatic
// payments), the contact accepts, and from then on that contact's
// requests within the limits are accepted and paid without a tap. Over a
// limit, the request waits for the person, as before.
import {
  FfiLinkedPeerState,
  FfiOutboundPrivateMessageStatus,
  FfiPaymentAttemptDecision,
  FfiPaymentOutcome,
  type FfiPaymentRequestRecord,
} from '@synonymdev/react-native-paykit';

import { nextAcceptanceTiming, type AcceptanceTiming } from './acceptanceTiming';
import { allowanceCovers, automaticBlockWords, automaticFeeProblem } from './allowanceTerms';
import { allowancesOf, requestKey, type AllowanceLedger, type AllowanceView, type Allowances } from './allowances';
import { describeError, paykitErrorTag } from './errors';
import { shortKey } from './keys';
import type { PaykitService } from './PaykitService';
import { isScheduledPeriod, periodKey, toRfc3339, unpaidPeriods, type BillingPeriod } from './recurrence';
import { paymentKey } from './requestBook';
import { readRestoreReview } from './restoreReview';
import {
  ACCEPT_AND_PAY_MARGIN_MS,
  ensureLedgerReady,
  executionChecks,
  finishPayment,
  outgoingFor,
  recordOutcome,
  requestViewOf,
  resolveRequestAddress,
  type PaymentRequests,
  type PreparedPayment,
  type RequestView,
} from './requests';
import { ENDPOINT_FOR_ASSET, type RequestAsset } from './requestTerms';

/** Wait this long before trying again after the wallet couldn't pay (balance, network). */
const RETRY_WALLET_MS = 60_000;
/** ...and this long after the ledger or the SDK said no (a limit, the lifecycle). */
const RETRY_BLOCKED_MS = 2 * 60_000;

/** Why the last automatic try didn't pay, per request or payment key, for the request page. Memory only. */
export class AutomaticPaymentNotes {
  private readonly notes = new Map<string, { message: string; retryAt: number }>();
  private revision = 0;
  private readonly listeners = new Set<() => void>();

  note(key: string): string | undefined {
    return this.notes.get(key)?.message;
  }

  canTry(key: string, nowMs: number): boolean {
    return (this.notes.get(key)?.retryAt ?? 0) <= nowMs;
  }

  set(key: string, message: string, retryInMs: number): void {
    const previous = this.notes.get(key)?.message;
    this.notes.set(key, { message, retryAt: Date.now() + retryInMs });
    if (previous !== message) this.changed();
  }

  clear(key: string): void {
    if (this.notes.delete(key)) this.changed();
  }

  getRevision(): number {
    return this.revision;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }
}

const notesPerService = new WeakMap<PaykitService, AutomaticPaymentNotes>();

export function automaticPaymentNotesOf(service: PaykitService): AutomaticPaymentNotes {
  let notes = notesPerService.get(service);
  if (!notes) {
    notes = new AutomaticPaymentNotes();
    notesPerService.set(service, notes);
  }
  return notes;
}

/** App store key: final acceptance timings ('in-time' / 'too-late') per request, so a restart after the expiry keeps them. */
const ACCEPTANCE_TIMING_KEY = 'acceptance-timing-v1';

/** Per service: whether our acceptance of each request left before it expired (see ./acceptanceTiming.ts). */
const acceptanceTimings = new WeakMap<PaykitService, Map<string, AcceptanceTiming>>();

function loadTimings(service: PaykitService): Map<string, AcceptanceTiming> {
  try {
    const saved = JSON.parse(service.appStore.getString(ACCEPTANCE_TIMING_KEY) ?? '{}') as Record<string, unknown>;
    return new Map(Object.entries(saved).filter((entry): entry is [string, AcceptanceTiming] => entry[1] === 'in-time' || entry[1] === 'too-late'));
  } catch {
    return new Map();
  }
}

/** Watch every request we accepted, every round, so the paying step knows whether the acceptance left in time. */
function observeAcceptances(service: PaykitService, records: readonly FfiPaymentRequestRecord[], nowMs: number): Map<string, AcceptanceTiming> {
  let timings = acceptanceTimings.get(service);
  if (!timings) {
    timings = loadTimings(service);
    acceptanceTimings.set(service, timings);
  }
  let settled = false;
  for (const record of records) {
    // Undefined: accepted before this app saw it, or not ours to send.
    if (record.acceptedOutboundStatus === undefined) continue;
    const view = requestViewOf(record);
    if (view.role !== 'payer') continue;
    const key = requestKey(view.counterparty, view.requestId);
    const previous = timings.get(key);
    const sent = record.acceptedOutboundStatus === FfiOutboundPrivateMessageStatus.Sent;
    const next = nextAcceptanceTiming(previous, sent, view.terms?.expiresAtMs, nowMs);
    timings.set(key, next);
    if (next !== previous && next !== 'waiting') settled = true;
  }
  if (settled) {
    const final = Object.fromEntries([...timings].filter(([, timing]) => timing !== 'waiting'));
    service.appStore.set(ACCEPTANCE_TIMING_KEY, JSON.stringify(final));
  }
  return timings;
}

/** Called once per connected service, after the payment request hooks (PaykitService.connect). */
export function registerAllowanceHooks(service: PaykitService, requests: PaymentRequests): void {
  const allowances = allowancesOf(service);
  service.syncLoop.addRoundHook('allowances', (context) => allowances.refreshIfDue(context));
  service.syncLoop.addRoundHook('automatic-payments', () => payAutomatically(service, requests, allowances));
}

async function payAutomatically(service: PaykitService, requests: PaymentRequests, allowances: Allowances): Promise<void> {
  const state = service.getState();
  if (!state) return;
  const timings = observeAcceptances(service, state.paymentRequests, Date.now());
  // After a backup restore (./restoreReview.ts): nothing until the person
  // resumes, and never a request that came back with the backup.
  const review = readRestoreReview(service.appStore);
  if (review?.paused) return;
  const restored = new Set(review?.requestKeys ?? []);
  const chain = requests.getChain();
  const usable = allowances.usableAsPayer();
  if (!chain || usable.length === 0) return;
  const ledger = allowances.getLedger();
  const notes = automaticPaymentNotesOf(service);
  const linked = new Set(state.linkedPeers.filter((p) => p.state === FfiLinkedPeerState.Linked).map((p) => p.counterparty));
  const now = Date.now();

  for (const record of state.paymentRequests) {
    const view = requestViewOf(record);
    if (view.role !== 'payer' || !linked.has(view.counterparty)) continue;
    const mine = usable.filter((a) => a.counterparty === view.counterparty);
    const terms = view.terms;
    if (mine.length === 0 || !terms?.asset || terms.amount === undefined || terms.cannotPay) continue;
    const rkey = requestKey(view.counterparty, view.requestId);
    // Answered by hand: the person's decision stands (sticky in the ledger).
    // Restored from a backup: it may have been paid after the backup was made.
    if (ledger.manualRequests.has(rkey) || restored.has(rkey)) continue;

    if (view.state === 'proposed' && !view.accepted) {
      if (!mine.some((a) => a.terms && allowanceCovers(a.terms, terms, now))) continue;
      if (terms.expiresAtMs !== undefined && terms.expiresAtMs - now < ACCEPT_AND_PAY_MARGIN_MS) continue;
      if (!notes.canTry(rkey, now)) continue;
      if (await acceptAutomatically(service, requests, allowances, view, mine)) return;
      continue;
    }

    if (view.state !== 'accepted' && view.state !== 'active') continue;
    const association = ledger.associations.get(rkey);
    if (!association || !mine.some((a) => a.allowanceId === association.allowanceId)) continue;
    // Pay only once our acceptance has left, and only if it left before the
    // request expired: the payee judges it by when it arrives, and ignores
    // a proof for a request it saw accepted too late.
    if (record.acceptedOutboundStatus !== undefined) {
      const timing = timings.get(rkey);
      if (timing === 'too-late') {
        notes.set(rkey, 'Not paid automatically. Your answer may have reached them only after the request expired, so they might not count a payment. Ask them to send it again.', RETRY_BLOCKED_MS);
        continue;
      }
      if (timing !== 'in-time') continue;
    }
    const period = nextDue(view, requests, ledger, now);
    if (period === null) continue;
    const key = paymentKey(view.counterparty, view.requestId, period);
    if (!notes.canTry(key, now)) continue;
    if (await payOccurrence(service, requests, allowances, view, period, association)) return;
  }
}

/**
 * The occurrence to pay now: `undefined` for an unpaid one-time request,
 * the oldest started and unpaid billing period of a recurring one, or
 * null for nothing. Anything already in the book, the ledger (live, or
 * manual-only), with a proof of ours, or put off by the person is skipped.
 */
function nextDue(view: RequestView, requests: PaymentRequests, ledger: AllowanceLedger, nowMs: number): BillingPeriod | undefined | null {
  const recurrence = view.terms?.recurrence;
  const taken = (period: BillingPeriod | undefined) => {
    const key = paymentKey(view.counterparty, view.requestId, period);
    const entry = ledger.occurrences.get(key);
    return (
      !!requests.book.outgoing(key) ||
      !!entry?.live ||
      !!entry?.manualOnly ||
      requests.book.isDeferred(key) ||
      view.proofs.some((p) => p.ours && (recurrence ? periodKey(p.period) === periodKey(period) : true))
    );
  };
  if (!recurrence) return taken(undefined) ? null : undefined;
  const handled = new Set(view.proofs.filter((p) => p.ours).map((p) => periodKey(p.period)));
  const due = unpaidPeriods(recurrence, handled, nowMs).filter((p) => isScheduledPeriod(recurrence, p) && !taken(p));
  return due[0] ?? null;
}

type Payable = { address: string; appId: string; feeRate?: bigint };

/** Take the request for this app (claimPaymentRequestForPreparation); every automatic step needs the claim. */
async function claimForThisApp(service: PaykitService, view: RequestView): Promise<void> {
  await service.call(
    'claimPaymentRequestForPreparation',
    (sdk, signal) => sdk.claimPaymentRequestForPreparation(view.counterparty, view.requestId, { signal }),
    'background',
  );
}

/** Claim the request, resolve its address and check the wallet can pay it now. A problem is noted and returns undefined. */
async function preparePayable(service: PaykitService, requests: PaymentRequests, view: RequestView, noteKey: string): Promise<Payable | undefined> {
  const notes = automaticPaymentNotesOf(service);
  const terms = view.terms;
  const chain = requests.getChain();
  if (!terms?.asset || terms.amount === undefined || !chain) return undefined;
  await claimForThisApp(service, view);
  const endpoint = await resolveRequestAddress(service, view.counterparty, view.requestId, { ...terms, asset: terms.asset });
  const quote = await chain.quoteSend(terms.asset, endpoint.address, terms.amount);
  if (!quote.ok) {
    notes.set(noteKey, `Couldn't pay it automatically. ${quote.problem}`, RETRY_WALLET_MS);
    return undefined;
  }
  // No Allowance limit counts network fees: an out-of-proportion fee waits for the person.
  const feeProblem = automaticFeeProblem({ asset: terms.asset, amount: terms.amount, fee: quote.fee, feeAsset: quote.feeAsset });
  if (feeProblem) {
    notes.set(noteKey, `Not paid automatically. ${feeProblem}`, RETRY_BLOCKED_MS);
    return undefined;
  }
  return { address: endpoint.address, appId: endpoint.appId, feeRate: quote.feeRate };
}

function preparedPayment(view: RequestView, payable: Payable, period: BillingPeriod | undefined): PreparedPayment {
  const terms = view.terms!;
  const asset = terms.asset as RequestAsset;
  return {
    key: paymentKey(view.counterparty, view.requestId, period),
    counterparty: view.counterparty,
    requestId: view.requestId,
    period,
    asset,
    amount: terms.amount ?? 0n,
    address: payable.address,
    endpointIdentifier: ENDPOINT_FOR_ASSET[asset],
    paymentAppId: payable.appId,
    needsAcceptance: false,
    proposalStreamItemId: view.proposalStreamItemId,
    terms,
  };
}

/** Steps 1-4. Returns true when it did SDK work this round (accepted, or tried and failed). */
async function acceptAutomatically(service: PaykitService, requests: PaymentRequests, allowances: Allowances, view: RequestView, mine: AllowanceView[]): Promise<boolean> {
  const notes = automaticPaymentNotesOf(service);
  const rkey = requestKey(view.counterparty, view.requestId);
  const asset = view.terms?.asset;
  if (!asset) return false;
  try {
    await ensureLedgerReady(service, 'automatic');
    await claimForThisApp(service, view);
    // The SDK's view first (cheap, local): which of our Allowances may cover it now.
    const scope = { counterparty: view.counterparty, paymentRequestId: view.requestId };
    const candidates = await service.call('evaluateAllowanceCandidates', (sdk, signal) => sdk.evaluateAllowanceCandidates(scope, toRfc3339(Date.now()), { signal }), 'background');
    const identifier = ENDPOINT_FOR_ASSET[asset];
    const ours = new Set(mine.map((a) => a.allowanceId));
    // Local priority: the first eligible one the SDK lists (newest first).
    const chosen = candidates.find((c) => c.blocked === undefined && ours.has(c.allowanceId) && c.eligiblePaymentEndpointIdentifiers.includes(identifier));
    if (!chosen) {
      const blocked = candidates.find((c) => ours.has(c.allowanceId) && c.blocked)?.blocked;
      const code = blocked && 'inner' in blocked ? (blocked.inner as { code?: string }).code : undefined;
      notes.set(rkey, `Not paid automatically. ${automaticBlockWords(blocked?.tag ?? '', code)}`, RETRY_BLOCKED_MS);
      return true;
    }
    // Then the wallet: the bound address, WDK's fee and the balance.
    const payable = await preparePayable(service, requests, view, rkey);
    if (!payable) return true;
    const trustedTime = toRfc3339(Date.now());
    const checks = executionChecks(preparedPayment(view, payable, undefined), trustedTime);
    await service.call('acceptPaymentRequestAutomatically', (sdk, signal) =>
      sdk.acceptPaymentRequestAutomatically(scope, { allowanceId: chosen.allowanceId, expectedRevision: undefined, trustedTime }, checks, { signal }),
    );
    notes.clear(rkey);
    service.log.info(`accepted request ${view.requestId.slice(0, 8)} from ${shortKey(view.counterparty)} automatically`);
    allowances.markDirty();
    await allowances.refresh('background');
    await service.refreshState('background');
    service.syncLoop.flush();
  } catch (error) {
    service.log.warn(`automatic acceptance of ${view.requestId.slice(0, 8)}: ${describeError(error)}`);
    const policy = paykitErrorTag(error) === 'Policy';
    notes.set(rkey, policy ? "Not paid automatically. Your limits don't cover it right now." : "Couldn't pay it automatically yet. Trying again.", policy ? RETRY_BLOCKED_MS : RETRY_WALLET_MS);
  }
  return true;
}

/** Steps 5-8 for one occurrence. Returns true when it did SDK or wallet work this round. */
async function payOccurrence(
  service: PaykitService,
  requests: PaymentRequests,
  allowances: Allowances,
  view: RequestView,
  period: BillingPeriod | undefined,
  association: { allowanceId: string; revision: bigint },
): Promise<boolean> {
  const notes = automaticPaymentNotesOf(service);
  const book = requests.book;
  const chain = requests.getChain();
  const key = paymentKey(view.counterparty, view.requestId, period);
  if (!chain) return false;
  try {
    await ensureLedgerReady(service, 'automatic');
    const payable = await preparePayable(service, requests, view, key);
    if (!payable) return true;
    const prepared = preparedPayment(view, payable, period);
    const occurrence = { request: { counterparty: view.counterparty, paymentRequestId: view.requestId }, billingPeriod: period };
    const reserved = await service.call('reserveAutomaticPayment', (sdk, signal) =>
      sdk.reserveAutomaticPayment(occurrence, association.revision, executionChecks(prepared), { signal }),
    );
    if (!FfiPaymentAttemptDecision.Ready.instanceOf(reserved)) {
      const reason = reserved.inner.reason;
      const code = 'inner' in reason ? (reason.inner as { code?: string }).code : undefined;
      notes.set(key, `Not paid automatically. ${automaticBlockWords(reason.tag, code)}${reason.tag === 'SharedRule' ? ' You can pay it yourself.' : ''}`, RETRY_BLOCKED_MS);
      service.log.info(`automatic payment of ${view.requestId.slice(0, 8)} blocked: ${reason.tag}${code ? `/${code}` : ''}`);
      allowances.markDirty();
      return true;
    }
    const attemptId = reserved.inner.attempt.attemptId;
    let begun;
    try {
      begun = await service.call('beginPaymentExecution', (sdk, signal) => sdk.beginPaymentExecution(attemptId, executionChecks(prepared), { signal }));
    } catch (error) {
      await releaseAttempt(service, requests, prepared, attemptId, association.allowanceId);
      throw error;
    }
    if (!FfiPaymentAttemptDecision.Ready.instanceOf(begun)) {
      // No handoff: nothing was sent, so free the reservation.
      await releaseAttempt(service, requests, prepared, attemptId, association.allowanceId);
      notes.set(key, `Not paid automatically. ${automaticBlockWords(begun.inner.reason.tag)}`, RETRY_BLOCKED_MS);
      return true;
    }
    // From here on a restart finds the payment in the book and never pays it twice.
    book.setOutgoing(key, outgoingFor(prepared, attemptId, 'sending', association.allowanceId));
    service.log.info(`paying request ${view.requestId.slice(0, 8)} automatically${period ? ` (${periodKey(period)})` : ''}`);
    const result = await chain.send(prepared.asset, prepared.address, prepared.amount, payable.feeRate);
    if ('hash' in result) {
      await finishPayment(service, prepared, attemptId, { hash: result.hash });
      notes.clear(key);
      service.log.info(`paid request ${view.requestId.slice(0, 8)} automatically`);
    } else {
      await finishPayment(service, prepared, attemptId, { failure: result.failure });
      notes.set(key, `Couldn't pay it automatically. ${result.message}`, result.failure === 'unknown' ? RETRY_BLOCKED_MS : RETRY_WALLET_MS);
    }
    allowances.markDirty();
  } catch (error) {
    service.log.warn(`automatic payment of ${view.requestId.slice(0, 8)}: ${describeError(error)}`);
    notes.set(key, "Couldn't pay it automatically yet. Trying again.", RETRY_WALLET_MS);
  }
  return true;
}

/**
 * Record Failed for an attempt that got no handoff (nothing left the
 * wallet). If that call fails, a 'not-sent' book entry makes the
 * payment-request round hook record it later, as for a manual payment;
 * otherwise the reservation would block this payment for good.
 */
async function releaseAttempt(service: PaykitService, requests: PaymentRequests, prepared: PreparedPayment, attemptId: string, allowanceId: string): Promise<void> {
  try {
    await recordOutcome(service, attemptId, FfiPaymentOutcome.Failed);
  } catch (error) {
    service.log.warn(`release automatic attempt: ${describeError(error)} (retrying next round)`);
    requests.book.setOutgoing(prepared.key, outgoingFor(prepared, attemptId, 'not-sent', allowanceId));
  }
}
