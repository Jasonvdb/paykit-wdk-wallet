// The WDK calls behind payment requests: read a payment back from the
// chain, and sign a USD₮ payment proof.
//
//   btcSent(txid)            account 0's getTransaction: did our payment confirm?
//   btcReceived(..)          a contact account's getTransfers: what did a
//                            transaction pay into it? (useBtcReceivedReader,
//                            one per account: WDK's hooks are bound to one
//                            account index each)
//   evmTransaction(hash)     getTransaction on Sepolia: finality, success, logs
//   signErc20Payment(typed)  signTypedData with EVM account 0, for exactly
//                            the Paykit ERC-20 proof domain: the guard
//                            isErc20PaymentTypedData refuses anything else
//                            (an EIP-712 signature over another domain, such
//                            as an ERC-20 permit, could authorize spending)
//
// All four are allowed in wdk.config.js. The Paykit side calls them through
// src/features/requests/PaymentChainBridge.tsx. Errors from a read mean
// "can't tell yet": callers retry later and never treat them as "not paid".
import { useCallback, useMemo } from 'react';
import { useAccount } from '@tetherto/wdk-react-native-core';

import { SEPOLIA_CHAIN_ID } from '../config/chains';
import { BTC_NETWORK, EVM_NETWORK } from '../config/wdk';
import { BTC_HISTORY_FETCH_LIMIT } from './activity';
import { isErc20PaymentTypedData, type Erc20PaymentTypedData } from './erc20PaymentProof';
import { btcReceiptFromTransfers, btcSendStatus, evmTransactionFrom, type BtcReceipt, type BtcSendStatus, type EvmTransaction } from './paymentEvidence';

type BtcExtension = {
  getTransaction: (hash: string) => Promise<unknown>;
  getTransfers: (options: { limit?: number }) => Promise<unknown>;
};
type EvmExtension = {
  getTransaction: (hash: string) => Promise<unknown>;
  signTypedData: (typedData: Erc20PaymentTypedData) => Promise<string>;
};

export type AccountZeroPaymentChecks = {
  btcSent(txid: string): Promise<BtcSendStatus>;
  evmTransaction(hash: string): Promise<EvmTransaction>;
  signErc20Payment(typedData: Erc20PaymentTypedData): Promise<string>;
};

export function useAccountZeroPaymentChecks(): AccountZeroPaymentChecks {
  const btc = useAccount<BtcExtension>({ network: BTC_NETWORK, accountIndex: 0 }).extension;
  const evm = useAccount<EvmExtension>({ network: EVM_NETWORK, accountIndex: 0 }).extension;
  return useMemo(
    () => ({
      btcSent: async (txid) => {
        try {
          return btcSendStatus(await btc().getTransaction(txid));
        } catch {
          // Usually "not in the history yet" (Electrum has not seen it).
          return { found: false, confirmed: false };
        }
      },
      evmTransaction: async (hash) => {
        try {
          return evmTransactionFrom(await evm().getTransaction(hash));
        } catch {
          return { state: 'unknown' };
        }
      },
      signErc20Payment: async (typedData) => {
        if (!isErc20PaymentTypedData(typedData, SEPOLIA_CHAIN_ID)) throw new Error('Refusing to sign: not a Paykit ERC-20 payment proof');
        const signature = await evm().signTypedData(typedData);
        if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('The wallet returned no signature');
        return signature.toLowerCase();
      },
    }),
    [btc, evm],
  );
}

/** A reader for one Bitcoin account: what a transaction paid into it. Undefined until the account is loaded. */
export function useBtcReceivedReader(accountIndex: number): ((txid: string, address: string) => Promise<BtcReceipt>) | undefined {
  const account = useAccount<BtcExtension>({ network: BTC_NETWORK, accountIndex });
  const ready = account.address !== null;
  const { extension } = account;
  const read = useCallback(
    async (txid: string, address: string) => btcReceiptFromTransfers(await extension().getTransfers({ limit: BTC_HISTORY_FETCH_LIMIT }), txid, address),
    [extension],
  );
  return ready ? read : undefined;
}
