// WDK runtime configuration: which testnets the wallet talks to.
//
// The network keys ('bitcoin', 'ethereum') must match `networks` in
// wdk.config.js, which decides which wallet modules go into the worklet
// bundle. Keep every endpoint here so switching testnets is a one-file change.
import { BaseAsset, type WdkConfigs } from '@tetherto/wdk-react-native-core';

export const BTC_NETWORK = 'bitcoin';
export const EVM_NETWORK = 'ethereum';

/**
 * Bitcoin on Mutinynet (a signet with 30 s blocks).
 *
 * WDK's BTC module only knows 'bitcoin' | 'testnet' | 'regtest'. Signets use
 * testnet address rules (tb1..., m/84'/1'), so 'testnet' is right here.
 * Mutinynet's Electrum TLS port (50002) has an expired certificate, so we use
 * plain TCP on 50001. That is fine for public testnet data, never for mainnet.
 */
export const BTC_ELECTRUM = {
  host: 'electrum.mutinynet.com',
  port: 50001,
  protocol: 'tcp',
} as const;

/** Fallback if Electrum over TCP fails inside the worklet: testnet4 over TLS. */
export const BTC_ELECTRUM_TESTNET4 = {
  host: 'mempool.space',
  port: 40002,
  protocol: 'tls',
} as const;

export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

/** Aave's test USDT on Sepolia. Anyone can mint it through the Aave faucet. */
export const SEPOLIA_USDT = '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0';

export const wdkConfigs: WdkConfigs = {
  networks: {
    [BTC_NETWORK]: {
      blockchain: BTC_NETWORK,
      config: {
        network: 'testnet',
        bip: 84,
        client: { type: 'electrum', clientConfig: { ...BTC_ELECTRUM } },
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
