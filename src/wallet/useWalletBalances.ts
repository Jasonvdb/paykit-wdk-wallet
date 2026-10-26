// Balances for the spending account (index 0), polled every ~15 s while
// the app is in the foreground.
//
// WDK's hooks wrap TanStack Query: the worklet reads BTC from Mutinynet's
// Electrum server and ETH/USD₮ from a Sepolia RPC. Balances arrive as
// base-unit strings and are converted to bigint here, so screens never
// touch floating point. Electrum counts unconfirmed incoming BTC, so a
// payment from the other simulator shows up within seconds.
import { useCallback, useMemo } from 'react';
import { useBalancesForWallets, useBalancesForWallet } from '@tetherto/wdk-react-native-core';

import { BALANCE_POLL_MS } from '../config/sync';
import { BTC, ETH, USDT } from '../config/wdk';
import { parseBaseUnits } from './amounts';
import { useAppActive } from './useAppActive';
import { ASSETS, type AssetId } from './assets';

const SPENDING_ASSETS = [BTC, USDT, ETH];
const BTC_ONLY = [BTC];

const WDK_ASSET_IDS: Record<AssetId, string> = {
  btc: BTC.getId(),
  usdt: USDT.getId(),
  eth: ETH.getId(),
};

export type WalletBalances = {
  /** Base units per asset; undefined until the first successful fetch. */
  balances: Partial<Record<AssetId, bigint>>;
  /** True only before the first result. */
  isLoading: boolean;
  /** True while any fetch runs (initial, poll or manual refresh). */
  isRefreshing: boolean;
  /** A safe-to-show description of the last failure, if any asset failed. */
  error?: string;
  /** When the current values were fetched (ms). */
  updatedAt?: number;
  refresh: () => Promise<void>;
};

export function useWalletBalances(options: { pollMs?: number } = {}): WalletBalances {
  const active = useAppActive();
  const query = useBalancesForWallet(0, SPENDING_ASSETS, {
    refetchInterval: active ? (options.pollMs ?? BALANCE_POLL_MS) : false,
  });

  const balances = useMemo(() => {
    const result: Partial<Record<AssetId, bigint>> = {};
    for (const asset of Object.keys(WDK_ASSET_IDS) as AssetId[]) {
      const entry = query.data?.find((item) => item.assetId === WDK_ASSET_IDS[asset]);
      const value = entry?.success ? parseBaseUnits(entry.balance) : undefined;
      if (value !== undefined) result[asset] = value;
    }
    return result;
  }, [query.data]);

  // WDK's own error text is for developers; screens get a sentence that
  // says what failed and what to do (docs/DESIGN.md "Writing").
  const failedAssets = (Object.keys(WDK_ASSET_IDS) as AssetId[]).filter((asset) =>
    query.data?.some((item) => item.assetId === WDK_ASSET_IDS[asset] && !item.success),
  );
  const what = query.error ? 'your balances' : `your ${failedAssets.map((asset) => ASSETS[asset].displayName).join(' and ')} balance`;
  const error = query.error || failedAssets.length > 0 ? `Couldn't load ${what}. Pull down to try again.` : undefined;
  const refetch = query.refetch;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    balances,
    isLoading: query.isLoading,
    isRefreshing: query.isFetching,
    error,
    updatedAt: query.dataUpdatedAt || undefined,
    refresh,
  };
}

export type ContactBtcBalance = { accountIndex: number; sats?: bigint };

/**
 * BTC sitting in contacts' accounts: money received privately, not yet
 * collected to account 0. The Wallet tab shows it as "from contacts".
 */
export function useContactBtcBalances(accountIndices: number[], options: { pollMs?: number } = {}) {
  const active = useAppActive();
  const query = useBalancesForWallets(accountIndices, BTC_ONLY, {
    refetchInterval: active ? (options.pollMs ?? BALANCE_POLL_MS) : false,
    enabled: accountIndices.length > 0,
  });
  const balances: ContactBtcBalance[] = useMemo(
    () =>
      accountIndices.map((accountIndex) => {
        const entry = query.data?.find((item) => item.accountIndex === accountIndex);
        return { accountIndex, sats: entry?.success ? parseBaseUnits(entry.balance) : undefined };
      }),
    [accountIndices, query.data],
  );
  const total = balances.reduce((sum, b) => sum + (b.sats ?? 0n), 0n);
  return { balances, total, isRefreshing: query.isFetching, refresh: query.refetch };
}
