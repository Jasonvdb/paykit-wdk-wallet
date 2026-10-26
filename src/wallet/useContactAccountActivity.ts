// History of the contacts' Bitcoin accounts, merged into Activity.
//
// Each contact pays us privately at their own BTC account (1, 2, …; see
// src/paykit/addressCache.ts). Those payments never touch account 0, so
// the account-0 history (./useActivity.ts) does not show them. This file
// fetches each contact account's transfers and keeps them in one shared
// list that useActivity merges in.
//
// Why a "watcher" per account: WDK's account hooks are bound to one account
// index each, and hooks cannot be called in a loop of changing length. So a
// screen renders one small component per contact account (see
// src/features/wallet/activity/ContactAccountWatchers.tsx); each calls
// useContactAccountWatcher(index), which polls that account while the app
// is active and writes into the shared list.
import { useEffect, useSyncExternalStore } from 'react';
import { useAccount } from '@tetherto/wdk-react-native-core';

import { BALANCE_POLL_MS } from '../config/sync';
import { BTC_NETWORK } from '../config/wdk';
import { BTC_HISTORY_FETCH_LIMIT, newestItems, parseBtcTransfers, type ActivityItem } from './activity';
import { useAppActive } from './useAppActive';

/** How many transfers to keep per contact account. */
const HISTORY_LIMIT = 10;

type BtcAccountExtension = {
  getTransfers: (options: { limit?: number }) => Promise<unknown>;
};

const byAccount = new Map<number, ActivityItem[]>();
let snapshot: ActivityItem[] = [];
const listeners = new Set<() => void>();

function publish(): void {
  snapshot = [...byAccount.values()].flat();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every contact account's recent transfers (unsorted). */
export function contactAccountActivity(): ActivityItem[] {
  return snapshot;
}

/** Drop everything, e.g. when the watchers unmount because the wallet went away. */
export function clearContactAccountActivity(): void {
  if (byAccount.size === 0) return;
  byAccount.clear();
  publish();
}

/** The shared list, for React. */
export function useContactAccountActivity(): ActivityItem[] {
  return useSyncExternalStore(subscribe, contactAccountActivity);
}

/** Poll one contact account's transfers into the shared list. Render-free; see the header. */
export function useContactAccountWatcher(accountIndex: number): void {
  const account = useAccount<BtcAccountExtension>({ network: BTC_NETWORK, accountIndex });
  const active = useAppActive();
  const ready = account.address !== null;
  const { extension } = account;

  useEffect(() => {
    if (!ready || !active) return;
    let cancelled = false;
    const load = async () => {
      try {
        // WDK returns the oldest transfers first; fetch all, keep the newest (see ./useActivity.ts).
        const all = await extension().getTransfers({ limit: BTC_HISTORY_FETCH_LIMIT });
        if (cancelled) return;
        byAccount.set(accountIndex, newestItems(parseBtcTransfers(all, accountIndex), HISTORY_LIMIT));
        publish();
      } catch {
        // Electrum unreachable: keep the last list; the next poll retries.
      }
    };
    void load();
    const timer = setInterval(() => void load(), BALANCE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ready, active, extension, accountIndex]);
}
