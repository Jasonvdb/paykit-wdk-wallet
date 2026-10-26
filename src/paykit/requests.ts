// Payment requests and receipts: asking a contact for money, paying what a
// contact asked for, proving it, checking the proof on chain and sending a
// receipt. The request state machine is written down in
// docs/ARCHITECTURE.md ("Payment requests").
//
// Who does what:
//
//   Paykit SDK   the protocol: proposals, acceptances, rejections,
//                cancellations and proofs travel as private Event
//                Messages over the Encrypted Link; receipts are encrypted
//                files on the payee's homeserver plus a Receipt Access
//                message. It also keeps a payment ledger
//                (reserveManualPayment -> beginPaymentExecution ->
//                recordPaymentOutcome) so one request or billing period is
//                never paid twice, even across restarts.
//   WDK          moves the money (the Send review), signs the USD₮ proof
//                (signTypedData) and reads transactions back for the
//                payee's check (getTransfers, getTransaction). Those WDK
//                calls reach this module through a PaymentChain the React
//                tree attaches (src/features/requests/PaymentChainBridge.tsx),
//                because WDK's API is hooks.
//   this module  the order of the calls, the wallet's own notes
//                (./requestBook.ts) and the round hooks
//                (./requestRounds.ts) that finish work in the background.
//
// Paying a request (payer), in order, matching the Rust SDK's rules:
//   1. claimPaymentRequestForPreparation   take the request for this app
//      (the non-legacy claimPaymentRequestForExecution: it also refuses a
//      blocked peer)
//   2. prepareAndResolvePrivatePaymentRequest   refresh the link and
//      resolve the address the request allows (here: the address bound in
//      the request's terms; never a public fallback)
//   -- the Send review shows that address and amount, locked --
//   3. claimAndAcceptPaymentRequest   only if still proposed: queue the
//      acceptance, which must precede the proof in our send order
//   4. reconcileAllowanceAccounting   once per install: the ledger refuses
//      to admit payments until the wallet attests its payment history
//   5. reserveManualPayment -> beginPaymentExecution   the ledger admits
//      this exact occurrence (request + billing period) and issues a
//      handoff; a second attempt for the same occurrence is Blocked
//   6. WDK sends; the transaction hash goes into the request book at once
//   7. submitPaymentProof   BTC right away; USD₮ once the transaction is
//      in a block (the proof names its receipt log), signed by WDK
//   8. recordPaymentOutcome   Succeeded when confirmed, Failed when the
//      send never left or reverted, Unknown when we cannot tell (the
//      occurrence then stays reserved: no second payment)
// quotePaymentRequest (conversion quotes) is not used: this app requests
// and pays the same asset, so there is no rate to agree on.
//
// Every SDK call goes through service.call(label, task); the loop is
// flushed after each user action. Request and receipt records are never
// logged: the event log gets short keys, ids' first characters and states.
import * as Crypto from 'expo-crypto';
import {
  FfiAccountingAmount,
  FfiLinkedPeerState,
  FfiOutboundPrivateMessageStatus,
  FfiPaymentAttemptDecision,
  FfiPaymentExecutionStatus,
  FfiPaymentOutcome,
  FfiPaymentReference,
  FfiPaymentRequestLifecycleState,
  FfiPaymentRequestLocalRole,
  FfiPrivateJsonObject,
  FfiPrivatePaymentResolutionStatus,
  type FfiAllowanceAccountingBlock,
  type FfiPaymentExecutionChecks,
  type FfiPaymentRequestRecord,
  type FfiPaymentRequestTerms,
  type FfiPaykitStateObservation,
  type FfiPrivateContactPaymentResolution,
} from '@synonymdev/react-native-paykit';

import { PAYKIT_LINK_ADVANCE_STEPS } from '../config/sync';
import type { BtcReceipt, BtcSendStatus, EvmTransaction, SentTransferMatch, SentTransferQuery } from '../wallet/paymentEvidence';
import type { Erc20PaymentTypedData } from '../wallet/erc20PaymentProof';
import { toPaykitDecimal } from '../wallet/amounts';
import { UserFacingError, describeError } from './errors';
import { parseEndpoint } from './endpoints';
import { shortKey } from './keys';
import type { PaykitService } from './PaykitService';
import { btcProofJson, proofTransactionHash } from './paymentProofs';
import { RequestBook, paymentKey, type OutgoingPayment } from './requestBook';
import { registerRequestRounds } from './requestRounds';
import {
  buildRequestTerms,
  ENDPOINT_FOR_ASSET,
  proposalMessageBytes,
  readRequestTerms,
  newPaymentReference,
  REQUEST_MESSAGE_BUDGET_BYTES,
  type PlainTerms,
  type RequestDraft,
  type RequestAsset,
  type RequestTermsView,
} from './requestTerms';
import {
  isScheduledPeriod,
  parseTime,
  paymentCount,
  periodKey,
  toRfc3339,
  type BillingPeriod,
  type Recurrence,
} from './recurrence';
import type { Delivery, PaymentFacts, RequestFacts, RequestState } from './requestStatus';

// The wallet side, attached from React ----------------------------------------------

/** What this module needs from WDK. Implemented in src/features/requests/PaymentChainBridge.tsx. */
export type PaymentChain = {
  /** What `txid` paid our Bitcoin account `accountIndex` (WDK getTransfers on that account). */
  btcReceived(accountIndex: number, txid: string, address: string): Promise<BtcReceipt>;
  /** Our own Bitcoin payment, from account 0 (WDK getTransaction). */
  btcSent(txid: string): Promise<BtcSendStatus>;
  /** Any Sepolia transaction (WDK getTransaction). */
  evmTransaction(hash: string): Promise<EvmTransaction>;
  /** Our own sent transfer for a payment that has no hash yet (account 0's history). Throws if it can't tell. */
  findSentPayment(query: SentTransferQuery): Promise<SentTransferMatch>;
  /** Sign a USD₮ payment proof with EVM account 0 (WDK signTypedData; refuses any other typed data). */
  signErc20Payment(typedData: Erc20PaymentTypedData): Promise<string>;
};

/** Per-service state: the request book and the attached wallet. */
export class PaymentRequests {
  readonly book: RequestBook;
  private chain: PaymentChain | undefined;

  constructor(readonly service: PaykitService) {
    this.book = new RequestBook(service.appStore);
  }

  attachChain(chain: PaymentChain): () => void {
    this.chain = chain;
    this.service.syncLoop.flush();
    return () => {
      if (this.chain === chain) this.chain = undefined;
    };
  }

  /** The wallet, once React has attached it; background checks wait for it. */
  getChain(): PaymentChain | undefined {
    return this.chain;
  }
}

const perService = new WeakMap<PaykitService, PaymentRequests>();

export function paymentRequestsOf(service: PaykitService): PaymentRequests {
  let requests = perService.get(service);
  if (!requests) {
    requests = new PaymentRequests(service);
    perService.set(service, requests);
  }
  return requests;
}

/** Called once per connected service, before the sync loop starts (PaykitService.connect). */
export function registerPaymentRequestHooks(service: PaykitService): void {
  registerRequestRounds(service, paymentRequestsOf(service));
}

// Reading requests ------------------------------------------------------------------

const STATE_OF: Record<FfiPaymentRequestLifecycleState, RequestState> = {
  [FfiPaymentRequestLifecycleState.Proposed]: 'proposed',
  [FfiPaymentRequestLifecycleState.ProposalExpired]: 'expired',
  [FfiPaymentRequestLifecycleState.Accepted]: 'accepted',
  [FfiPaymentRequestLifecycleState.Rejected]: 'rejected',
  [FfiPaymentRequestLifecycleState.Canceled]: 'canceled',
  [FfiPaymentRequestLifecycleState.ProofSubmitted]: 'proof-submitted',
  [FfiPaymentRequestLifecycleState.ActiveRecurring]: 'active',
  [FfiPaymentRequestLifecycleState.RecoveryRequired]: 'recovery',
  [FfiPaymentRequestLifecycleState.InvalidConflict]: 'invalid',
  [FfiPaymentRequestLifecycleState.Unknown]: 'unknown',
};

function deliveryOf(status: FfiOutboundPrivateMessageStatus | undefined): Delivery | undefined {
  switch (status) {
    case FfiOutboundPrivateMessageStatus.Pending:
    case FfiOutboundPrivateMessageStatus.Sending:
      return 'queued';
    case FfiOutboundPrivateMessageStatus.Sent:
      return 'sent';
    case FfiOutboundPrivateMessageStatus.Failed:
    case FfiOutboundPrivateMessageStatus.Invalid:
    case FfiOutboundPrivateMessageStatus.RecoveryRequired:
      return 'failed';
    default:
      return undefined;
  }
}

/** The SDK's terms as plain strings: FFI objects export their text explicitly. */
export function plainTermsOf(terms: FfiPaymentRequestTerms): PlainTerms {
  const recurrence: Recurrence | undefined = terms.recurrence
    ? {
        every: terms.recurrence.every,
        unit: terms.recurrence.unit,
        startsAt: terms.recurrence.startsAt,
        anchor: terms.recurrence.anchor,
        endsAt: terms.recurrence.endsAt,
      }
    : undefined;
  return {
    amountValue: terms.amount.value,
    amountAsset: terms.amount.asset,
    reference: terms.paymentReference.exportText(),
    proposalExpiresAt: terms.proposalExpiresAt,
    recurrence,
    acceptedIdentifiers: terms.acceptedPaymentEndpointIdentifiers,
    paymentEndpoints: terms.paymentEndpoints ? [...terms.paymentEndpoints.entries()] : undefined,
    requiredAppId: terms.requiredAppId,
    metadataJson: terms.metadata.exportText(),
  };
}

/** One proof recorded in a request, as plain data. */
export type ProofView = {
  eventId: string;
  period?: BillingPeriod;
  paymentAppId: string;
  endpointIdentifier: string;
  conversionQuoteId?: string;
  proofJson: string;
  txHash?: string;
  recordedAtMs?: number;
  /** True for proofs we sent (payer), false for proofs we received (payee). */
  ours: boolean;
};

/** A request for screens: the record's facts in plain data, plus the terms read once. */
export type RequestView = {
  counterparty: string;
  requestId: string;
  role: 'payer' | 'payee' | 'unknown';
  state: RequestState;
  terms?: RequestTermsView;
  /** The proposal stream item the payer approves (acceptance names it). */
  proposalStreamItemId?: bigint;
  accepted: boolean;
  ourDelivery?: Delivery;
  canceledByUs: boolean;
  proofs: ProofView[];
  lastEventAtMs?: number;
};

const viewCache = new WeakMap<FfiPaymentRequestRecord, RequestView>();

export function requestViewOf(record: FfiPaymentRequestRecord): RequestView {
  const cached = viewCache.get(record);
  if (cached) return cached;
  const role = record.localRole === FfiPaymentRequestLocalRole.Payer ? 'payer' : record.localRole === FfiPaymentRequestLocalRole.Payee ? 'payee' : 'unknown';
  let terms: RequestTermsView | undefined;
  try {
    terms = record.terms ? readRequestTerms(plainTermsOf(record.terms)) : undefined;
  } catch {
    terms = undefined;
  }
  const proofs = record.paymentProofs.map((proof): ProofView => {
    let proofJson = '';
    try {
      proofJson = proof.proof.exportText();
    } catch {
      // Unreadable proof object: treated as no proof text.
    }
    return {
      eventId: proof.eventId,
      period: proof.billingPeriod ? { startsAt: proof.billingPeriod.startsAt, endsAt: proof.billingPeriod.endsAt } : undefined,
      paymentAppId: proof.paymentAppId,
      endpointIdentifier: proof.paymentEndpointIdentifier,
      conversionQuoteId: proof.conversionQuoteId,
      proofJson,
      txHash: proofTransactionHash(proofJson),
      recordedAtMs: parseTime(proof.recordedAt),
      ours: proof.outboundMessageId !== undefined,
    };
  });
  const view: RequestView = {
    counterparty: record.counterparty,
    requestId: record.paymentRequestId,
    role,
    state: STATE_OF[record.state] ?? 'unknown',
    terms,
    proposalStreamItemId: record.proposalStreamItemId,
    accepted: record.acceptedEventId !== undefined,
    ourDelivery: deliveryOf(role === 'payee' ? record.proposalOutboundStatus : (record.acceptedOutboundStatus ?? record.rejectedOutboundStatus)),
    canceledByUs: record.canceledOutboundStatus !== undefined,
    proofs,
    lastEventAtMs: parseTime(record.lastEventAt),
  };
  viewCache.set(record, view);
  return view;
}

/** Receipts we retrieved, by payment key (payer side). */
export function receivedReceiptKeys(state: FfiPaykitStateObservation | undefined): Set<string> {
  const keys = new Set<string>();
  for (const receipt of state?.receipts ?? []) {
    if (receipt.paymentRequestId) keys.add(paymentKey(receipt.issuer, receipt.paymentRequestId, receipt.billingPeriod));
  }
  return keys;
}

/**
 * Everything the status words and timeline need (./requestStatus.ts), from
 * the SDK record, the request book and the receipts.
 */
export function requestFactsOf(view: RequestView, book: RequestBook, receipts: ReadonlySet<string>, name: string): RequestFacts {
  const recurrence = view.terms?.recurrence;
  const byKey = new Map<string, PaymentFacts>();
  const factsFor = (period: BillingPeriod | undefined): PaymentFacts => {
    const key = paymentKey(view.counterparty, view.requestId, period);
    let facts = byKey.get(key);
    if (!facts) {
      facts = { key, period, proofRecorded: false };
      byKey.set(key, facts);
    }
    return facts;
  };
  for (const proof of view.proofs) {
    const facts = factsFor(recurrence ? proof.period : undefined);
    facts.proofRecorded = true;
    facts.txHash ??= proof.txHash;
  }
  for (const payment of book.allOutgoing()) {
    if (payment.counterparty !== view.counterparty || payment.requestId !== view.requestId) continue;
    const facts = factsFor(recurrence ? payment.period : undefined);
    facts.outgoing = payment.stage;
    facts.txHash ??= payment.txHash;
  }
  if (!recurrence && byKey.size === 0) factsFor(undefined);
  for (const facts of byKey.values()) {
    const check = book.check(facts.key);
    if (check) {
      facts.check = check.status;
      facts.checkReason = check.reason;
      facts.receipt = check.receipt;
    }
    if (receipts.has(facts.key)) facts.receipt = 'received';
    facts.deferred = book.isDeferred(facts.key);
  }
  const payments = [...byKey.values()].sort((a, b) => (parseTime(a.period?.startsAt) ?? 0) - (parseTime(b.period?.startsAt) ?? 0));
  return {
    role: view.role,
    state: view.state,
    name,
    accepted: view.accepted,
    ourDelivery: view.ourDelivery,
    canceledByUs: view.canceledByUs,
    recurring: !!recurrence,
    payments,
    totalPayments: recurrence ? paymentCount(recurrence) : undefined,
  };
}

// Asking for money (payee) ----------------------------------------------------------

export type RequestMoneyInput = Omit<RequestDraft, 'receivingDetail' | 'nowMs'> & { payer: string };

function isLinkedContact(service: PaykitService, pubky: string): boolean {
  const state = service.getState();
  return (
    !!state?.contacts.some((c) => c.publicKey === pubky) &&
    !!state.linkedPeers.some((p) => p.counterparty === pubky && p.state === FfiLinkedPeerState.Linked)
  );
}

/**
 * Propose a payment request to a Linked contact (proposePaymentRequest),
 * then flush the loop so it leaves now. The SDK only queues it: the
 * returned view says whether it was delivered yet.
 */
export async function requestMoney(service: PaykitService, input: RequestMoneyInput): Promise<RequestView> {
  const { payer } = input;
  if (!isLinkedContact(service, payer)) throw new UserFacingError('You can ask only contacts you have a private connection with.');
  const detail = service.addressCache.privateReceivingDetails(payer)?.find((d) => d.identifier === ENDPOINT_FOR_ASSET[input.asset]);
  if (!detail) throw new UserFacingError('Your address for them is still being set up. Try again in a moment.');
  const nowMs = Date.now();
  const terms = buildRequestTerms({ ...input, receivingDetail: detail, nowMs }, newPaymentReference(nowMs));
  if (proposalMessageBytes(terms) > REQUEST_MESSAGE_BUDGET_BYTES) throw new UserFacingError('The note is too long to send. Shorten it.');

  const ffiTerms: FfiPaymentRequestTerms = {
    amount: terms.amount,
    paymentReference: new FfiPaymentReference(terms.paymentReference),
    proposalExpiresAt: terms.proposalExpiresAt,
    recurrence: terms.recurrence
      ? { every: terms.recurrence.every, unit: terms.recurrence.unit, startsAt: terms.recurrence.startsAt, anchor: terms.recurrence.anchor, endsAt: terms.recurrence.endsAt }
      : undefined,
    acceptedPaymentEndpointIdentifiers: terms.acceptedPaymentEndpointIdentifiers,
    paymentEndpoints: new Map(Object.entries(terms.paymentEndpoints)),
    requiredAppId: terms.requiredAppId,
    conversion: undefined,
    paymentDeadline: undefined,
    metadata: new FfiPrivateJsonObject(JSON.stringify(terms.metadata)),
  };
  const record = await service.call('proposePaymentRequest', (sdk, signal) => sdk.proposePaymentRequest(payer, ffiTerms, { signal }));
  service.log.info(`requested ${terms.amount.asset}${terms.recurrence ? ' (recurring)' : ''} from ${shortKey(payer)}: ${record.paymentRequestId.slice(0, 8)}`);
  await service.refreshState();
  service.syncLoop.flush();
  return requestViewOf(record);
}

/**
 * Payer: accept without paying yet (claimAndAcceptPaymentRequest: claim the
 * request for this app and queue the acceptance in one transaction).
 * `proposalStreamItemId` is the proposal the person saw: if the request
 * was replaced since, the SDK refuses instead of accepting other terms.
 */
export async function acceptRequest(service: PaykitService, counterparty: string, requestId: string, proposalStreamItemId: bigint | undefined): Promise<void> {
  if (proposalStreamItemId === undefined) throw new UserFacingError("This request can't be accepted. Ask them to send it again.");
  await service.call('claimAndAcceptPaymentRequest', (sdk, signal) =>
    sdk.claimAndAcceptPaymentRequest(counterparty, requestId, proposalStreamItemId, { signal }),
  );
  service.log.info(`accepted request ${requestId.slice(0, 8)} from ${shortKey(counterparty)}`);
  await service.refreshState();
  service.syncLoop.flush();
}

/** Payer: say no to a request (rejectPaymentRequest). Allowed while proposed or expired. */
export async function declineRequest(service: PaykitService, counterparty: string, requestId: string): Promise<void> {
  await service.call('rejectPaymentRequest', (sdk, signal) => sdk.rejectPaymentRequest(counterparty, requestId, undefined, { signal }));
  service.log.info(`declined request ${requestId.slice(0, 8)} from ${shortKey(counterparty)}`);
  await service.refreshState();
  service.syncLoop.flush();
}

/**
 * Either side: cancel (cancelPaymentRequest). The payee withdraws a request;
 * the payer stops a recurring one. A payment already broadcast still gets
 * its proof (the spec allows a proof after cancellation for an execution
 * that passed its irreversible point first).
 */
export async function cancelRequest(service: PaykitService, counterparty: string, requestId: string): Promise<void> {
  await service.call('cancelPaymentRequest', (sdk, signal) => sdk.cancelPaymentRequest(counterparty, requestId, undefined, { signal }));
  service.log.info(`canceled request ${requestId.slice(0, 8)} with ${shortKey(counterparty)}`);
  await service.refreshState();
  service.syncLoop.flush();
}

// The payment ledger --------------------------------------------------------------------

/**
 * The SDK's payment ledger refuses every admission until the wallet has
 * reconciled its payment history once ("ReconciliationRequired"). This app
 * pays requests only through this module, so on a fresh install the ledger
 * is the whole history: we attest an empty history. Any attempt the SDK
 * already holds is kept (an empty history never erases evidence), and
 * uncertain ones stay reserved. A production wallet would reconcile its
 * own complete payment records here instead.
 */
async function ensureLedgerReady(service: PaykitService): Promise<void> {
  const state = await service.call('allowanceAccountingState', (sdk, signal) => sdk.allowanceAccountingState({ signal }));
  if (state && !state.requiresReconciliation) return;
  await service.call('reconcileAllowanceAccounting', (sdk, signal) =>
    sdk.reconcileAllowanceAccounting(
      {
        expectedRevision: state?.revision,
        history: { associations: [], occurrences: [], watermarks: [] },
        outcomes: [],
        trustedTime: toRfc3339(Date.now()),
      },
      { signal },
    ),
  );
  service.log.info('payment ledger reconciled (no earlier request payments)');
}

/** A ledger refusal in words. */
function blockedMessage(reason: FfiAllowanceAccountingBlock): string {
  switch (reason.tag) {
    case 'PaymentAlreadyRecorded':
      return 'This payment is already recorded. Check Activity before paying again.';
    case 'InvalidLifecycle':
      return 'This request can no longer be paid.';
    case 'WalletChecksFailed':
      return "This payment doesn't match the request any more.";
    default:
      return "This payment can't start right now. Try again in a moment.";
  }
}

// Paying a request (payer) ----------------------------------------------------------------

/** Everything the payment needs, fixed before the review. */
export type PreparedPayment = {
  key: string;
  counterparty: string;
  requestId: string;
  period?: BillingPeriod;
  asset: RequestAsset;
  amount: bigint;
  address: string;
  endpointIdentifier: string;
  paymentAppId: string;
  needsAcceptance: boolean;
  proposalStreamItemId?: bigint;
  terms: RequestTermsView;
};

function pickEndpoint(resolution: FfiPrivateContactPaymentResolution, counterparty: string, identifier: string) {
  if (resolution.status !== FfiPrivatePaymentResolutionStatus.Payable) return undefined;
  for (const endpoint of resolution.payableEndpoints) {
    if (endpoint.counterparty !== counterparty || endpoint.identifier !== identifier) continue;
    const parsed = parseEndpoint(identifier, endpoint.target.payload.exportText());
    if (parsed) return { address: parsed.address, appId: endpoint.appId };
  }
  return undefined;
}

/**
 * Steps 1-2: claim the request and resolve where the money goes. Nothing is
 * accepted, reserved or sent yet. `period` is required for a recurring
 * request: the billing period being paid.
 */
export async function preparePayment(service: PaykitService, counterparty: string, requestId: string, period?: BillingPeriod): Promise<PreparedPayment> {
  const book = paymentRequestsOf(service).book;
  const record = await service.call('claimPaymentRequestForPreparation', (sdk, signal) =>
    sdk.claimPaymentRequestForPreparation(counterparty, requestId, { signal }),
  );
  const view = requestViewOf(record);
  const terms = view.terms;
  if (!terms || terms.cannotPay || !terms.asset || terms.amount === undefined) throw new UserFacingError(terms?.cannotPay ?? "This request can't be paid from this wallet.");
  if (view.state !== 'proposed' && view.state !== 'accepted' && view.state !== 'active') throw new UserFacingError('This request can no longer be paid.');
  if (terms.expiresAtMs !== undefined && view.state === 'proposed' && terms.expiresAtMs <= Date.now()) throw new UserFacingError('This request has expired.');
  if (terms.recurrence) {
    if (!period || !isScheduledPeriod(terms.recurrence, period)) throw new UserFacingError('That payment is not part of the schedule.');
    if ((parseTime(period.startsAt) ?? Infinity) > Date.now()) throw new UserFacingError("That payment isn't due yet.");
  } else if (period) {
    throw new UserFacingError('This request is paid once.');
  }
  const key = paymentKey(counterparty, requestId, terms.recurrence ? period : undefined);
  await settleUnsentPayment(service, key);
  const paidAlready = view.proofs.some((proof) => (terms.recurrence ? periodKey(proof.period) === periodKey(period) : true));
  if (paidAlready || book.outgoing(key)) throw new UserFacingError('This payment is already on its way. Check the request for its status.');

  const identifier = ENDPOINT_FOR_ASSET[terms.asset];
  let resolution: FfiPrivateContactPaymentResolution;
  try {
    const prepared = await service.call('prepareAndResolvePrivatePaymentRequest', (sdk, signal) =>
      sdk.prepareAndResolvePrivatePaymentRequest(counterparty, requestId, undefined, PAYKIT_LINK_ADVANCE_STEPS, { signal }),
    );
    resolution = prepared.resolution;
  } catch (error) {
    service.log.warn(`prepare request payment to ${shortKey(counterparty)}: ${describeError(error)}; resolving from saved state`);
    resolution = await service.call('resolvePrivatePaymentRequest', (sdk, signal) =>
      sdk.resolvePrivatePaymentRequest(counterparty, requestId, undefined, { signal }),
    );
  }
  const endpoint = pickEndpoint(resolution, counterparty, identifier);
  if (!endpoint) throw new UserFacingError("Couldn't find where to pay this request. Try again in a moment.");
  // The request binds the address; the resolution must agree with it.
  if (terms.endpoint && terms.endpoint.address !== endpoint.address) throw new UserFacingError("The request's address doesn't match. Don't pay it.");

  return {
    key,
    counterparty,
    requestId,
    period: terms.recurrence ? period : undefined,
    asset: terms.asset,
    amount: terms.amount,
    address: endpoint.address,
    endpointIdentifier: identifier,
    paymentAppId: endpoint.appId,
    needsAcceptance: view.state === 'proposed',
    proposalStreamItemId: view.proposalStreamItemId,
    terms,
  };
}

function executionChecks(prepared: PreparedPayment): FfiPaymentExecutionChecks {
  return {
    trustedTime: toRfc3339(Date.now()),
    paymentEndpointIdentifier: prepared.endpointIdentifier,
    actualAmount: new FfiAccountingAmount(toPaykitDecimal(prepared.amount, prepared.asset), prepared.asset),
    // Our endpoints are stable addresses: always current, never consumed.
    endpointCurrent: true,
    // The person tapped Pay on the review that showed this exact payment.
    localEnabled: true,
    // preparePayment checked the period is on the schedule and has started.
    recurrenceEligible: true,
  };
}

/** The SDK record for a request, from the last observed state. */
function findRequestRecord(service: PaykitService, counterparty: string, requestId: string): FfiPaymentRequestRecord | undefined {
  return service.getState()?.paymentRequests.find((r) => r.counterparty === counterparty && r.paymentRequestId === requestId);
}

/** What the book remembers for a payment the ledger admitted. */
function outgoingFor(prepared: PreparedPayment, attemptId: string, stage: OutgoingPayment['stage']): OutgoingPayment {
  return {
    counterparty: prepared.counterparty,
    requestId: prepared.requestId,
    period: prepared.period,
    asset: prepared.asset,
    amount: prepared.amount.toString(),
    address: prepared.address,
    endpointIdentifier: prepared.endpointIdentifier,
    paymentAppId: prepared.paymentAppId,
    attemptId,
    stage,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Steps 3-5, when the person taps Pay: accept if needed, then let the
 * ledger admit this occurrence and issue a handoff. Returns the attempt id;
 * the caller sends with WDK right after and reports with finishPayment.
 * Safe to call again after it threw: an acceptance already queued is not
 * sent twice, and an attempt that got no handoff is released.
 */
export async function startPayment(service: PaykitService, prepared: PreparedPayment): Promise<string> {
  const book = paymentRequestsOf(service).book;
  await settleUnsentPayment(service, prepared.key);
  if (book.outgoing(prepared.key)) throw new UserFacingError('This payment is already on its way. Check the request for its status.');
  // Read the record again rather than trusting `prepared`: a first tap may
  // have accepted already, and the SDK refuses a second acceptance.
  const acceptedByUs = findRequestRecord(service, prepared.counterparty, prepared.requestId)?.acceptedEventId !== undefined;
  if (prepared.needsAcceptance && !acceptedByUs) {
    if (prepared.proposalStreamItemId === undefined) throw new UserFacingError("This request can't be accepted. Ask them to send it again.");
    const expiresAtMs = prepared.terms.expiresAtMs;
    if (expiresAtMs !== undefined && expiresAtMs - Date.now() < ACCEPT_AND_PAY_MARGIN_MS) {
      throw new UserFacingError('This request expires in under 2 minutes, too soon for your answer to reach them. Ask them to send it again.');
    }
    const streamItemId = prepared.proposalStreamItemId;
    await service.call('claimAndAcceptPaymentRequest', (sdk, signal) =>
      sdk.claimAndAcceptPaymentRequest(prepared.counterparty, prepared.requestId, streamItemId, { signal }),
    );
    service.log.info(`accepted request ${prepared.requestId.slice(0, 8)} from ${shortKey(prepared.counterparty)}`);
    await service.refreshState();
    service.syncLoop.flush();
  }
  await waitForOurAcceptance(service, prepared);
  await ensureLedgerReady(service);

  const occurrence = { request: { counterparty: prepared.counterparty, paymentRequestId: prepared.requestId }, billingPeriod: prepared.period };
  const reserved = await service.call('reserveManualPayment', (sdk, signal) => sdk.reserveManualPayment(occurrence, executionChecks(prepared), { signal }));
  if (!FfiPaymentAttemptDecision.Ready.instanceOf(reserved)) throw new UserFacingError(blockedMessage(reserved.inner.reason));
  const attemptId = reserved.inner.attempt.attemptId;

  // No handoff (a Blocked decision, or the call itself failed): nothing was
  // sent, so release the attempt, or the ledger blocks every later try.
  const release = () =>
    releaseUnsentPayment(service, prepared.key, outgoingFor(prepared, attemptId, 'not-sent')).catch((e) =>
      service.log.warn(`release unsent payment: ${describeError(e)} (retrying next round)`),
    );
  let begun: Awaited<ReturnType<typeof beginExecution>>;
  try {
    begun = await beginExecution(service, attemptId, prepared);
  } catch (error) {
    await release();
    throw error;
  }
  if (!FfiPaymentAttemptDecision.Ready.instanceOf(begun)) {
    await release();
    throw new UserFacingError(blockedMessage(begun.inner.reason));
  }
  // Written before WDK sends: from here on, a restart finds this payment
  // and never offers to pay it again.
  book.setOutgoing(prepared.key, outgoingFor(prepared, attemptId, 'sending'));
  service.log.info(`paying request ${prepared.requestId.slice(0, 8)}: handoff issued`);
  return attemptId;
}

/** Paying a request we accept now needs at least this long before it expires. */
export const ACCEPT_AND_PAY_MARGIN_MS = 2 * 60_000;
/** How long Pay waits for our acceptance to leave before giving up (nothing is paid then). */
const ACCEPTANCE_SEND_WAIT_MS = 20_000;

/**
 * Pay only once our acceptance has left. The payee's SDK judges an
 * acceptance by when it *fetches* it: one fetched after the proposal's
 * expiry makes the request invalid on its side, and a proof for it is then
 * ignored, so money paid for it is never checked or receipted. Waiting
 * until the acceptance is published narrows that window to the payee's own
 * fetch delay. The Paykit SDK gives the payer no signal that the payee has
 * stored it (Delivery Confirmations are not exposed), so the rest of the
 * risk stays; docs/ARCHITECTURE.md ("Payment requests") describes it.
 */
async function waitForOurAcceptance(service: PaykitService, prepared: PreparedPayment): Promise<void> {
  const statusNow = () => findRequestRecord(service, prepared.counterparty, prepared.requestId)?.acceptedOutboundStatus;
  // Undefined: accepted before this app saw it, or not ours to send.
  if (statusNow() === undefined || deliveryOf(statusNow()) === 'sent') return;
  const expiresAtMs = prepared.terms.expiresAtMs;
  if (expiresAtMs !== undefined && expiresAtMs <= Date.now()) {
    throw new UserFacingError('This request expired before your answer reached them. Ask them to send it again.');
  }
  const deadline = Date.now() + ACCEPTANCE_SEND_WAIT_MS;
  while (Date.now() < deadline) {
    service.syncLoop.flush();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (deliveryOf(statusNow()) === 'sent') return;
  }
  throw new UserFacingError("Your answer to the request hasn't gone out yet, so nothing was paid. Try again in a moment.");
}

function beginExecution(service: PaykitService, attemptId: string, prepared: PreparedPayment) {
  return service.call('beginPaymentExecution', (sdk, signal) => sdk.beginPaymentExecution(attemptId, executionChecks(prepared), { signal }));
}

/**
 * A payment that never left the wallet: record Failed in the ledger (which
 * frees the request or period to be paid again), then forget it. Recorded
 * first, so a failed ledger call leaves a 'not-sent' entry that the next
 * round or the next Pay retries; forgetting first would leave the ledger
 * blocking the request with nothing to clear it.
 */
async function releaseUnsentPayment(service: PaykitService, key: string, entry: OutgoingPayment): Promise<void> {
  const book = paymentRequestsOf(service).book;
  try {
    await recordOutcome(service, entry.attemptId, FfiPaymentOutcome.Failed);
  } catch (error) {
    if ((await attemptStatus(service, entry.attemptId)) !== FfiPaymentExecutionStatus.Failed) {
      book.setOutgoing(key, { ...entry, stage: 'not-sent', updatedAt: Date.now() });
      throw error;
    }
    // Already Failed (a retry after the first call went through): done.
  }
  book.forgetOutgoing(key);
}

/** Retry a 'not-sent' entry's release, if there is one. Never throws: a failure leaves the entry for later. */
export async function settleUnsentPayment(service: PaykitService, key: string): Promise<void> {
  const entry = paymentRequestsOf(service).book.outgoing(key);
  if (entry?.stage !== 'not-sent') return;
  try {
    await releaseUnsentPayment(service, key, entry);
    service.log.info(`released an unsent payment of ${entry.requestId.slice(0, 8)}`);
  } catch (error) {
    service.log.warn(`release unsent payment: ${describeError(error)}`);
  }
}

/** The ledger's status for one attempt, or undefined if it can't be read. */
async function attemptStatus(service: PaykitService, attemptId: string): Promise<FfiPaymentExecutionStatus | undefined> {
  try {
    const state = await service.call('allowanceAccountingState', (sdk, signal) => sdk.allowanceAccountingState({ signal }));
    for (const occurrence of state?.history.occurrences ?? []) {
      const attempt = occurrence.attempts.find((a) => a.attemptId === attemptId);
      if (attempt) return attempt.status;
    }
  } catch {
    // Unreadable: the caller treats it as "not known to be Failed".
  }
  return undefined;
}

export async function recordOutcome(service: PaykitService, attemptId: string, outcome: FfiPaymentOutcome): Promise<void> {
  await service.call('recordPaymentOutcome', (sdk, signal) => sdk.recordPaymentOutcome({ attemptId, outcome }, { signal }));
}

/**
 * After WDK's send: record what happened. A hash means the money left:
 * Bitcoin's proof goes out now; USD₮'s waits for the block (the round hook
 * signs and submits it). A failure before the broadcast releases the
 * reservation; an unclear one keeps it, so nothing invites a second payment.
 */
export async function finishPayment(
  service: PaykitService,
  prepared: PreparedPayment,
  attemptId: string,
  result: { hash: string } | { failure: 'not-sent' | 'unknown' },
): Promise<void> {
  const book = paymentRequestsOf(service).book;
  if ('failure' in result) {
    if (result.failure === 'not-sent') {
      const entry = book.outgoing(prepared.key) ?? outgoingFor(prepared, attemptId, 'sending');
      await releaseUnsentPayment(service, prepared.key, entry).catch((e) => service.log.warn(`record failed payment: ${describeError(e)} (retrying next round)`));
    } else {
      book.updateOutgoing(prepared.key, { stage: 'unknown', outcome: 'unknown' });
      await recordOutcome(service, attemptId, FfiPaymentOutcome.Unknown).catch((e) => service.log.warn(`record unknown payment: ${describeError(e)}`));
    }
    return;
  }
  const payment = book.updateOutgoing(prepared.key, { stage: 'broadcast', txHash: result.hash });
  service.log.info(`paid request ${prepared.requestId.slice(0, 8)}: ${prepared.asset} transaction broadcast`);
  if (payment && payment.asset === 'btc') {
    try {
      await submitProof(service, prepared.key, payment, btcProofJson(result.hash));
    } catch (error) {
      service.log.warn(`proof for ${prepared.requestId.slice(0, 8)}: ${describeError(error)} (retrying next round)`);
    }
  }
  service.syncLoop.flush();
}

/**
 * Queue the proof (submitPaymentProof) unless the request already holds
 * one for this payment (a retry after a crash between the two steps).
 */
export async function submitProof(service: PaykitService, key: string, payment: OutgoingPayment, proofJson: string): Promise<void> {
  const book = paymentRequestsOf(service).book;
  const record = service.getState()?.paymentRequests.find((r) => r.counterparty === payment.counterparty && r.paymentRequestId === payment.requestId);
  const already = record
    ? requestViewOf(record).proofs.some((p) => p.ours && periodKey(p.period) === periodKey(payment.period) && p.txHash === proofTransactionHash(proofJson))
    : false;
  if (!already) {
    await service.call('submitPaymentProof', (sdk, signal) =>
      sdk.submitPaymentProof(
        payment.counterparty,
        payment.requestId,
        {
          billingPeriod: payment.period,
          paymentAppId: payment.paymentAppId,
          paymentEndpointIdentifier: payment.endpointIdentifier,
          allowanceId: undefined,
          conversionQuoteId: undefined,
          proof: new FfiPrivateJsonObject(proofJson),
        },
        { signal },
      ),
    );
    service.log.info(`sent payment proof for ${payment.requestId.slice(0, 8)}`);
  }
  book.updateOutgoing(key, { stage: 'proof-sent', problem: undefined });
  await service.refreshState('background');
  service.syncLoop.flush();
}

/**
 * Recurring: put one billing period off (deferPaymentOccurrence). The
 * ledger keeps the decision; paying it later runs every check again.
 */
export async function deferPayment(service: PaykitService, counterparty: string, requestId: string, period: BillingPeriod): Promise<void> {
  await ensureLedgerReady(service);
  await service.call('deferPaymentOccurrence', (sdk, signal) =>
    sdk.deferPaymentOccurrence({ request: { counterparty, paymentRequestId: requestId }, billingPeriod: period }, 'payer_postponed', { signal }),
  );
  paymentRequestsOf(service).book.setDeferred(paymentKey(counterparty, requestId, period), Date.now());
  service.log.info(`put off a payment of ${requestId.slice(0, 8)}`);
}

/** A fresh, caller-stable receipt id (receipts are retry-safe with one). */
export function newReceiptId(): string {
  return Crypto.randomUUID();
}
