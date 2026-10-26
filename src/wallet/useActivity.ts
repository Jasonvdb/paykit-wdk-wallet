// On-chain activity for the spending account, newest first.
//
// BTC history comes from WDK (`getTransfers` through the account's
// `extension()` proxy, which forwards any allowed method to the worklet).
// Careful: getTransfers returns the OLDEST transfers first (Electrum history
// order: confirmed by block height, then the mempool) and stops at `limit`.
// So `limit: 25` would drop the newest and pending ones on a busy account.
// This app asks for the whole (short, testnet) history and keeps the newest;
// a production wallet would page with `skip` or use an indexer.
// EVM history comes from Blockscout's keyless API, because WDK's EVM module
// has no history call. Transactions this app just sent are merged in from
// ./sentTransactions.ts until an indexer reports them. See ./activity.ts.
//
// Per-contact BTC accounts have their own history: contacts' private
// payments land there. ./useContactAccountActivity.ts collects it and it is
// merged in here, with each Collect shown once (collapseInternalMoves).
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAccount } from '@tetherto/wdk-react-native-core';

import { SEPOLIA_BLOCKSCOUT_API, SEPOLIA_USDT } from '../config/chains';
import { BALANCE_POLL_MS } from '../config/sync';
import { BTC_NETWORK, EVM_NETWORK } from '../config/wdk';
import {
  BTC_HISTORY_FETCH_LIMIT,
  collapseInternalMoves,
  mergeActivity,
  newestItems,
  parseBlockscoutTokenTransfers,
  parseBlockscoutTransactions,
  parseBtcTransfers,
  type ActivityItem,
} from './activity';
import { sentTransactions, subscribeSentTransactions } from './sentTransactions';
import { useAppActive } from './useAppActive';
import { useContactAccountActivity } from './useContactAccountActivity';

/** The subset of WDK's BTC account methods this file calls through `extension()`. */
type BtcAccountExtension = {
  getTransfers: (options: { limit?: number; skip?: number; direction?: 'incoming' | 'outgoing' | 'all' }) => Promise<unknown>;
};

/** How many BTC transfers to show. */
const HISTORY_LIMIT = 25;

/**
 * The last fetched lists, shared by every useActivity() caller. The Wallet
 * tab and Activity detail both use the hook; with this, a pushed detail
 * screen starts from the list the person just tapped instead of an empty
 * one while it refetches.
 */
const lastFetched: { owner?: string; btc: ActivityItem[]; evm: ActivityItem[] } = { btc: [], evm: [] };

/** The cached lists, if they belong to the wallet with this EVM address. */
function cachedFor(owner: string | null) {
  return owner && lastFetched.owner === owner ? lastFetched : { btc: [], evm: [] };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Blockscout answered ${response.status}`);
  return response.json();
}

/** ETH and USD₮ activity for an EVM address, from Blockscout. */
export async function fetchEvmActivity(address: string): Promise<ActivityItem[]> {
  const [transactions, tokenTransfers] = await Promise.all([
    fetchJson(`${SEPOLIA_BLOCKSCOUT_API}/addresses/${address}/transactions`),
    fetchJson(`${SEPOLIA_BLOCKSCOUT_API}/addresses/${address}/token-transfers?type=ERC-20&token=${SEPOLIA_USDT}`),
  ]);
  return [...parseBlockscoutTransactions(transactions, address), ...parseBlockscoutTokenTransfers(tokenTransfers, address)];
}

export type WalletActivity = {
  items: ActivityItem[];
  isLoading: boolean;
  /** Safe-to-show text if a source failed; items from other sources still show. */
  error?: string;
  refresh: () => Promise<void>;
};

export function useActivity(options: { pollMs?: number } = {}): WalletActivity {
  const btcAccount = useAccount<BtcAccountExtension>({ network: BTC_NETWORK, accountIndex: 0 });
  const evmAccount = useAccount({ network: EVM_NETWORK, accountIndex: 0 });
  const localSends = useSyncExternalStore(subscribeSentTransactions, sentTransactions);
  const contactItems = useContactAccountActivity();

  const [btcItems, setBtcItems] = useState<ActivityItem[]>(() => cachedFor(evmAccount.address).btc);
  const [evmItems, setEvmItems] = useState<ActivityItem[]>(() => cachedFor(evmAccount.address).evm);
  const [isLoading, setIsLoading] = useState(() => {
    const cached = cachedFor(evmAccount.address);
    return cached.btc.length === 0 && cached.evm.length === 0;
  });
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);

  const btcReady = btcAccount.address !== null;
  const evmAddress = evmAccount.address;
  const extension = btcAccount.extension;

  const refresh = useCallback(async () => {
    if (inFlight.current || !btcReady || !evmAddress) return;
    inFlight.current = true;
    if (lastFetched.owner !== evmAddress) Object.assign(lastFetched, { owner: evmAddress, btc: [], evm: [] });
    const failures: string[] = [];
    try {
      await Promise.all([
        extension()
          .getTransfers({ limit: BTC_HISTORY_FETCH_LIMIT })
          .then((transfers) => {
            lastFetched.btc = newestItems(parseBtcTransfers(transfers, 0), HISTORY_LIMIT);
            setBtcItems(lastFetched.btc);
          })
          .catch(() => failures.push('Bitcoin history')),
        fetchEvmActivity(evmAddress)
          .then((items) => {
            lastFetched.evm = items;
            setEvmItems(items);
          })
          .catch(() => failures.push('Ethereum history')),
      ]);
      setError(failures.length ? `Couldn't load ${failures.join(' and ')}. We'll keep trying.` : undefined);
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }, [btcReady, evmAddress, extension]);

  const pollMs = options.pollMs ?? BALANCE_POLL_MS;
  const active = useAppActive();
  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs, active]);

  const items = useMemo(
    () => collapseInternalMoves(mergeActivity([btcItems, evmItems, contactItems], localSends)),
    [btcItems, evmItems, contactItems, localSends],
  );
  return {
    items,
    isLoading,
    error,
    refresh,
  };
}
