// The three assets the wallet shows, described in plain data.
//
// WDK moves BTC on Mutinynet and ETH + USD₮ on Sepolia. ETH is only shown as
// gas for USD₮ transfers. Amounts are always bigint in the asset's smallest
// unit (sats, USD₮ micro-units, wei); see ./amounts.ts for display.

export type AssetId = 'btc' | 'usdt' | 'eth';

export type Chain = 'bitcoin' | 'ethereum';

export type AssetInfo = {
  id: AssetId;
  /** What the user reads next to an amount. */
  symbol: string;
  name: string;
  /**
   * What screens call the asset in words: "Bitcoin", "USD₮" (docs/DESIGN.md).
   * The one place for it, so no screen says "Tether" while another says "USD₮".
   */
  displayName: string;
  decimals: number;
  chain: Chain;
  /** Name of the smallest unit, for developer-facing text. */
  baseUnit: string;
};

export const ASSETS: Record<AssetId, AssetInfo> = {
  btc: {
    id: 'btc',
    symbol: 'BTC',
    name: 'Bitcoin',
    displayName: 'Bitcoin',
    decimals: 8,
    chain: 'bitcoin',
    baseUnit: 'sats',
  },
  usdt: {
    id: 'usdt',
    symbol: 'USD₮',
    name: 'Tether USD',
    displayName: 'USD₮',
    decimals: 6,
    chain: 'ethereum',
    baseUnit: 'micro USD₮',
  },
  eth: {
    id: 'eth',
    symbol: 'ETH',
    name: 'Ether',
    displayName: 'ETH',
    decimals: 18,
    chain: 'ethereum',
    baseUnit: 'wei',
  },
};

/**
 * How long until a transaction is in a block, in words, per chain. One
 * constant, so the Send review, the sent screen and the faucet agree.
 * Mutinynet makes a block every 30 s; Sepolia every 12 s.
 */
export const CONFIRMATION_TIME: Record<Chain, string> = {
  bitcoin: 'about 30 seconds',
  ethereum: 'about 12 seconds',
};

/** The asset that pays the network fee for a transfer of `asset`. */
export function feeAssetFor(asset: AssetId): AssetId {
  return ASSETS[asset].chain === 'bitcoin' ? 'btc' : 'eth';
}
