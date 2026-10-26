// WDK runtime configuration: which testnets the wallet talks to.
//
// The network keys ('bitcoin', 'ethereum') must match `networks` in
// wdk.config.js, which decides which wallet modules go into the worklet
// bundle. Chain constants live in ./chains.ts, so switching testnets is a
// change in those two files.
import { BaseAsset, type WdkConfigs } from '@tetherto/wdk-react-native-core';

import { MUTINYNET_ELECTRUM, SEPOLIA_CHAIN_ID, SEPOLIA_RPC, SEPOLIA_USDT } from './chains';

export const BTC_NETWORK = 'bitcoin';
export const EVM_NETWORK = 'ethereum';

/**
 * The one WDK wallet (seed) this app manages. WDK stores the encrypted seed
 * in the Keychain/Keystore under this id. Do not change it: existing installs
 * would no longer find their wallet.
 */
export const WALLET_ID = 'paykit-wdk-demo';

export const wdkConfigs: WdkConfigs = {
  networks: {
    [BTC_NETWORK]: {
      blockchain: BTC_NETWORK,
      config: {
        // WDK's BTC module only knows 'bitcoin' | 'testnet' | 'regtest'.
        // Signets use testnet address rules (tb1..., m/84'/1'), so 'testnet'
        // is right for Mutinynet.
        network: 'testnet',
        bip: 84,
        client: { type: 'electrum', clientConfig: { ...MUTINYNET_ELECTRUM } },
      },
    },
    [EVM_NETWORK]: {
      blockchain: EVM_NETWORK,
      config: {
        provider: SEPOLIA_RPC,
        chainId: SEPOLIA_CHAIN_ID,
      },
    },
  },
};

/** WDK asset descriptors. `id` values are local to WDK's balance cache. */
export const BTC = new BaseAsset({
  id: 'btc-mutinynet',
  network: BTC_NETWORK,
  symbol: 'BTC',
  name: 'Bitcoin (Mutinynet)',
  decimals: 8,
  isNative: true,
  address: null,
});

export const ETH = new BaseAsset({
  id: 'eth-sepolia',
  network: EVM_NETWORK,
  symbol: 'ETH',
  name: 'Ether (Sepolia)',
  decimals: 18,
  isNative: true,
  address: null,
});

export const USDT = new BaseAsset({
  id: 'usdt-sepolia',
  network: EVM_NETWORK,
  symbol: 'USDT',
  name: 'Tether USD (Sepolia, Aave test token)',
  decimals: 6,
  isNative: false,
  address: SEPOLIA_USDT,
});
