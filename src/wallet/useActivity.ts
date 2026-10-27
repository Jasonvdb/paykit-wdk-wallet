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
//
// Two gaps in those sources are filled here:
// - Bitcoin times. WDK's transfers carry a block height, not a time, so
//   each confirmed transaction's block time is read once from Mutinynet's
//   esplora (fetchBtcTransactionStatus) and cached. Without it Bitcoin rows
//   say "confirmed" instead of "2m ago" and sort below every Ethereum row.
// - Ethereum confirmation. Blockscout often lists a transaction a minute or
//   more after its block, so a USD₮ send we made would stay "Pending" all
//   that time. While it does, WDK's getTransaction reads the receipt and the
//   local record is marked confirmed or failed (./sentTransactions.ts).
//
// A failed poll keeps the last list. Electrum's dropped connection gets one
// quiet retry (./electrumRetry.ts), and the screen hears about a failure
// only after a run of them (./failureStreak.ts).
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAccount } from '@tetherto/wdk-react-native-core';

import { SEPOLIA_BLOCKSCOUT_API, SEPOLIA_USDT } from '../config/chains';
import { BALANCE_POLL_MS } from '../config/sync';
import { BTC_NETWORK, EVM_NETWORK } from '../config/wdk';
import {
  BTC_HISTORY_FETCH_LIMIT,
  blockscoutSentFees,
  collapseInternalMoves,
  mergeActivity,
  missingBlockTimes,
  newestItems,
  parseBlockscoutTokenTransfers,
  parseBlockscoutTransactions,
  parseBtcTransfers,
  withBlockTimes,
  type ActivityItem,
} from './activity';
import { retryIfElectrumDropped } from './electrumRetry';
import { nextFailureStreak, NO_FAILURES, shouldReportFailure, type FailureStreak } from './failureStreak';
import { fetchBtcTransactionStatus } from './mutinynet';
import { evmTransactionFrom, sendOutcomeOf } from './paymentEvidence';
import { markSentTransaction, sentTransactions, subscribeSentTransactions } from './sentTransactions';
import { useAppActive } from './useAppActive';
import { contactAccountActivity, useContactAccountActivity } from './useContactAccountActivity';

/** The subset of WDK's BTC account methods this file calls through `extension()`. */
type BtcAccountExtension = {
  getTransfers: (options: { limit?: number; skip?: number; direction?: 'incoming' | 'outgoing' | 'all' }) => Promise<unknown>;
};

/** The EVM account method this file calls through `extension()` (allowed in wdk.config.js). */
type EvmAccountExtension = {
  getTransaction: (hash: string) => Promise<unknown>;
};

/** Block times (ms) of confirmed Bitcoin transactions, by txid. A block time never changes, so this only grows. */
const blockTimes = new Map<string, number>();

/** At most this many block times are read per poll, so a long history fills in over a few polls. */
const BLOCK_TIMES_PER_POLL = 10;

/** Read the block times `items` still lack. Resolves true if any were added. */
async function fetchMissingBlockTimes(items: ActivityItem[]): Promise<boolean> {
  const missing = missingBlockTimes(items, blockTimes).slice(0, BLOCK_TIMES_PER_POLL);
  const statuses = await Promise.all(missing.map((txid) => fetchBtcTransactionStatus(txid).catch(() => undefined)));
  let added = false;
  statuses.forEach((status, i) => {
    if (status?.confirmed && status.blockTime !== undefined) {
      blockTimes.set(missing[i], status.blockTime);
      added = true;
    }
  });
  return added;
}

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
  return [
    ...parseBlockscoutTransactions(transactions, address),
    ...parseBlockscoutTokenTransfers(tokenTransfers, address, blockscoutSentFees(transactions, address)),
  ];
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
  const evmAccount = useAccount<EvmAccountExtension>({ network: EVM_NETWORK, accountIndex: 0 });
  const localSends = useSyncExternalStore(subscribeSentTransactions, sentTransactions);
  const contactItems = useContactAccountActivity();

  const [btcItems, setBtcItems] = useState<ActivityItem[]>(() => cachedFor(evmAccount.address).btc);
  const [evmItems, setEvmItems] = useState<ActivityItem[]>(() => cachedFor(evmAccount.address).evm);
  const [isLoading, setIsLoading] = useState(() => {
    const cached = cachedFor(evmAccount.address);
    return cached.btc.length === 0 && cached.evm.length === 0;
  });
  const [error, setError] = useState<string>();
  /** Bumped when block times arrive, so the list re-renders with them. */
  const [blockTimesVersion, setBlockTimesVersion] = useState(0);
  const inFlight = useRef(false);
  const streaks = useRef<{ btc: FailureStreak; evm: FailureStreak }>({ btc: NO_FAILURES, evm: NO_FAILURES });

  const btcReady = btcAccount.address !== null;
  const evmAddress = evmAccount.address;
  const extension = btcAccount.extension;
  const evmExtension = evmAccount.extension;

  const refresh = useCallback(async () => {
    if (inFlight.current || !btcReady || !evmAddress) return;
    inFlight.current = true;
    if (lastFetched.owner !== evmAddress) Object.assign(lastFetched, { owner: evmAddress, btc: [], evm: [] });
    const track = (source: 'btc' | 'evm', succeeded: boolean) => {
      streaks.current[source] = nextFailureStreak(streaks.current[source], succeeded);
    };
    try {
      await Promise.all([
        retryIfElectrumDropped(() => extension().getTransfers({ limit: BTC_HISTORY_FETCH_LIMIT }))
          .then((transfers) => {
            lastFetched.btc = newestItems(parseBtcTransfers(transfers, 0), HISTORY_LIMIT);
            setBtcItems(lastFetched.btc);
            track('btc', true);
          })
          .catch(() => track('btc', false)),
        fetchEvmActivity(evmAddress)
          .then((items) => {
            lastFetched.evm = items;
            setEvmItems(items);
            track('evm', true);
          })
          .catch(() => track('evm', false)),
      ]);
      await Promise.all([
        fetchMissingBlockTimes([...lastFetched.btc, ...contactAccountActivity()]).then((added) => added && setBlockTimesVersion((v) => v + 1)),
        confirmPendingEvmSends(lastFetched.evm, evmExtension),
      ]);
      // Older lists stay on screen; only a run of failures is worth a line.
      const failing = [
        shouldReportFailure(streaks.current.btc, lastFetched.btc.length > 0) ? 'Bitcoin history' : undefined,
        shouldReportFailure(streaks.current.evm, lastFetched.evm.length > 0) ? 'Ethereum history' : undefined,
      ].filter((name): name is string => name !== undefined);
      setError(failing.length ? `Couldn't load ${failing.join(' and ')}. We'll keep trying.` : undefined);
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }, [btcReady, evmAddress, extension, evmExtension]);

  const pollMs = options.pollMs ?? BALANCE_POLL_MS;
  const active = useAppActive();
  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs, active]);

  const items = useMemo(
    () => collapseInternalMoves(mergeActivity([withBlockTimes(btcItems, blockTimes), evmItems, withBlockTimes(contactItems, blockTimes)], localSends)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- blockTimes is a mutable module map; blockTimesVersion says when it changed
    [btcItems, evmItems, contactItems, localSends, blockTimesVersion],
  );
  return {
    items,
    isLoading,
    error,
    refresh,
  };
}

/**
 * Our Ethereum sends that Blockscout has not listed yet: ask WDK for each
 * one's receipt and mark the local record confirmed or failed (a send
 * replaced by another with its nonce counts as failed; see sendOutcomeOf).
 * A read that fails leaves it pending; the next poll asks again.
 */
async function confirmPendingEvmSends(indexed: ActivityItem[], extension: () => EvmAccountExtension): Promise<void> {
  const listed = new Set(indexed.map((item) => item.hash.toLowerCase()));
  const pending = sentTransactions().filter((r) => r.chain === 'ethereum' && r.status === 'pending' && !listed.has(r.hash.toLowerCase()));
  await Promise.all(
    pending.map(async (record) => {
      try {
        const outcome = sendOutcomeOf(evmTransactionFrom(await extension().getTransaction(record.hash)));
        if (outcome) markSentTransaction(record.id, outcome);
      } catch {
        // Not found yet, or the RPC is down: stays pending.
      }
    }),
  );
}
