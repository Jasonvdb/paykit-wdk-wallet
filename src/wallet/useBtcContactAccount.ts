// One contact's private BTC account, and "collect": move its funds to
// account 0.
//
// Each contact gets its own BTC account index for private payment lists
// (src/paykit/addressCache.ts), so BTC they send lands in that account. WDK
// spends only from the account it is asked to, so money there must be moved
// to account 0 before the user can spend it with everything else.
//
// Collect is "almost everything", not a true sweep: WDK's getMaxSpendable
// assumes a two-output transaction and keeps back a dust-limit change
// output (about 546 sats), so a small remainder stays in the contact
// account or goes to the fee. A true sweep would need a single-output raw
// transaction.
//
// Render one component per contact account and call this hook in it; WDK's
// account hooks are bound to one index each.
import { useCallback, useEffect, useState } from 'react';
import { useAccount } from '@tetherto/wdk-react-native-core';

import { BTC, BTC_NETWORK } from '../config/wdk';
import { parseBaseUnits } from './amounts';
import { BTC_HISTORY_FETCH_LIMIT, newestItems, parseBtcTransfers, type ActivityItem } from './activity';
import { transactionUrl } from './explorers';
import { recordSentTransaction } from './sentTransactions';

/** How many of the contact account's transfers to show. */
const HISTORY_LIMIT = 10;

type BtcAccountExtension = {
  getMaxSpendable: () => Promise<{ amount: string; fee: string; changeValue: string }>;
  getTransfers: (options: { limit?: number }) => Promise<unknown>;
};

export function useBtcContactAccount(accountIndex: number) {
  const account = useAccount<BtcAccountExtension>({ network: BTC_NETWORK, accountIndex });
  const spending = useAccount({ network: BTC_NETWORK, accountIndex: 0 });
  const [sats, setSats] = useState<bigint>();
  const [transfers, setTransfers] = useState<ActivityItem[]>([]);

  const { getBalance, extension, send } = account;
  const ready = account.address !== null;

  const refresh = useCallback(async () => {
    if (!ready) return;
    const [balance] = await getBalance([BTC]);
    setSats(balance?.success ? parseBaseUnits(balance.balance) : undefined);
    // WDK returns the oldest transfers first; fetch all, keep the newest (see ./useActivity.ts).
    const all = await extension().getTransfers({ limit: BTC_HISTORY_FETCH_LIMIT });
    setTransfers(newestItems(parseBtcTransfers(all, accountIndex), HISTORY_LIMIT));
  }, [ready, getBalance, extension, accountIndex]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Move what WDK reports as spendable to account 0 (a dust-sized remainder
   * may stay, see the header). Resolves with the hash, or undefined if there
   * was nothing to move.
   */
  const collect = useCallback(async () => {
    if (!spending.address) throw new Error('The wallet is not ready yet.');
    const max = await extension().getMaxSpendable();
    const amount = parseBaseUnits(String(max?.amount ?? ''));
    if (amount === undefined || amount <= 0n) return undefined;
    const result = await send({ to: spending.address, asset: BTC, amount: amount.toString() });
    if (!result.success || !result.hash) throw new Error(result.error ?? 'The transfer to your main account was not sent.');
    recordSentTransaction({
      id: `bitcoin:${result.hash}:local:collect:${accountIndex}`,
      chain: 'bitcoin',
      asset: 'btc',
      direction: 'out',
      amount,
      fee: parseBaseUnits(String(result.fee)),
      hash: result.hash,
      counterpartyAddress: spending.address,
      timestamp: Date.now(),
      status: 'pending',
      accountIndex,
    });
    await refresh();
    return { hash: result.hash, explorerUrl: transactionUrl('bitcoin', result.hash) };
  }, [spending.address, extension, send, accountIndex, refresh]);

  return { address: account.address ?? undefined, sats, transfers, refresh, collect };
}
