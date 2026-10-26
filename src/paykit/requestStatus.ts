// A payment request's status in words, and its timeline:
//
//   Requested -> Accepted -> Paid (proof) -> Verified -> Receipt
//
// Four sources feed it, and they stay separate on purpose ("a submitted
// proof is not a settlement"):
//   the SDK lifecycle     proposed / accepted / rejected / canceled /
//                         proof submitted / active recurring (observeState)
//   delivery              whether our own event has left the outbound queue
//   the payer's wallet    payment in flight, from the request book
//   the payee's checks    the on-chain verification, from the request book
//   receipts              issued (payee) or retrieved (payer)
// The payer never sees the payee's check: it learns the payment was
// verified when the receipt arrives, since a receipt is only issued after
// the check passed.
//
// Pure: no native imports, unit tested.
import type { OutgoingPayment, ProofCheck } from './requestBook';
import type { BillingPeriod } from './recurrence';

export type RequestState =
  | 'proposed'
  | 'expired'
  | 'accepted'
  | 'rejected'
  | 'canceled'
  | 'proof-submitted'
  | 'active'
  | 'recovery'
  | 'invalid'
  | 'unknown';

export type Delivery = 'queued' | 'sent' | 'failed';

export type PaymentFacts = {
  key: string;
  period?: BillingPeriod;
  /** A proof is recorded in the request (sent by us as payer, or received as payee). */
  proofRecorded: boolean;
  txHash?: string;
  /** Payer: our payment in flight. */
  outgoing?: OutgoingPayment['stage'];
  /** Payee: our on-chain check. */
  check?: ProofCheck['status'];
  checkReason?: string;
  /** Payee: receipt issued; payer: receipt retrieved. */
  receipt?: 'preparing' | 'sent' | 'failed' | 'received';
  deferred?: boolean;
};

export type RequestFacts = {
  role: 'payer' | 'payee' | 'unknown';
  state: RequestState;
  /** What to call the other person. */
  name: string;
  accepted: boolean;
  /** Payee: our proposal; payer: our acceptance or rejection. */
  ourDelivery?: Delivery;
  canceledByUs: boolean;
  recurring: boolean;
  /** One-time: at most one; recurring: one per period with any activity. */
  payments: PaymentFacts[];
  /** Recurring: how many periods in total, if the schedule ends. */
  totalPayments?: number;
};

const TERMINAL: RequestState[] = ['rejected', 'canceled', 'expired', 'invalid'];

export function isTerminal(state: RequestState): boolean {
  return TERMINAL.includes(state);
}

/** A payment is done for the people involved once the payee verified it (payee) or the receipt arrived (payer). */
export function isPaymentSettled(payment: PaymentFacts, role: RequestFacts['role']): boolean {
  return role === 'payee' ? payment.check === 'verified' : payment.receipt === 'received';
}

/**
 * The money left: a proof is recorded (ours or theirs), or our transaction
 * is broadcast. What "paid" counts on every screen ("2 of 3 paid", the
 * timeline's Paid step).
 */
export function isPaymentMade(payment: PaymentFacts): boolean {
  return payment.proofRecorded || payment.outgoing === 'broadcast' || payment.outgoing === 'proof-sent';
}

/**
 * Don't offer to pay it again: made, or our payment may be under way
 * ('sending', or 'unknown' when the send may have reached the network).
 * A 'not-sent' payment never left, so it can be paid again.
 */
export function isPaymentHandled(payment: PaymentFacts): boolean {
  return isPaymentMade(payment) || payment.outgoing === 'sending' || payment.outgoing === 'unknown';
}

function paidCount(facts: RequestFacts): number {
  return facts.payments.filter(isPaymentMade).length;
}

/** One payment's status in words (one-time requests and each recurring period). */
export function paymentWords(payment: PaymentFacts | undefined, facts: Pick<RequestFacts, 'role' | 'name'>): string | undefined {
  if (!payment) return undefined;
  if (facts.role === 'payer') {
    if (payment.receipt === 'received') return 'Paid, receipt received';
    if (payment.outgoing === 'unknown') return 'May have been paid. Check Activity';
    if (payment.outgoing === 'sending') return 'Paying…';
    if (payment.outgoing === 'not-sent') return "The last try didn't go through. You can pay it again";
    if (payment.outgoing === 'broadcast') return 'Paid, sending the proof';
    if (payment.proofRecorded || payment.outgoing === 'proof-sent') return `Paid, waiting for ${facts.name}'s receipt`;
    if (payment.deferred) return 'Put off for now';
    return undefined;
  }
  if (payment.check === 'verified') return payment.receipt === 'sent' ? 'Paid, receipt sent' : 'Paid and checked on chain';
  if (payment.check === 'rejected') return "The payment didn't check out";
  if (payment.proofRecorded) return 'Paid, checking on chain';
  return undefined;
}

/** The request's status in one line, for rows. */
export function requestStatusWords(facts: RequestFacts): string {
  const { name, role, state } = facts;
  switch (state) {
    case 'expired':
      return 'Expired';
    case 'rejected':
      return role === 'payee' ? `${name} declined` : 'You declined';
    case 'canceled':
      return facts.canceledByUs ? 'You canceled it' : `${name} canceled it`;
    case 'recovery':
      return 'Reconnecting with them…';
    case 'invalid':
    case 'unknown':
      return "Couldn't read this request";
    default:
      break;
  }
  if (facts.recurring && (state === 'active' || facts.accepted)) {
    const paid = paidCount(facts);
    return facts.totalPayments ? `Active: ${paid} of ${facts.totalPayments} paid` : `Active: ${paid} paid`;
  }
  const payment = paymentWords(facts.payments[0], facts);
  if (payment) return payment;
  if (state === 'proposed') {
    if (role === 'payee') return facts.ourDelivery === 'queued' ? 'Waiting to reach them…' : `Waiting for ${name}`;
    return 'Waiting for you';
  }
  if (state === 'accepted') return role === 'payee' ? `${name} accepted, not paid yet` : 'Accepted, not paid yet';
  return 'Open';
}

export type TimelineStep = {
  key: 'requested' | 'accepted' | 'paid' | 'verified' | 'receipt';
  label: string;
  detail?: string;
  state: 'done' | 'current' | 'todo' | 'stopped';
};

/**
 * The vertical timeline for one payment of a request: the whole request
 * when it is one-time, or the request plus one period when recurring.
 */
export function requestTimeline(facts: RequestFacts, payment: PaymentFacts | undefined): TimelineStep[] {
  const { name, role, state } = facts;
  const payer = role === 'payer';
  const steps: TimelineStep[] = [];

  steps.push({
    key: 'requested',
    label: payer ? `${name} asked you` : `You asked ${name}`,
    detail: !payer ? (facts.ourDelivery === 'queued' ? 'Waiting to reach them. It sends by itself.' : facts.ourDelivery === 'failed' ? "Couldn't send it yet. Retrying." : 'Delivered') : undefined,
    state: 'done',
  });

  const stoppedBeforeAccept = !facts.accepted && isTerminal(state);
  if (stoppedBeforeAccept) {
    steps.push({ key: 'accepted', label: requestStatusWords(facts), state: 'stopped' });
    return steps;
  }
  steps.push({
    key: 'accepted',
    label: facts.accepted ? (payer ? 'You accepted' : `${name} accepted`) : payer ? 'Accept to pay' : `Waiting for ${name} to accept`,
    detail: facts.accepted && payer && facts.ourDelivery === 'queued' ? 'Sending your answer…' : undefined,
    state: facts.accepted ? 'done' : 'current',
  });

  const paid = !!payment && isPaymentMade(payment);
  const canceledNow = state === 'canceled' && !paid;
  steps.push({
    key: 'paid',
    label: paid ? (payer ? 'You paid' : `${name} paid`) : canceledNow ? requestStatusWords(facts) : 'Paid',
    detail: payment?.outgoing === 'unknown' ? 'The send may have reached the network. Check Activity before paying again.' : payment?.txHash ? `Transaction ${payment.txHash.slice(0, 10)}…` : undefined,
    state: paid ? 'done' : canceledNow ? 'stopped' : facts.accepted ? 'current' : 'todo',
  });
  if (canceledNow) return steps;

  const verified = payer ? payment?.receipt === 'received' : payment?.check === 'verified';
  const rejected = !payer && payment?.check === 'rejected';
  steps.push({
    key: 'verified',
    label: verified ? (payer ? `${name} checked it on chain` : 'Checked on chain') : rejected ? "Didn't check out" : 'Checked on chain',
    detail: rejected ? payment?.checkReason : !verified && paid ? (payer ? `Waiting for ${name} to check it` : payment?.checkReason ?? 'Checking…') : undefined,
    state: verified ? 'done' : rejected ? 'stopped' : paid ? 'current' : 'todo',
  });
  if (rejected) return steps;

  const receiptDone = payer ? payment?.receipt === 'received' : payment?.receipt === 'sent';
  steps.push({
    key: 'receipt',
    label: receiptDone ? (payer ? `Receipt from ${name}` : `Receipt sent to ${name}`) : 'Receipt',
    detail: !receiptDone && verified ? (payment?.receipt === 'failed' ? "Couldn't send it yet. Retrying." : 'Sending…') : undefined,
    state: receiptDone ? 'done' : verified ? 'current' : 'todo',
  });
  return steps;
}
