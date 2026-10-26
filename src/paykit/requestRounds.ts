// Payment request work that happens in the background, once per sync round.
//
// Three round hooks, each cheap when there is nothing to do (it reads the
// last observed state and the request book; it calls the SDK or WDK only
// for work that is due) and idempotent (running twice does the same as
// once: every step checks what is already done first):
//
//   payment-request-payments  payer: finish our payments after the
//                             broadcast. Submit a proof that has not gone
//                             out (USD₮: once the transaction is in a
//                             block, signed by WDK), and record the
//                             outcome in the ledger once it is confirmed,
//                             or Failed if it reverted.
//   payment-request-proofs    payee: check each proof that arrived on
//                             chain, through WDK (./paymentProofs.ts has
//                             the rules), then issue a receipt
//                             (issueReceipt: the encrypted receipt goes to
//                             our homeserver, the access key to the payer).
//   payment-request-receipts  payer: retrieve receipts the payee sent
//                             (receiptAccess -> retrieveReceipt).
//
// Recurring requests need no round hook of their own: which period is due
// is computed from the terms when a screen asks (./recurrence.ts), and each
// period is paid by the person, one tap each (there is no Allowance for
// automatic payment in this app).
import {
  FfiPaymentOutcome,
  FfiPaymentReference,
  FfiPrivateJsonObject,
  FfiReceiptIssuanceStatus,
  FfiReceiptRetrievalStatus,
} from '@synonymdev/react-native-paykit';

import { SEPOLIA_CHAIN_ID, SEPOLIA_USDT } from '../config/chains';
import { PAYKIT_APP_ID } from '../config/paykit';
import { erc20PaymentTypedData } from '../wallet/erc20PaymentProof';
import { findErc20TransferLog } from '../wallet/paymentEvidence';
import { toPaykitDecimal } from '../wallet/amounts';
import { describeError } from './errors';
import { bareKey, shortKey } from './keys';
import type { PaykitService } from './PaykitService';
import { erc20ProofJson, btcProofJson, parseProof, transferKey, verifyBtcProof, verifyErc20Proof, type Verdict } from './paymentProofs';
import { isScheduledPeriod, parseTime, periodKey } from './recurrence';
import { paymentKey, type OutgoingPayment } from './requestBook';
import type { SyncRoundContext } from './syncLoop';
import { newReceiptId, recordOutcome, requestViewOf, submitProof, type PaymentRequests, type ProofView, type RequestView } from './requests';

/** How often to look again at something still waiting on the chain. */
const CHAIN_RECHECK_MS = 10_000;
/** After a failure (network, worklet), wait longer. */
const FAILURE_BACKOFF_MS = 30_000;
/** Look for receipts at least this often while one is expected, even if nothing arrived. */
const RECEIPT_SCAN_MS = 30_000;

export function registerRequestRounds(service: PaykitService, requests: PaymentRequests): void {
  service.syncLoop.addRoundHook('payment-request-payments', () => finishOurPayments(service, requests));
  service.syncLoop.addRoundHook('payment-request-proofs', () => checkArrivedProofs(service, requests));
  let lastReceiptScan = 0;
  service.syncLoop.addRoundHook('payment-request-receipts', async (context: SyncRoundContext) => {
    const now = Date.now();
    const expecting = requests.book.allOutgoing().some((p) => p.stage === 'proof-sent');
    if (context.receivedFrom.length === 0 && !(expecting && now - lastReceiptScan > RECEIPT_SCAN_MS)) return;
    lastReceiptScan = now;
    await retrieveReceipts(service);
  });
}

// Payer: after the broadcast -----------------------------------------------------------

async function finishOurPayments(service: PaykitService, requests: PaymentRequests): Promise<void> {
  const book = requests.book;
  const now = Date.now();
  for (const payment of book.allOutgoing()) {
    const key = paymentKey(payment.counterparty, payment.requestId, payment.period);
    const needsProof = payment.stage === 'broadcast';
    const needsOutcome = (payment.stage === 'broadcast' || payment.stage === 'proof-sent') && payment.outcome === undefined;
    if (!payment.txHash || (!needsProof && !needsOutcome) || (payment.nextCheckAt ?? 0) > now) continue;
    try {
      if (payment.asset === 'btc') await finishBtcPayment(service, requests, key, payment, needsProof);
      else await finishUsdtPayment(service, requests, key, payment, needsProof);
    } catch (error) {
      service.log.warn(`finish payment ${payment.requestId.slice(0, 8)}: ${describeError(error)}`);
      book.updateOutgoing(key, { nextCheckAt: Date.now() + FAILURE_BACKOFF_MS, problem: 'Still sending the proof. Retrying.' });
    }
  }
}

async function finishBtcPayment(service: PaykitService, requests: PaymentRequests, key: string, payment: OutgoingPayment, needsProof: boolean) {
  const txHash = payment.txHash ?? '';
  if (needsProof) await submitProof(service, key, payment, btcProofJson(txHash));
  const chain = requests.getChain();
  if (!chain || payment.outcome !== undefined) return;
  const status = await chain.btcSent(txHash);
  if (!status.confirmed) {
    requests.book.updateOutgoing(key, { nextCheckAt: Date.now() + CHAIN_RECHECK_MS });
    return;
  }
  await recordOutcome(service, payment.attemptId, FfiPaymentOutcome.Succeeded);
  requests.book.updateOutgoing(key, { outcome: 'succeeded' });
  service.log.info(`payment for ${payment.requestId.slice(0, 8)} confirmed`);
}

async function finishUsdtPayment(service: PaykitService, requests: PaymentRequests, key: string, payment: OutgoingPayment, needsProof: boolean) {
  const chain = requests.getChain();
  const from = service.addressCache.getPublicAddresses().evm;
  if (!chain || !from) return;
  const txHash = payment.txHash ?? '';
  const tx = await chain.evmTransaction(txHash);
  if (tx.state === 'unknown' || tx.state === 'pending') {
    requests.book.updateOutgoing(key, { nextCheckAt: Date.now() + CHAIN_RECHECK_MS });
    return;
  }
  if (tx.state === 'failed' || tx.state === 'dropped') {
    // It never paid: release the ledger reservation, so the request can be paid again.
    await recordOutcome(service, payment.attemptId, FfiPaymentOutcome.Failed);
    requests.book.forgetOutgoing(key);
    service.log.warn(`payment for ${payment.requestId.slice(0, 8)} ${tx.state} on chain; it can be paid again`);
    return;
  }
  if (payment.outcome === undefined) {
    await recordOutcome(service, payment.attemptId, FfiPaymentOutcome.Succeeded);
    requests.book.updateOutgoing(key, { outcome: 'succeeded' });
  }
  if (!needsProof) return;
  const logIndex = findErc20TransferLog(tx.logs, { token: SEPOLIA_USDT, from, to: payment.address, amount: BigInt(payment.amount) });
  if (logIndex === undefined) {
    requests.book.updateOutgoing(key, { nextCheckAt: Date.now() + FAILURE_BACKOFF_MS, problem: "Couldn't find the transfer in the transaction." });
    return;
  }
  const record = service.getState()?.paymentRequests.find((r) => r.counterparty === payment.counterparty && r.paymentRequestId === payment.requestId);
  const reference = record?.terms?.paymentReference.exportText();
  if (!reference) return;
  const typed = erc20PaymentTypedData(SEPOLIA_CHAIN_ID, {
    transactionHash: txHash.toLowerCase(),
    receiptLogIndex: String(logIndex),
    request: {
      payer: bareKey(service.publicKey),
      payee: bareKey(payment.counterparty),
      paymentAppId: payment.paymentAppId,
      paymentRequestId: payment.requestId,
      paymentReference: reference,
      paymentEndpointIdentifier: payment.endpointIdentifier,
      periodStartsAt: payment.period?.startsAt ?? '',
      periodEndsAt: payment.period?.endsAt ?? '',
      conversionQuoteId: '',
    },
  });
  const signature = await chain.signErc20Payment(typed);
  await submitProof(service, key, payment, erc20ProofJson({ transactionHash: txHash, receiptLogIndex: String(logIndex), signature }));
}

// Payee: check proofs, issue receipts ---------------------------------------------------

async function checkArrivedProofs(service: PaykitService, requests: PaymentRequests): Promise<void> {
  const state = service.getState();
  if (!state) return;
  for (const record of state.paymentRequests) {
    if (record.paymentProofs.length === 0) continue;
    const view = requestViewOf(record);
    if (view.role !== 'payee' || view.state === 'rejected') continue;
    // Newest proof per payment: a later proof for the same period corrects an earlier one.
    const latest = new Map<string, ProofView>();
    for (const proof of view.proofs) {
      if (proof.ours) continue;
      latest.set(paymentKey(view.counterparty, view.requestId, view.terms?.recurrence ? proof.period : undefined), proof);
    }
    for (const [key, proof] of latest) {
      try {
        await checkOneProof(service, requests, view, key, proof);
      } catch (error) {
        service.log.warn(`check proof for ${view.requestId.slice(0, 8)}: ${describeError(error)}`);
        requests.book.updateCheck(key, { nextCheckAt: Date.now() + FAILURE_BACKOFF_MS });
      }
    }
  }
}

async function checkOneProof(service: PaykitService, requests: PaymentRequests, view: RequestView, key: string, proof: ProofView): Promise<void> {
  const book = requests.book;
  const existing = book.check(key);
  const now = Date.now();
  // A verified payment stays verified; a later (corrective) proof changes nothing.
  if (existing?.status === 'verified') {
    if (existing.receipt !== 'sent') await issueReceiptFor(service, requests, view, key, proof);
    return;
  }
  if (existing?.proofEventId === proof.eventId && (existing.status === 'rejected' || existing.nextCheckAt > now)) return;
  const chain = requests.getChain();
  if (!chain) return;

  const verdict = await verdictFor(service, requests, view, key, proof);
  const parsed = parseProof(proof.proofJson);
  book.setCheck(key, {
    status: verdict.status,
    reason: verdict.status === 'verified' ? undefined : verdict.reason,
    proofEventId: proof.eventId,
    transferKey: parsed ? transferKey(parsed) : undefined,
    txHash: proof.txHash,
    checkedAt: now,
    nextCheckAt: verdict.status === 'pending' ? now + CHAIN_RECHECK_MS : Number.MAX_SAFE_INTEGER,
  });
  if (verdict.status !== existing?.status || existing?.proofEventId !== proof.eventId) {
    service.log.info(`proof for ${view.requestId.slice(0, 8)}: ${verdict.status}${verdict.status === 'verified' ? '' : ` (${verdict.reason})`}`);
  }
  if (verdict.status === 'verified') await issueReceiptFor(service, requests, view, key, proof);
}

/** The checks of ./paymentProofs.ts, fed from the request and from WDK. */
async function verdictFor(service: PaykitService, requests: PaymentRequests, view: RequestView, key: string, proof: ProofView): Promise<Verdict> {
  const chain = requests.getChain();
  const terms = view.terms;
  if (!chain) return { status: 'pending', reason: 'Waiting for the wallet.' };
  if (!terms?.endpoint || !terms.asset || terms.amount === undefined) return { status: 'rejected', reason: "This wallet can't check this kind of payment." };
  if (proof.endpointIdentifier !== terms.endpoint.identifier || proof.paymentAppId !== PAYKIT_APP_ID) {
    return { status: 'rejected', reason: 'It names a different way to pay than the request.' };
  }
  if (terms.recurrence) {
    if (!proof.period || !isScheduledPeriod(terms.recurrence, proof.period)) return { status: 'rejected', reason: 'It is for a period that is not on the schedule.' };
    if ((parseTime(proof.period.startsAt) ?? Infinity) > Date.now()) return { status: 'pending', reason: "That period hasn't started yet." };
  }
  const parsed = parseProof(proof.proofJson);
  if (!parsed) return { status: 'rejected', reason: "The proof isn't in a form this wallet reads." };
  const context = { amount: terms.amount, address: terms.endpoint.address, transferClaimedBy: requests.book.claimedBy(transferKey(parsed)), paymentKey: key };

  if (parsed.kind === 'btc') {
    if (terms.asset !== 'btc') return { status: 'rejected', reason: 'The proof is for another asset.' };
    const accountIndex = service.addressCache.contactAccountIndex(view.counterparty);
    if (accountIndex === undefined || service.addressCache.btcAddress(accountIndex) !== terms.endpoint.address) {
      return { status: 'pending', reason: 'Waiting for the wallet to load your address for them.' };
    }
    return verifyBtcProof(await chain.btcReceived(accountIndex, parsed.txid, terms.endpoint.address), context);
  }

  if (terms.asset !== 'usdt') return { status: 'rejected', reason: 'The proof is for another asset.' };
  const ours = service.addressCache.getPublicAddresses().evm;
  if (!ours || ours.toLowerCase() !== terms.endpoint.address.toLowerCase()) return { status: 'rejected', reason: 'The request names an address that is not ours.' };
  return verifyErc20Proof(await chain.evmTransaction(parsed.transactionHash), {
    ...context,
    proof: parsed,
    token: SEPOLIA_USDT,
    chainId: SEPOLIA_CHAIN_ID,
    // Rebuilt from what we know (the link and the request), never from the proof.
    binding: {
      payer: bareKey(view.counterparty),
      payee: bareKey(service.publicKey),
      paymentAppId: proof.paymentAppId,
      paymentRequestId: view.requestId,
      paymentReference: terms.reference,
      paymentEndpointIdentifier: proof.endpointIdentifier,
      periodStartsAt: proof.period?.startsAt ?? '',
      periodEndsAt: proof.period?.endsAt ?? '',
      conversionQuoteId: proof.conversionQuoteId ?? '',
    },
  });
}

/**
 * Issue the receipt for a verified payment. The receipt id is chosen first
 * and saved, so a retry after a crash issues the same receipt
 * (issueReceipt is retry-safe with a caller-provided id: it prepares the
 * issuance, stores the encrypted receipt and queues Receipt Access).
 */
async function issueReceiptFor(service: PaykitService, requests: PaymentRequests, view: RequestView, key: string, proof: ProofView): Promise<void> {
  const book = requests.book;
  const terms = view.terms;
  const check = book.check(key);
  if (!terms?.asset || terms.amount === undefined || !check || check.receipt === 'sent') return;
  let receiptId = check.receiptId;
  if (!receiptId) {
    receiptId = newReceiptId();
    book.updateCheck(key, { receiptId, receipt: 'preparing' });
  }
  const id = receiptId;
  try {
    const issued = await service.call(
      'issueReceipt',
      (sdk, signal) =>
        sdk.issueReceipt(
          view.counterparty,
          {
            receiptId: id,
            paymentReference: new FfiPaymentReference(terms.reference),
            paymentRequestId: view.requestId,
            billingPeriod: terms.recurrence ? proof.period : undefined,
            paymentEndpointIdentifier: terms.endpoint?.identifier,
            amount: { value: toPaykitDecimal(terms.amount ?? 0n, terms.asset ?? 'btc'), asset: terms.asset ?? 'btc' },
            metadata: new FfiPrivateJsonObject(JSON.stringify(check.txHash ? { transaction: check.txHash } : {})),
          },
          { signal },
        ),
      'background',
    );
    book.updateCheck(key, { receipt: issued.status === FfiReceiptIssuanceStatus.AccessQueued ? 'sent' : 'preparing' });
    service.log.info(`receipt for ${view.requestId.slice(0, 8)}${proof.period ? ` (${periodKey(proof.period)})` : ''} sent to ${shortKey(view.counterparty)}`);
    service.syncLoop.flush();
  } catch (error) {
    book.updateCheck(key, { receipt: 'failed' });
    throw error;
  }
}

// Payer: receipts ---------------------------------------------------------------------

const retryAfter = new Map<string, number>();

async function retrieveReceipts(service: PaykitService): Promise<void> {
  const accesses = await service.call('receiptAccess', (sdk, signal) => sdk.receiptAccess({ signal }), 'background');
  const now = Date.now();
  let retrieved = false;
  for (const access of accesses) {
    if (access.retrievalStatus === FfiReceiptRetrievalStatus.Retrieved) continue;
    if ((retryAfter.get(access.receiptId) ?? 0) > now) continue;
    try {
      await service.call('retrieveReceipt', (sdk, signal) => sdk.retrieveReceipt(access.counterparty, access.receiptId, { signal }), 'background');
      service.log.info(`receipt from ${shortKey(access.counterparty)}${access.paymentRequestId ? ` for ${access.paymentRequestId.slice(0, 8)}` : ''}`);
      retrieved = true;
    } catch (error) {
      retryAfter.set(access.receiptId, now + FAILURE_BACKOFF_MS);
      service.log.warn(`retrieve receipt from ${shortKey(access.counterparty)}: ${describeError(error)}`);
    }
  }
  if (retrieved) await service.refreshState('background');
}
