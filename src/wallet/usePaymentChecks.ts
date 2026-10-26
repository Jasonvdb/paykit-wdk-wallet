// The WDK calls behind payment requests: read a payment back from the
// chain, and sign a USD₮ payment proof.
//
//   btcSent(txid)            account 0's getTransaction: did our payment confirm?
//   btcReceived(..)          a contact account's getTransfers: what did a
//                            transaction pay into it? (useBtcReceivedReader,
//                            one per account: WDK's hooks are bound to one
//                            account index each), plus the block's time
//                            from Mutinynet's esplora
//   evmTransaction(hash)     getTransaction on Sepolia: finality, success, logs
//   findSentPayment(query)   a payment the app lost track of (no hash):
//                            account 0's sent transfers. Bitcoin from WDK's
//                            getTransfers (mempool included), with block
//                            times from Mutinynet's esplora; USD₮ from
//                            Blockscout, since WDK's EVM module has no
//                            history call
//   signErc20Payment(typed)  signTypedData with EVM account 0, for exactly
//                            the Paykit ERC-20 proof domain: the guard
//                            isErc20PaymentTypedData refuses anything else
//                            (an EIP-712 signature over another domain, such
//                            as an ERC-20 permit, could authorize spending)
//
// The WDK methods are allowed in wdk.config.js. The Paykit side calls them through
// src/features/requests/PaymentChainBridge.tsx. Errors from a read mean
// "can't tell yet": callers retry later and never treat them as "not paid".
import { useCallback, useMemo } from 'react';
import { useAccount } from '@tetherto/wdk-react-native-core';

import { SEPOLIA_CHAIN_ID } from '../config/chains';
import { BTC_NETWORK, EVM_NETWORK } from '../config/wdk';
import { BTC_HISTORY_FETCH_LIMIT, parseBtcTransfers } from './activity';
import { isErc20PaymentTypedData, type Erc20PaymentTypedData } from './erc20PaymentProof';
import { fetchBtcTransactionStatus } from './mutinynet';
import {
  btcReceiptFromTransfers,
  btcSendStatus,
  evmTransactionFrom,
  matchSentTransfer,
  sentTransferCandidates,
  type BtcReceipt,
  type BtcSendStatus,
  type EvmTransaction,
  type SentTransferMatch,
  type SentTransferQuery,
} from './paymentEvidence';
import { sentTransactions } from './sentTransactions';
import { fetchEvmActivity } from './useActivity';

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
  /** Throws when a source can't be read: the caller must not take that as "not sent". */
  findSentPayment(query: SentTransferQuery): Promise<SentTransferMatch>;
  signErc20Payment(typedData: Erc20PaymentTypedData): Promise<string>;
};

export function useAccountZeroPaymentChecks(): AccountZeroPaymentChecks {
  const btc = useAccount<BtcExtension>({ network: BTC_NETWORK, accountIndex: 0 }).extension;
  const evmAccount = useAccount<EvmExtension>({ network: EVM_NETWORK, accountIndex: 0 });
  const evm = evmAccount.extension;
  const evmAddress = evmAccount.address;
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
      findSentPayment: async (query) => {
        if (query.asset === 'usdt') {
          if (!evmAddress) throw new Error('The USD₮ account is not loaded yet');
          // What this app sent this session (not indexed yet), then the indexer.
          return matchSentTransfer([...sentTransactions(), ...(await fetchEvmActivity(evmAddress))], query);
        }
        const items = sentTransferCandidates(parseBtcTransfers(await btc().getTransfers({ limit: BTC_HISTORY_FETCH_LIMIT }), 0), query);
        // WDK's transfers carry a block height, not a time.
        for (const item of items) {
          if (item.status === 'confirmed') item.timestamp = (await fetchBtcTransactionStatus(item.hash))?.blockTime;
        }
        return matchSentTransfer(items, query);
      },
      signErc20Payment: async (typedData) => {
        if (!isErc20PaymentTypedData(typedData, SEPOLIA_CHAIN_ID)) throw new Error('Refusing to sign: not a Paykit ERC-20 payment proof');
        const signature = await evm().signTypedData(typedData);
        if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('The wallet returned no signature');
        return signature.toLowerCase();
      },
    }),
    [btc, evm, evmAddress],
  );
}

/** A reader for one Bitcoin account: what a transaction paid into it. Undefined until the account is loaded. */
export function useBtcReceivedReader(accountIndex: number): ((txid: string, address: string) => Promise<BtcReceipt>) | undefined {
  const account = useAccount<BtcExtension>({ network: BTC_NETWORK, accountIndex });
  const ready = account.address !== null;
  const { extension } = account;
  const read = useCallback(
    async (txid: string, address: string) => {
      const receipt = btcReceiptFromTransfers(await extension().getTransfers({ limit: BTC_HISTORY_FETCH_LIMIT }), txid, address);
      // The payee checks when it was paid (paymentProofs.ts); WDK gives only the height.
      if (receipt.confirmed) receipt.blockTimeMs = (await fetchBtcTransactionStatus(txid))?.blockTime;
      return receipt;
    },
    [extension],
  );
  return ready ? read : undefined;
}
