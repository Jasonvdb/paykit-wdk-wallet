// Which on-chain transactions paid which payment requests, for Activity.
//
// A transaction hash is public, so naming one proves nothing: any contact
// we sent a request to could send a proof that names someone else's
// payment to us. The spec says the wallet "must not claim verified Paykit
// contact or request attribution solely from a publicly visible
// transaction hash". So a transaction is linked to a request only when we
// know it is that payment:
//
//   payer  our own payments: the proofs we sent, and payments in flight
//          from the request book (we broadcast them ourselves)
//   payee  a proof whose transaction our on-chain check verified
//          (./paymentProofs.ts), for that same transaction
//
// A proof that is still being checked, or didn't check out, shows on the
// request's own page only. Activity then puts the person's name on the
// row (src/features/wallet/activity/activityPeople.ts), so this is what
// stops "Mallory paid you" on someone else's payment.
//
// Pure (type imports only), unit tested.
import type { BillingPeriod } from './recurrence';
import { paymentKey, type RequestBook } from './requestBook';
import type { RequestView } from './requests';

/** What links an on-chain transaction to a payment request (Activity rows and detail). */
export type RequestLink = {
  counterparty: string;
  requestId: string;
  role: 'payer' | 'payee';
  period?: BillingPeriod;
  /** Payer: receipt retrieved. Payee: receipt sent. */
  receipt?: 'received' | 'sent';
};

/** Transaction hash (lowercase) -> the request it paid. */
export function requestLinksOf(
  views: readonly RequestView[],
  book: Pick<RequestBook, 'check' | 'allOutgoing'>,
  receipts: ReadonlySet<string>,
): Map<string, RequestLink> {
  const links = new Map<string, RequestLink>();
  // First write wins: every link here is trusted, and none may replace another.
  const add = (txHash: string, link: RequestLink) => {
    const hash = txHash.toLowerCase();
    if (!links.has(hash)) links.set(hash, link);
  };
  for (const view of views) {
    if (view.role === 'unknown') continue;
    const recurring = !!view.terms?.recurrence;
    for (const proof of view.proofs) {
      if (!proof.txHash) continue;
      const period = recurring ? proof.period : undefined;
      const key = paymentKey(view.counterparty, view.requestId, period);
      if (view.role === 'payer') {
        if (!proof.ours) continue;
        add(proof.txHash, { counterparty: view.counterparty, requestId: view.requestId, role: 'payer', period, receipt: receipts.has(key) ? 'received' : undefined });
        continue;
      }
      const check = book.check(key);
      if (proof.ours || check?.status !== 'verified' || check.txHash?.toLowerCase() !== proof.txHash.toLowerCase()) continue;
      add(proof.txHash, { counterparty: view.counterparty, requestId: view.requestId, role: 'payee', period, receipt: check.receipt === 'sent' ? 'sent' : undefined });
    }
  }
  for (const payment of book.allOutgoing()) {
    if (payment.txHash) add(payment.txHash, { counterparty: payment.counterparty, requestId: payment.requestId, role: 'payer', period: payment.period });
  }
  return links;
}
