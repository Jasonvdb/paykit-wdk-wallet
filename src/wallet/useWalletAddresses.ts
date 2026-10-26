// Receive addresses, derived by WDK in its worklet.
//
// Account model: BTC account i is exactly one address (m/84'/1'/0'/0/i on
// testnet). Account 0 is the public, spending account; contacts get their
// own BTC accounts (1, 2, ...) for private payment lists. EVM uses account 0
// for everything, because every EVM index is a separate account that would
// need its own gas.
import { useCallback } from 'react';
import { useAccount, useAddresses } from '@tetherto/wdk-react-native-core';

import { BTC_NETWORK, EVM_NETWORK } from '../config/wdk';

export type WalletAddresses = {
  /** BTC account 0 (tb1q...). Undefined until WDK has derived it. */
  btc?: string;
  /** EVM account 0 (0x...), used for ETH and USD₮. */
  evm?: string;
  isLoading: boolean;
};

/** The two public (account 0) addresses. */
export function useWalletAddresses(): WalletAddresses {
  const btc = useAccount({ network: BTC_NETWORK, accountIndex: 0 });
  const evm = useAccount({ network: EVM_NETWORK, accountIndex: 0 });
  return {
    btc: btc.address ?? undefined,
    evm: evm.address ?? undefined,
    isLoading: btc.isLoading || evm.isLoading,
  };
}

/**
 * Derive BTC addresses for any account indices (contacts' accounts). Returns
 * a function so callers can derive on demand, outside render.
 */
export function useBtcAddressLoader(): (accountIndices: number[]) => Promise<Map<number, string>> {
  const { loadAddresses } = useAddresses();
  return useCallback(
    async (accountIndices: number[]) => {
      const results = await loadAddresses(accountIndices, [BTC_NETWORK]);
      const addresses = new Map<number, string>();
      for (const result of results) {
        if (result.success && result.address) addresses.set(result.accountIndex, result.address);
      }
      return addresses;
    },
    [loadAddresses],
  );
}
