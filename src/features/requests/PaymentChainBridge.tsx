// Renders nothing: hands the payment request module (src/paykit/requests.ts)
// the WDK calls it needs in the background, which only exist as hooks.
//
//   account 0      did our payment confirm; Sepolia transactions; sign a
//                  USD₮ payment proof (src/wallet/usePaymentChecks.ts)
//   each contact   what a Bitcoin payment paid into their account, for
//   account        checking a proof they sent (one reader component per
//                  account, since WDK's hooks are bound to one index)
//
// Mounted once with the tabs (src/navigation/MainTabs.tsx), so the round
// hooks can check proofs and finish payments whichever tab is open.
import { useEffect, useRef } from 'react';

import { paymentRequestsOf, useContactAccounts, usePaykitService, type PaymentChain } from '../../paykit';
import { useAccountZeroPaymentChecks, useBtcReceivedReader } from '../../wallet';

type Reader = (txid: string, address: string) => ReturnType<PaymentChain['btcReceived']>;

export function PaymentChainBridge() {
  const service = usePaykitService();
  const accountZero = useAccountZeroPaymentChecks();
  const accounts = useContactAccounts();
  const readers = useRef(new Map<number, Reader>());

  useEffect(() => {
    if (!service) return;
    const chain: PaymentChain = {
      ...accountZero,
      btcReceived: async (accountIndex, txid, address) => {
        const read = readers.current.get(accountIndex);
        if (!read) throw new Error(`Bitcoin account ${accountIndex} is not loaded yet`);
        return read(txid, address);
      },
    };
    return paymentRequestsOf(service).attachChain(chain);
  }, [service, accountZero]);

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
