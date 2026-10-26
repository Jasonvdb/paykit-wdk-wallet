// On-chain activity: one list model for both chains, plus the parsers that
// fill it.
//
// Where history comes from:
// - BTC: WDK's BTC account has `getTransfers`, which reads Electrum. One call
//   per account index (account 0 plus each contact's account).
// - EVM: WDK's EVM account has no history call. We read the keyless
//   Blockscout API for Sepolia (ETH transactions and USD₮ token transfers),
//   and keep a local record of transactions this app sent, so a fresh send
//   shows up before Blockscout has indexed it. That is the simplest approach
//   that works without an API key; the WDK Indexer does not cover testnets.
//
// The parsers are pure so they can be unit tested; the hook that calls them
// is in ./useActivity.ts.
import { SEPOLIA_USDT } from '../config/chains';
import { sameEvmAddress } from './addressFormat';
import type { AssetId, Chain } from './assets';

export type ActivityStatus = 'pending' | 'confirmed' | 'failed';

export type ActivityItem = {
  /** Stable id: chain, hash and a per-transaction discriminator. */
  id: string;
  chain: Chain;
  asset: AssetId;
  direction: 'in' | 'out';
  /** Base units of `asset`. */
  amount: bigint;
  /** Network fee in the chain's native asset, when known (outgoing only). */
  fee?: bigint;
  hash: string;
  /** The other side's address, when known. */
  counterpartyAddress?: string;
  /** Milliseconds since epoch, when known. BTC transfers only carry a block height. */
  timestamp?: number;
  /** BTC block height (0 while unconfirmed). Used to order BTC items. */
  blockHeight?: number;
  status: ActivityStatus;
  /** WDK account index that sent or received it. */
  accountIndex: number;
};

/** The shape WDK's BTC `getTransfers` returns, after HRPC turned bigints into strings. */
export type WdkBtcTransfer = {
  txid: string;
  address: string;
  vout: number;
  height: number;
  value: string | number;
  direction: 'incoming' | 'outgoing';
  fee?: string | number;
  recipient?: string;
};

export function parseBtcTransfers(transfers: unknown, accountIndex: number): ActivityItem[] {
  if (!Array.isArray(transfers)) return [];
  const items: ActivityItem[] = [];
  for (const raw of transfers as WdkBtcTransfer[]) {
    if (!raw || typeof raw.txid !== 'string') continue;
    const direction = raw.direction === 'outgoing' ? 'out' : 'in';
    items.push({
      id: `bitcoin:${raw.txid}:${direction}:${raw.vout}:${accountIndex}`,
      chain: 'bitcoin',
      asset: 'btc',
      direction,
      amount: BigInt(raw.value ?? 0),
      fee: raw.fee !== undefined && raw.fee !== null ? BigInt(raw.fee) : undefined,
      hash: raw.txid,
      counterpartyAddress: direction === 'out' ? raw.recipient : undefined,
      blockHeight: raw.height,
      status: raw.height > 0 ? 'confirmed' : 'pending',
      accountIndex,
    });
  }
  return items;
}

type BlockscoutAddress = { hash?: string } | null | undefined;

type BlockscoutTransaction = {
  hash: string;
  from?: BlockscoutAddress;
  to?: BlockscoutAddress;
  value?: string;
  fee?: { value?: string } | null;
  status?: string | null;
  result?: string;
  timestamp?: string | null;
};

type BlockscoutTokenTransfer = {
  transaction_hash: string;
  log_index?: number | string;
  from?: BlockscoutAddress;
  to?: BlockscoutAddress;
  total?: { value?: string } | null;
  timestamp?: string | null;
  token?: { address_hash?: string; address?: string } | null;
};

function toTimestamp(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? undefined : ms;
}

function statusOf(tx: { status?: string | null; result?: string; timestamp?: string | null }): ActivityStatus {
  if (tx.status === 'error' || (tx.result && tx.result !== 'success' && tx.result !== 'pending')) return 'failed';
  if (tx.status === 'ok' || tx.result === 'success') return 'confirmed';
  return 'pending';
}

/** Native ETH movements from Blockscout `/addresses/{a}/transactions`. Zero-value calls are skipped. */
export function parseBlockscoutTransactions(json: unknown, owner: string): ActivityItem[] {
  const list = (json as { items?: BlockscoutTransaction[] } | null)?.items;
  if (!Array.isArray(list)) return [];
  const items: ActivityItem[] = [];
  for (const tx of list) {
    const value = BigInt(tx.value ?? '0');
    if (value === 0n) continue;
    const from = tx.from?.hash ?? '';
    const outgoing = sameEvmAddress(from, owner);
    items.push({
      id: `ethereum:${tx.hash}:eth`,
      chain: 'ethereum',
      asset: 'eth',
      direction: outgoing ? 'out' : 'in',
      amount: value,
      fee: outgoing && tx.fee?.value ? BigInt(tx.fee.value) : undefined,
      hash: tx.hash,
      counterpartyAddress: outgoing ? tx.to?.hash : from,
      timestamp: toTimestamp(tx.timestamp),
      status: statusOf(tx),
      accountIndex: 0,
    });
  }
  return items;
}

/** USD₮ movements from Blockscout `/addresses/{a}/token-transfers`. Other tokens are skipped. */
export function parseBlockscoutTokenTransfers(json: unknown, owner: string): ActivityItem[] {
  const list = (json as { items?: BlockscoutTokenTransfer[] } | null)?.items;
  if (!Array.isArray(list)) return [];
  const items: ActivityItem[] = [];
  for (const transfer of list) {
    const token = transfer.token?.address_hash ?? transfer.token?.address ?? '';
    if (!sameEvmAddress(token, SEPOLIA_USDT)) continue;
    const from = transfer.from?.hash ?? '';
    const outgoing = sameEvmAddress(from, owner);
    items.push({
      id: `ethereum:${transfer.transaction_hash}:usdt:${transfer.log_index ?? 0}`,
      chain: 'ethereum',
      asset: 'usdt',
      direction: outgoing ? 'out' : 'in',
      amount: BigInt(transfer.total?.value ?? '0'),
      hash: transfer.transaction_hash,
      counterpartyAddress: outgoing ? transfer.to?.hash : from,
      timestamp: toTimestamp(transfer.timestamp),
      // Blockscout only lists token transfers from mined transactions.
      status: 'confirmed',
      accountIndex: 0,
    });
  }
  return items;
}

/**
 * Merge activity sources. Indexer items win over locally recorded sends with
 * the same hash and asset. Newest first: pending items, then by time or height.
 */
export function mergeActivity(sources: ActivityItem[][], localSends: ActivityItem[]): ActivityItem[] {
  const byId = new Map<string, ActivityItem>();
  for (const item of sources.flat()) byId.set(item.id, item);
  const indexed = new Set([...byId.values()].map((item) => `${item.hash}:${item.asset}`));
  for (const item of localSends) {
    if (!indexed.has(`${item.hash}:${item.asset}`)) byId.set(item.id, item);
  }
  return [...byId.values()].sort(compareNewestFirst);
}

/**
 * How many BTC transfers to ask WDK for. getTransfers returns the oldest
 * first and stops at the limit, so the app asks for the whole (short,
 * testnet) history and keeps the newest with newestItems().
 */
export const BTC_HISTORY_FETCH_LIMIT = 1_000;

/** The newest `count` items, newest first (same order as mergeActivity). */
export function newestItems(items: ActivityItem[], count: number): ActivityItem[] {
  return [...items].sort(compareNewestFirst).slice(0, count);
}

function compareNewestFirst(a: ActivityItem, b: ActivityItem): number {
  if (a.status === 'pending' && b.status !== 'pending') return -1;
  if (b.status === 'pending' && a.status !== 'pending') return 1;
  if (a.timestamp !== undefined && b.timestamp !== undefined) return b.timestamp - a.timestamp;
  if (a.blockHeight !== undefined && b.blockHeight !== undefined) return b.blockHeight - a.blockHeight;
  // Mixed chains without a common clock: keep EVM (timestamped) items first.
  if (a.timestamp !== undefined) return -1;
  if (b.timestamp !== undefined) return 1;
  return 0;
}
