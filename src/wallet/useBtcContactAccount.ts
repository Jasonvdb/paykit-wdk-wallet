// One contact's private BTC account, and "collect": move its funds to
// account 0.
//
// Each contact gets its own BTC account index for private payment lists
// (src/paykit/addressCache.ts), so BTC they send lands in that account. WDK
// spends only from the account it is asked to, so money there must be moved
// to account 0 before the user can spend it with everything else.
//
// Collect empties the account: it sends getMaxSpendable's amount plus the
// dust-sized change WDK planned to keep back, so WDK builds a one-output
// transaction (./collect.ts says why and how).
//
// Render one component per contact account and call this hook in it; WDK's
// account hooks are bound to one index each.
import { useCallback, useEffect, useState } from 'react';
import { useAccount } from '@tetherto/wdk-react-native-core';

import { BTC, BTC_NETWORK } from '../config/wdk';
import { fetchBtcFeeRate } from './mutinynet';
import { parseBaseUnits } from './amounts';
import { BTC_HISTORY_FETCH_LIMIT, newestItems, parseBtcTransfers, type ActivityItem } from './activity';
import { collectAmount } from './collect';
import { retryIfElectrumDropped } from './electrumRetry';
import { transactionUrl } from './explorers';
import { recordSentTransaction } from './sentTransactions';

/** How many of the contact account's transfers to show. */
const HISTORY_LIMIT = 10;

type BtcAccountExtension = {
  getMaxSpendable: (options: { feeRate?: number }) => Promise<{ amount: string; fee: string; changeValue: string }>;
  sendTransaction: (tx: { to: string; value: string; feeRate?: number }) => Promise<{ hash: string; fee: string }>;
  getTransfers: (options: { limit?: number }) => Promise<unknown>;
};

export function useBtcContactAccount(accountIndex: number) {
  const account = useAccount<BtcAccountExtension>({ network: BTC_NETWORK, accountIndex });
  const spending = useAccount({ network: BTC_NETWORK, accountIndex: 0 });
  const [sats, setSats] = useState<bigint>();
  const [transfers, setTransfers] = useState<ActivityItem[]>([]);

  const { getBalance, extension } = account;
  const ready = account.address !== null;

  const refresh = useCallback(async () => {
    if (!ready) return;
    const [balance] = await getBalance([BTC]);
    setSats(balance?.success ? parseBaseUnits(balance.balance) : undefined);
    // WDK returns the oldest transfers first; fetch all, keep the newest (see ./useActivity.ts).
    const all = await retryIfElectrumDropped(() => extension().getTransfers({ limit: BTC_HISTORY_FETCH_LIMIT }));
    setTransfers(newestItems(parseBtcTransfers(all, accountIndex), HISTORY_LIMIT));
  }, [ready, getBalance, extension, accountIndex]);

  useEffect(() => {
    // A failed read (Electrum unreachable) leaves the last values; the
    // screen offers a manual refresh.
    refresh().catch(() => undefined);
  }, [refresh]);

  /**
   * Move the whole balance to account 0, less the fee (see the header).
   * Resolves with the hash, or undefined if there was nothing to move.
   *
   * One fee rate for both steps: getMaxSpendable sizes the amount at a rate,
   * and the send must pay that same rate, or amount + fee no longer fits
   * ("Insufficient balance after fees").
   */
  const collect = useCallback(async () => {
    if (!spending.address) throw new Error('The wallet is not ready yet.');
    const rate = await fetchBtcFeeRate().catch(() => undefined);
    const feeRate = rate !== undefined ? Number(rate) : undefined;
    const amount = collectAmount(await extension().getMaxSpendable(feeRate !== undefined ? { feeRate } : {}));
    if (amount === undefined) return undefined;
    const sent = await extension().sendTransaction({ to: spending.address, value: amount.toString(), ...(feeRate !== undefined ? { feeRate } : {}) });
    if (!sent?.hash) throw new Error('The transfer to your main account was not sent.');
    recordSentTransaction({
      id: `bitcoin:${sent.hash}:local:collect:${accountIndex}`,
      chain: 'bitcoin',
      asset: 'btc',
      direction: 'out',
      amount,
      fee: parseBaseUnits(String(sent.fee)),
      hash: sent.hash,
      counterpartyAddress: spending.address,
      timestamp: Date.now(),
      status: 'pending',
      accountIndex,
    });
    await refresh().catch(() => undefined);
    return { hash: sent.hash, explorerUrl: transactionUrl('bitcoin', sent.hash) };
  }, [spending.address, extension, accountIndex, refresh]);

  return { address: account.address ?? undefined, sats, transfers, refresh, collect };
}
