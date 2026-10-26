// Renders nothing: hands the payment request module (src/paykit/requests.ts)
// the WDK calls it needs in the background, which only exist as hooks.
//
//   account 0      did our payment confirm; Sepolia transactions; sign a
//                  USD₮ payment proof (src/wallet/usePaymentChecks.ts)
//   automatic      a fee quote checked against the balance, and the send
//   payments       itself, for payments made under an Allowance from a
//                  round hook (src/paykit/automaticPayments.ts); the same
//                  WDK send as the Pay review (useSend)
//   each contact   what a Bitcoin payment paid into their account, for
//   account        checking a proof they sent (one reader component per
//                  account, since WDK's hooks are bound to one index)
//
// Mounted once with the tabs (src/navigation/MainTabs.tsx), so the round
// hooks can check proofs and finish payments whichever tab is open.
import { useEffect, useRef } from 'react';

import { paymentRequestsOf, useContactAccounts, usePaykitService, type PaymentChain } from '../../paykit';
import {
  checkAffordable,
  sendErrorMessage,
  sendFailureFor,
  useAccountZeroPaymentChecks,
  useBtcReceivedReader,
  useSend,
  useWalletBalances,
} from '../../wallet';

type Reader = (txid: string, address: string) => ReturnType<PaymentChain['btcReceived']>;

export function PaymentChainBridge() {
  const service = usePaykitService();
  const accountZero = useAccountZeroPaymentChecks();
  const wallet = useSend();
  const { balances } = useWalletBalances();
  const accounts = useContactAccounts();
  const readers = useRef(new Map<number, Reader>());
  // The latest balances, read when a round hook asks (not a dependency: the chain stays attached).
  const latestBalances = useRef(balances);
  latestBalances.current = balances;

  useEffect(() => {
    if (!service) return;
    const chain: PaymentChain = {
      ...accountZero,
      btcReceived: async (accountIndex, txid, address) => {
        const read = readers.current.get(accountIndex);
        if (!read) throw new Error(`Bitcoin account ${accountIndex} is not loaded yet`);
        return read(txid, address);
      },
      quoteSend: async (asset, to, amount) => {
        // Like the Pay review: the balance first, then WDK's fee, then amount + fee.
        const early = checkAffordable({ asset, amount, balances: latestBalances.current });
        if (early) return { ok: false, problem: early.message };
        try {
          const quote = await wallet.quote({ asset, to, amount });
          const problem = checkAffordable({ asset, amount, balances: latestBalances.current, fee: quote.fee });
          return problem ? { ok: false, problem: problem.message } : { ok: true, fee: quote.fee, feeAsset: quote.feeAsset, feeRate: quote.feeRate };
        } catch (error) {
          return { ok: false, problem: sendErrorMessage(error, asset) };
        }
      },
      send: async (asset, to, amount, feeRate) => {
        try {
          const result = await wallet.send({ asset, to, amount, feeRate });
          return { hash: result.hash };
        } catch (error) {
          const failure = sendFailureFor(error, asset);
          return { failure: failure.outcome, message: failure.message };
        }
      },
    };
    return paymentRequestsOf(service).attachChain(chain);
  }, [service, accountZero, wallet]);

  return (
    <>
      {accounts.map((account) => (
        <BtcReader key={account.accountIndex} accountIndex={account.accountIndex} readers={readers.current} />
      ))}
    </>
  );
}

function BtcReader({ accountIndex, readers }: { accountIndex: number; readers: Map<number, Reader> }) {
  const read = useBtcReceivedReader(accountIndex);
  useEffect(() => {
    if (!read) return;
    readers.set(accountIndex, read);
    return () => {
      if (readers.get(accountIndex) === read) readers.delete(accountIndex);
    };
  }, [accountIndex, read, readers]);
  return null;
}
