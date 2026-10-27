// Reading payments back from the chain, through WDK, for payment proofs.
//
// A payee that receives a Paykit payment proof does not trust it: it looks
// the transaction up itself. These pure parsers turn what WDK returns over
// its RPC bridge (JSON, bigints as strings) into small facts the
// verification rules in src/paykit/paymentProofs.ts can check:
//
//   Bitcoin   WDK's `getTransfers` on the account that received the money
//             (each contact pays us at their own Bitcoin account). Rows for
//             one txid are the outputs that paid that account's address.
//   Ethereum  WDK's `getTransaction(hash)`: finality, success and the
//             receipt, whose `logs` hold the ERC-20 Transfer events.
//
// The payer uses the same parsers to know when its own payment settled
// and, for USD₮, which receipt log is its Transfer (the proof names it).
// No native imports; unit tested.
import type { ActivityItem } from './activity';
import { ERC20_TRANSFER_TOPIC } from './erc20PaymentProof';

/** What one Bitcoin account received in one transaction. */
export type BtcReceipt = {
  /** False while the transaction is not in the account's history (not broadcast yet, or wrong account). */
  found: boolean;
  /** Sum of the outputs that paid this account, in sats. */
  received: bigint;
  /** In a block (height > 0). */
  confirmed: boolean;
  /**
   * The block's time (ms), once confirmed and read. WDK's transfers carry
   * only a height, so the bridge reads it from Mutinynet's esplora.
   */
  blockTimeMs?: number;
};

type TransferRow = { txid?: unknown; direction?: unknown; value?: unknown; height?: unknown; address?: unknown };

/** From WDK BTC `getTransfers` rows: what `txid` paid the account whose address is `address`. */
export function btcReceiptFromTransfers(transfers: unknown, txid: string, address: string): BtcReceipt {
  const rows = Array.isArray(transfers) ? (transfers as TransferRow[]) : [];
  const wanted = txid.toLowerCase();
  const matching = rows.filter(
    (row) =>
      typeof row?.txid === 'string' &&
      row.txid.toLowerCase() === wanted &&
      row.direction === 'incoming' &&
      (row.address === undefined || row.address === address),
  );
  if (matching.length === 0) return { found: false, received: 0n, confirmed: false };
  let received = 0n;
  for (const row of matching) {
    const value = typeof row.value === 'string' || typeof row.value === 'number' ? String(row.value) : '';
    if (/^\d+$/.test(value)) received += BigInt(value);
  }
  return { found: true, received, confirmed: matching.every((row) => typeof row.height === 'number' && row.height > 0) };
}

/** The outgoing side, for the payer's own transaction: from WDK BTC `getTransaction` on the paying account. */
export type BtcSendStatus = { found: boolean; confirmed: boolean };

export function btcSendStatus(result: unknown): BtcSendStatus {
  const tx = result as { finality?: unknown; confirmations?: unknown } | null;
  if (!tx || typeof tx !== 'object') return { found: false, confirmed: false };
  return { found: true, confirmed: tx.finality === 'confirmed' || tx.finality === 'final' };
}

/** One log from a transaction receipt, by its position in the receipt's `logs` array. */
export type EvmLog = { address: string; topics: string[]; data: string };

export type EvmTransaction =
  | { state: 'unknown' }
  | { state: 'pending' }
  | { state: 'dropped' }
  | { state: 'failed'; confirmations: number }
  | { state: 'succeeded'; confirmations: number; logs: EvmLog[] };

/**
 * From WDK EVM `getTransaction(hash)` (finality, success, confirmations and
 * the ethers receipt as JSON). `unknown` covers "not found": a missing
 * receipt is never proof that a payment failed.
 */
export function evmTransactionFrom(result: unknown): EvmTransaction {
  const tx = result as { finality?: unknown; success?: unknown; confirmations?: unknown; receipt?: { logs?: unknown; status?: unknown } | null } | null;
  if (!tx || typeof tx !== 'object') return { state: 'unknown' };
  if (tx.finality === 'dropped') return { state: 'dropped' };
  if (tx.finality === 'pending' || !tx.receipt) return { state: 'pending' };
  const confirmations = typeof tx.confirmations === 'number' ? tx.confirmations : 1;
  const success = tx.success === true || tx.receipt.status === 1 || tx.receipt.status === '1';
  if (!success) return { state: 'failed', confirmations };
  const logs = Array.isArray(tx.receipt.logs) ? tx.receipt.logs : [];
  return {
    state: 'succeeded',
    confirmations,
    logs: logs.map((log: { address?: unknown; topics?: unknown; data?: unknown }) => ({
      address: typeof log?.address === 'string' ? log.address : '',
      topics: Array.isArray(log?.topics) ? log.topics.filter((t: unknown): t is string => typeof t === 'string') : [],
      data: typeof log?.data === 'string' ? log.data : '',
    })),
  };
}

/**
 * The end state of one of our own Ethereum sends, or undefined while it has
 * none yet. 'dropped' means WDK saw another transaction take its nonce (a
 * replacement), so it can never be mined: that is a failed send too, not
 * one to keep showing as Pending. 'unknown' (not found yet) and 'pending'
 * stay pending and are asked about again.
 */
export function sendOutcomeOf(tx: EvmTransaction): 'confirmed' | 'failed' | undefined {
  if (tx.state === 'succeeded') return 'confirmed';
  if (tx.state === 'failed' || tx.state === 'dropped') return 'failed';
  return undefined;
}

/** An ERC-20 Transfer event read from one log. Addresses lowercase. */
export type Erc20Transfer = { token: string; from: string; to: string; amount: bigint };

const TOPIC_ADDRESS = /^0x0{24}([0-9a-fA-F]{40})$/;

/** The Transfer event in `log`, or undefined if the log is anything else. */
export function erc20TransferFromLog(log: EvmLog | undefined): Erc20Transfer | undefined {
  if (!log || log.topics.length !== 3 || log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC) return undefined;
  const from = TOPIC_ADDRESS.exec(log.topics[1] ?? '')?.[1];
  const to = TOPIC_ADDRESS.exec(log.topics[2] ?? '')?.[1];
  if (!from || !to || !/^0x[0-9a-fA-F]{1,64}$/.test(log.data)) return undefined;
  return { token: log.address.toLowerCase(), from: `0x${from.toLowerCase()}`, to: `0x${to.toLowerCase()}`, amount: BigInt(log.data) };
}

/**
 * The payer's side: the receipt-relative index of the Transfer that sent
 * `amount` of `token` from `from` to `to`, for the proof's
 * `receipt_log_index`. Undefined if the receipt has no such log.
 */
export function findErc20TransferLog(logs: EvmLog[], expected: { token: string; from: string; to: string; amount: bigint }): number | undefined {
  const index = logs.findIndex((log) => {
    const transfer = erc20TransferFromLog(log);
    return (
      !!transfer &&
      transfer.token === expected.token.toLowerCase() &&
      transfer.from === expected.from.toLowerCase() &&
      transfer.to === expected.to.toLowerCase() &&
      transfer.amount === expected.amount
    );
  });
  return index >= 0 ? index : undefined;
}

/**
 * A payment the app lost track of: it started a send (the request book
 * says 'sending' or 'unknown') but never learned the transaction hash,
 * because the app stopped or the send's outcome was unclear. The payer
 * looks for it in its own history: a transfer of exactly `amount` of
 * `asset` to `to`, not before `notBeforeMs`, that no other payment claims.
 */
export type SentTransferQuery = {
  asset: 'btc' | 'usdt';
  to: string;
  amount: bigint;
  notBeforeMs: number;
  /** Hashes other payments already use (lowercase). */
  exclude: ReadonlySet<string>;
};

/**
 * found  a matching transfer: unconfirmed, or confirmed at or after notBeforeMs
 * none   nothing matches
 * unsure a confirmed match whose time is unknown: look again later
 */
export type SentTransferMatch = { state: 'found'; hash: string } | { state: 'none' } | { state: 'unsure' };

/** Our sent transfers that could be the payment, whatever their time. */
export function sentTransferCandidates(items: ActivityItem[], query: Omit<SentTransferQuery, 'notBeforeMs'>): ActivityItem[] {
  const to = query.to.toLowerCase();
  return items.filter(
    (item) =>
      item.asset === query.asset &&
      item.direction === 'out' &&
      item.status !== 'failed' &&
      item.counterpartyAddress?.toLowerCase() === to &&
      item.amount === query.amount &&
      !query.exclude.has(item.hash.toLowerCase()),
  );
}

export function matchSentTransfer(items: ActivityItem[], query: SentTransferQuery): SentTransferMatch {
  const candidates = sentTransferCandidates(items, query);
  const recent = candidates.find((item) => item.status === 'pending' || (item.timestamp !== undefined && item.timestamp >= query.notBeforeMs));
  if (recent) return { state: 'found', hash: recent.hash };
  if (candidates.some((item) => item.status !== 'pending' && item.timestamp === undefined)) return { state: 'unsure' };
  return { state: 'none' };
}
