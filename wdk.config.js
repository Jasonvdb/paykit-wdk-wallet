// Worklet bundle config, read by `wdk-worklet-bundler generate` (npm postinstall).
//
// WDK does not run in Hermes. The bundler packs these wallet modules into a
// separate Bare runtime (react-native-bare-kit) that the app talks to over RPC.
// The keys under `networks` must match the keys in src/config/wdk.ts.
//
// `allowedMethods` limits which account methods the app can call over that
// RPC bridge. Without it, any method is callable, including key export.
/** @type {import('@tetherto/wdk-worklet-bundler').WdkBundleConfig} */
module.exports = {
  networks: {
    ethereum: { package: '@tetherto/wdk-wallet-evm' },
    bitcoin: { package: '@tetherto/wdk-wallet-btc' },
  },
  allowedMethods: {
    ethereum: {
      methods: [
        'getAddress',
        'getBalance',
        'getTokenBalance',
        'quoteSendTransaction',
        'sendTransaction',
        'quoteTransfer',
        'transfer',
        'getTransactionReceipt',
        'sign',
        'verify',
        'signTypedData',
      ],
    },
    bitcoin: {
      methods: [
        'getAddress',
        'getBalance',
        'quoteSendTransaction',
        'sendTransaction',
        'getTransfers',
        'getTransaction',
        'getMaxSpendable',
        'sign',
        'verify',
      ],
    },
  },
};
