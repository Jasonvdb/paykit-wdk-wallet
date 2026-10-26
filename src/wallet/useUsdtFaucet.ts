// "Get test USD₮": the wallet mints Aave's Sepolia test USDT to itself.
//
// This sends a contract call from EVM account 0 through WDK's
// `sendTransaction` with `data` (see ./faucet.ts for the encoding). It needs
// a little Sepolia ETH for gas; Sepolia gas is usually a few gwei or less.
// `sendTransaction` must be in wdk.config.js `allowedMethods`.
import { useCallback } from 'react';
import { useAccount } from '@tetherto/wdk-react-native-core';

import { EVM_NETWORK } from '../config/wdk';
import { DEFAULT_FAUCET_MINT_UNITS, usdtFaucetTransaction } from './faucet';
import { transactionUrl } from './explorers';
import { recordSentTransaction } from './sentTransactions';

type EvmAccountExtension = {
  sendTransaction: (tx: { to: string; value: string; data: string }) => Promise<{ hash: string; fee: string }>;
};

export function useUsdtFaucet() {
  const evm = useAccount<EvmAccountExtension>({ network: EVM_NETWORK, accountIndex: 0 });
  const address = evm.address;
  const extension = evm.extension;

  /** Mint `amount` micro-USD₮ (default 1,000 USD₮) to this wallet. Resolves with the transaction hash. */
  const mint = useCallback(
    async (amount: bigint = DEFAULT_FAUCET_MINT_UNITS) => {
      if (!address) throw new Error('The wallet is not ready yet.');
      const result = await extension().sendTransaction(usdtFaucetTransaction(address, amount));
      if (!result?.hash) throw new Error('The faucet transaction was not sent.');
      recordSentTransaction({
        id: `ethereum:${result.hash}:local:faucet`,
        chain: 'ethereum',
        asset: 'usdt',
        direction: 'in',
        amount,
        hash: result.hash,
        timestamp: Date.now(),
        status: 'pending',
        accountIndex: 0,
      });
      return { hash: result.hash, explorerUrl: transactionUrl('ethereum', result.hash) };
    },
    [address, extension],
  );

  return { mint, isReady: address !== null };
}
