// The two things WDK's BTC module does not tell us, read from Mutinynet's
// esplora API (src/config/chains.ts MUTINYNET_API):
//
// - the current fee rate in sats per virtual byte, so the Send review can
//   say "1 sat/vB" and pass the same rate to WDK for the quote and the send
//   (WDK otherwise estimates its own rate and does not report it);
// - when a transaction was confirmed, because WDK's transfer list carries
//   only a block height.
//
// Parsers are pure and unit tested; the fetchers are thin.
import { MUTINYNET_API } from '../config/chains';

/** Mutinynet's minimum relay rate. Also the fallback when the API is unsure. */
export const MIN_BTC_FEE_RATE = 1n;

/** `/v1/fees/recommended` -> sats/vB for the next block, at least 1. */
export function parseRecommendedFeeRate(json: unknown): bigint | undefined {
  const fastest = (json as { fastestFee?: unknown } | null)?.fastestFee;
  if (typeof fastest !== 'number' || !Number.isFinite(fastest) || fastest <= 0) return undefined;
  const rate = BigInt(Math.ceil(fastest));
  return rate < MIN_BTC_FEE_RATE ? MIN_BTC_FEE_RATE : rate;
}

export async function fetchBtcFeeRate(): Promise<bigint | undefined> {
  const response = await fetch(`${MUTINYNET_API}/v1/fees/recommended`, { headers: { accept: 'application/json' } });
  if (!response.ok) return undefined;
  return parseRecommendedFeeRate(await response.json());
}

export type BtcTransactionStatus = { confirmed: boolean; blockHeight?: number; blockTime?: number };

/** `/tx/<txid>/status` -> confirmation and block time (ms). */
export function parseTransactionStatus(json: unknown): BtcTransactionStatus | undefined {
  const status = json as { confirmed?: unknown; block_height?: unknown; block_time?: unknown } | null;
  if (!status || typeof status.confirmed !== 'boolean') return undefined;
  return {
    confirmed: status.confirmed,
    blockHeight: typeof status.block_height === 'number' ? status.block_height : undefined,
    blockTime: typeof status.block_time === 'number' ? status.block_time * 1000 : undefined,
  };
}

export async function fetchBtcTransactionStatus(txid: string): Promise<BtcTransactionStatus | undefined> {
  if (!/^[0-9a-f]{64}$/i.test(txid)) return undefined;
  const response = await fetch(`${MUTINYNET_API}/tx/${txid}/status`, { headers: { accept: 'application/json' } });
  if (!response.ok) return undefined;
  return parseTransactionStatus(await response.json());
}
