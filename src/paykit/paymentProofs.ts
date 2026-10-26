// Payment proofs: what the payer sends after paying a request, and the
// rules the payee checks it against on chain.
//
// Paykit carries a proof as an opaque JSON object inside `paykit.payment_proof`
// and leaves its meaning to the wallets (specs/payment-requests.md: "Paykit
// validates the message shape ... Payment-method-specific code validates
// whether the proof actually proves payment"). This app uses two:
//
//   Bitcoin  {"type":"bitcoin-onchain-tx","network":"mutinynet","txid":"…"}
//            The money must land on the address bound in the request,
//            which is the payer's own contact account on our side: an
//            address only they were given. So the txid is enough.
//   USD₮     {"type":"erc20-transfer-eip712","chain_id":"11155111",
//             "transaction_hash":"0x…","receipt_log_index":"0","signature":"0x…"}
//            Our USD₮ address is public, so the payer also signs which
//            Transfer was theirs (src/wallet/erc20PaymentProof.ts).
//
// The payee's checks, in verifyBtcProof / verifyErc20Proof:
//   - the transaction exists, succeeded and is in a block (one confirmation:
//     Mutinynet blocks come every 30 s, Sepolia every 12 s);
//   - it paid the exact address in the request, at least the amount;
//   - USD₮: the selected log is a Transfer of the USD₮ contract, and the
//     signature over the request binding recovers to the Transfer's sender;
//   - the same transfer has not already paid another request or period
//     (the caller passes what is already claimed).
// A missing, unconfirmed or "dropped" transaction is "pending", never
// "rejected": a proof often arrives before its block, and a lagging RPC
// node can make a mined transaction look dropped.
//
// Pure: no native imports, unit tested.
import { SEPOLIA_CHAIN_ID } from '../config/chains';
import { ERC20_PROOF_TYPE, erc20PaymentSigner, erc20PaymentTypedData, isCanonicalLogIndex, type Erc20RequestBinding } from '../wallet/erc20PaymentProof';
import { erc20TransferFromLog, type BtcReceipt, type EvmTransaction } from '../wallet/paymentEvidence';

export const BTC_PROOF_TYPE = 'bitcoin-onchain-tx';
export const BTC_PROOF_NETWORK = 'mutinynet';

export type ParsedProof =
  | { kind: 'btc'; txid: string }
  | { kind: 'erc20'; chainId: string; transactionHash: string; receiptLogIndex: string; signature: string };

export function btcProofJson(txid: string): string {
  return JSON.stringify({ type: BTC_PROOF_TYPE, network: BTC_PROOF_NETWORK, txid: txid.toLowerCase() });
}

export function erc20ProofJson(proof: { transactionHash: string; receiptLogIndex: string; signature: string }): string {
  return JSON.stringify({
    type: ERC20_PROOF_TYPE,
    chain_id: String(SEPOLIA_CHAIN_ID),
    transaction_hash: proof.transactionHash.toLowerCase(),
    receipt_log_index: proof.receiptLogIndex,
    signature: proof.signature.toLowerCase(),
  });
}

/** Parse a proof object someone sent. Undefined for anything that is not exactly one of ours. */
export function parseProof(json: string): ParsedProof | undefined {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const proof = value as Record<string, unknown>;
  if (proof.type === BTC_PROOF_TYPE) {
    const txid = proof.txid;
    if (proof.network !== BTC_PROOF_NETWORK || typeof txid !== 'string' || !/^[0-9a-f]{64}$/.test(txid)) return undefined;
    return { kind: 'btc', txid };
  }
  if (proof.type === ERC20_PROOF_TYPE) {
    const { chain_id: chainId, transaction_hash: transactionHash, receipt_log_index: receiptLogIndex, signature } = proof;
    if (typeof chainId !== 'string' || !/^[1-9]\d*$/.test(chainId)) return undefined;
    if (typeof transactionHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(transactionHash)) return undefined;
    if (typeof receiptLogIndex !== 'string' || !isCanonicalLogIndex(receiptLogIndex)) return undefined;
    if (typeof signature !== 'string' || !/^0x[0-9a-f]{130}$/.test(signature)) return undefined;
    return { kind: 'erc20', chainId, transactionHash, receiptLogIndex, signature };
  }
  return undefined;
}

/** The transaction hash a proof names (for activity links), or undefined. */
export function proofTransactionHash(json: string): string | undefined {
  const proof = parseProof(json);
  return proof?.kind === 'btc' ? proof.txid : proof?.transactionHash;
}

/**
 * One transfer pays at most one request or billing period. Its identity is
 * the chain plus transaction (plus the receipt log for ERC-20, which can
 * batch several transfers in one transaction).
 */
export function transferKey(proof: ParsedProof): string {
  return proof.kind === 'btc' ? `bitcoin:${proof.txid}` : `ethereum:${proof.chainId}:${proof.transactionHash}:${proof.receiptLogIndex}`;
}

export type Verdict =
  | { status: 'verified' }
  /** `recheckMs`: look again after this long instead of the usual interval. */
  | { status: 'pending'; reason: string; recheckMs?: number }
  | { status: 'rejected'; reason: string };

/**
 * WDK's "dropped" (no receipt, and the sender's nonce moved on) is also what
 * a mined transaction looks like on an RPC node that lags on receipts. So it
 * is never a reason to reject: look again, less often.
 */
export const DROPPED_PROOF_RECHECK_MS = 60_000;

export type ProofContext = {
  /** The request's amount in base units. */
  amount: bigint;
  /** The address bound in the request (ours). */
  address: string;
  /** Who else already used this transfer: the request/period key, if any. */
  transferClaimedBy?: string;
  /** This request/period's key, so a repeated proof for the same payment is fine. */
  paymentKey: string;
};

function claimProblem(context: ProofContext): Verdict | undefined {
  if (context.transferClaimedBy && context.transferClaimedBy !== context.paymentKey) {
    return { status: 'rejected', reason: 'This transaction already paid another request.' };
  }
  return undefined;
}

export function verifyBtcProof(receipt: BtcReceipt, context: ProofContext): Verdict {
  const claimed = claimProblem(context);
  if (claimed) return claimed;
  if (!receipt.found) return { status: 'pending', reason: 'Not seen on the network yet.' };
  if (receipt.received < context.amount) return { status: 'rejected', reason: 'It paid less than the request asked for.' };
  if (!receipt.confirmed) return { status: 'pending', reason: 'Waiting for the next block.' };
  return { status: 'verified' };
}

export type Erc20ProofContext = ProofContext & {
  proof: Extract<ParsedProof, { kind: 'erc20' }>;
  token: string;
  chainId: number;
  binding: Erc20RequestBinding;
};

export function verifyErc20Proof(transaction: EvmTransaction, context: Erc20ProofContext): Verdict {
  const claimed = claimProblem(context);
  if (claimed) return claimed;
  if (context.proof.chainId !== String(context.chainId)) return { status: 'rejected', reason: 'The proof names another network.' };
  switch (transaction.state) {
    case 'unknown':
    case 'pending':
      return { status: 'pending', reason: 'Waiting for the next block.' };
    case 'dropped':
      return { status: 'pending', reason: "The transaction hasn't confirmed yet.", recheckMs: DROPPED_PROOF_RECHECK_MS };
    case 'failed':
      return { status: 'rejected', reason: 'The transaction failed on chain.' };
    case 'succeeded':
      break;
  }
  const transfer = erc20TransferFromLog(transaction.logs[Number(context.proof.receiptLogIndex)]);
  if (!transfer) return { status: 'rejected', reason: 'The proof does not point at a token transfer.' };
  if (transfer.token !== context.token.toLowerCase()) return { status: 'rejected', reason: 'It moved a different token.' };
  if (transfer.to !== context.address.toLowerCase()) return { status: 'rejected', reason: 'It paid a different address.' };
  if (transfer.amount < context.amount) return { status: 'rejected', reason: 'It paid less than the request asked for.' };
  const typed = erc20PaymentTypedData(context.chainId, {
    transactionHash: context.proof.transactionHash,
    receiptLogIndex: context.proof.receiptLogIndex,
    request: context.binding,
  });
  const signer = erc20PaymentSigner(typed, context.proof.signature);
  if (!signer || signer !== transfer.from) return { status: 'rejected', reason: 'The signature is not from the account that paid.' };
  return { status: 'verified' };
}
