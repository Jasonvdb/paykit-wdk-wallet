// Worklet bundle config, read by `wdk-worklet-bundler generate` (npm postinstall).
//
// WDK does not run in Hermes. The bundler packs these wallet modules into a
// separate Bare runtime (react-native-bare-kit) that the app talks to over RPC.
// The keys under `networks` must match the keys in src/config/wdk.ts.
//
// `allowedMethods` limits which account methods the app can call over that
// RPC bridge. Without it, any method is callable, including key export.
// Keep it to what the app calls. After editing, run
// `npx wdk-worklet-bundler generate` and cold-relaunch the app (the worklet
// does not hot reload).
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
        'getBalance', // ETH balance
        'getTokenBalance', // USD₮ balance
        'getTokenBalances', // WDK's balance hooks batch token reads
        'quoteSendTransaction', // ETH send fee
        // General on-chain authority: it signs any call data (an ERC-20
        // approve() included), so it is as powerful as 'signTypedData'.
        // The app sends call data from one place only, the Aave faucet mint,
        // behind isAllowedContractCall (src/wallet/faucet.ts). ETH sends use
        // WDK's `send`, which takes no data.
        'sendTransaction',
        'quoteTransfer', // USD₮ send fee
        'transfer', // USD₮ (ERC-20) send
        'getTransactionReceipt', // Phase 5: verify a USD₮ payment before issuing a receipt (read-only)
        // Not 'signTypedData': EIP-712 signatures can authorize spending off
        // chain (e.g. ERC-20 permits). Phase 5 adds it with the code that
        // uses it, naming the exact typed-data domain it signs.
      ],
    },
    bitcoin: {
      methods: [
        'getAddress',
        'getBalance',
        'quoteSendTransaction', // BTC send fee
        'sendTransaction', // BTC send and the contact-account "collect" transfer
        'getTransfers', // BTC history
        'getMaxSpendable', // collect: how much of a contact account can move to account 0
        'getTransaction', // Phase 5: verify a BTC payment before issuing a receipt
      ],
    },
  },
};
