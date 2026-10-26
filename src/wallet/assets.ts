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
    decimals: 8,
    chain: 'bitcoin',
    baseUnit: 'sats',
  },
  usdt: {
    id: 'usdt',
    symbol: 'USD₮',
    name: 'Tether USD',
    decimals: 6,
    chain: 'ethereum',
    baseUnit: 'micro USD₮',
  },
  eth: {
    id: 'eth',
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    chain: 'ethereum',
    baseUnit: 'wei',
  },
};

/** The asset that pays the network fee for a transfer of `asset`. */
export function feeAssetFor(asset: AssetId): AssetId {
  return ASSETS[asset].chain === 'bitcoin' ? 'btc' : 'eth';
}
