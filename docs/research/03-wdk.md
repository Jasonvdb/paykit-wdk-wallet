# 03 — Tether WDK: architecture, React Native path, and testnet chain choice

Research date: 2026-10-26. Sources: npm registry, shallow clones of `tetherto/*` repos (read-only, under the session scratchpad `wdk/repos/`), unpacked npm tarballs (`wdk/tar/`), the docs source repo `tetherto/wdk-docs` (rendered at <https://docs.wdk.tether.io>), and live read-only probes of public testnet endpoints. Anything not checked against code or a live endpoint is marked **(unverified)**.

## TL;DR

- WDK is a set of **pure-JS wallet modules** (`@tetherto/wdk-wallet-<chain>`) plus a small orchestrator (`@tetherto/wdk`). All packages are `1.0.0-beta.x` and Apache-2.0.
- In React Native, WDK does **not** run in Hermes. The official path runs WDK inside a **Bare worklet**, which is a separate JS runtime thread embedded by the native module `react-native-bare-kit`. The React Native app talks to the worklet over HRPC. Expect no Node polyfills and no Metro hacks, but you do need a generated worklet bundle and native addons linked into the app.
- The official stack is `@tetherto/wdk-react-native-core` (hooks + provider) + `@tetherto/wdk-worklet-bundler` (CLI that builds the worklet bundle) + `react-native-bare-kit` (native). The official starter is **Expo SDK 55 / RN 0.83.6, New Architecture, npm**: <https://github.com/tetherto/wdk-starter-react-native> (HEAD `f34ed48c`).
- **Recommended two chains:** (1) **Ethereum Sepolia native ETH** via `@tetherto/wdk-wallet-evm`, and (2) **Bitcoin testnet on-chain** via `@tetherto/wdk-wallet-btc` using an Electrum TLS server. Together they give account-based plus UTXO, 12 s versus ~10 min blocks, and `0x…` versus `tb1…` addresses. Neither needs an API key.
- **Best single minimal-dependency chain:** Sepolia native ETH with `@tetherto/wdk-wallet-evm`.
- **Strong stretch option:** **Spark REGTEST** (`@tetherto/wdk-wallet-spark`). It gives instant, fee-free BTC transfers and Spark invoices, which fit Paykit payment requests well. It is heavier (a Rust FROST native addon) and depends on Lightspark's hosted regtest.
- The WDK **Indexer API is not useful for testnets** apart from Sepolia USD₮. History has to come from module methods (BTC and Spark have `getTransfers`) or keyless explorers (Blockscout, mempool.space). Paykit receipts are another option.

---

## 1. Architecture

### 1.1 Packages (npm `latest` on 2026-10-26)

| Package | Version | Role |
|---|---|---|
| `@tetherto/wdk` | 1.0.0-beta.22 | Orchestrator: `new WDK(seed).registerWallet(name, Manager, config)`, `getAccount(name, index)`, `getAccountByPath`, `getFeeRates`, `registerProtocol`, `registerMiddleware`, `registerPolicy` (local ALLOW/DENY policy engine), `dispose`, `WDK.getRandomSeedPhrase()`, `WDK.isValidSeed()` |
| `@tetherto/wdk-wallet` | 1.0.0-beta.25 | Base classes (internal) |
| `@tetherto/wdk-wallet-evm` | 1.0.0-beta.24 (`rc` tag 2.0.0-rc.1) | EVM EOA (ethers 6.17.0) |
| `@tetherto/wdk-wallet-evm-erc-4337` | 1.0.0-beta.23 | Safe smart account + bundler/paymaster (abstractionkit 0.4.0) |
| `wdk-wallet-evm-7702-gasless` | (repo exists; used by starter) | EIP-7702 gasless |
| `@tetherto/wdk-wallet-btc` | 1.0.0-beta.17 | BIP-84/44 BTC (bitcoinjs-lib 7, Electrum/Blockbook clients) |
| `@tetherto/wdk-wallet-spark` | 1.0.0-beta.30 | Spark L2 + Lightning (`@buildonspark/spark-sdk` 0.10.0, `@buildonspark/bare` 0.0.78) |
| `@tetherto/wdk-wallet-solana` | 1.0.0-beta.20 | Solana (`@solana/*` 3.0.3) |
| `@tetherto/wdk-wallet-ton` | 1.0.0-beta.17 | TON (`@ton/ton` 16.2.4) |
| `@tetherto/wdk-wallet-tron` | 1.0.0-beta.16 | Tron (tronweb 6.5.1) |
| `-solana-gasless`, `-ton-gasless`, `-tron-gasfree`, `-aptos`, multisig… | various | Not needed |
| `@tetherto/wdk-react-native-core` | 1.0.0-beta.22 (2026-10-21) / beta.21 (2026-09-24) | RN provider + hooks; talks to the worklet |
| `@tetherto/pear-wrk-wdk` | 1.0.0-beta.15 is the version core depends on (latest is beta.17) | Worklet-side RPC handlers + HRPC client schema |
| `@tetherto/wdk-worklet-bundler` | 1.0.0-beta.16 (2026-10-22); beta.15 (2026-10-09) | CLI that generates the worklet bundle. engines: node `^22.21 \|\| >=24.9` |
| `@tetherto/wdk-indexer-http` | 1.0.3 | Client for `https://wdk-api.tether.io` (API key needed) |
| `@tetherto/wdk-pricing-provider`, `-pricing-bitfinex-http`, `-pricing-coingecko-http` | beta | Fiat prices (optional) |
| `@tetherto/wdk-secret-manager` | 1.0.0-beta.3 | Seed encryption helpers (used inside the worklet) |
| `@tetherto/wdk-utils` | 1.0.0-beta.15 | Address validation, payment URIs, encryption |
| `@tetherto/wdk-react-native-provider` | 1.0.0-beta.3 (2026-07) | **Legacy polyfill path. Do not use.** The starter's `docs/WDK_INTEGRATION.md` "Step 0" calls it "dependency hell". |

`@tetherto/wdk-worklet` does not exist on npm (404).

### 1.2 Account API (common surface across chain modules)

Read from `src/*.js` in each wallet repo:

- `getAddress()`, `getBalance()` (bigint in base units), `getTokenBalance(addr)`, and `getTokenBalances([...])` on EVM and Solana.
- `sendTransaction(tx)` for native coin. EVM uses `{to, value}`; BTC uses `{to, value, feeRate?, confirmationTarget?}`. Returns `{hash, fee}`.
- `quoteSendTransaction(tx)` returns `{fee}`. This is the fee estimate.
- `transfer({token, recipient, amount})` and `quoteTransfer(...)` handle tokens (ERC-20, SPL, Jetton, TRC-20). **BTC `transfer` always throws `UnsupportedOperationError`.**
- `sign(message)`, `verify(message, sig)`, and `signTransaction`. EVM also has `signTypedData`, `approve`, `getAllowance`, and 7702 `delegate`.
- `getTransaction(hash)`, `getTransactionReceipt(hash)`, `waitForTransaction(hash, opts)`.
- `toReadOnlyAccount()`, `keyPair`, `path`, `dispose()`.
- Manager-level: `getFeeRates()`.
- **Transaction history:**
  - BTC: `getTransfers({direction, limit, skip})` is built in and reads from Electrum or Blockbook.
  - Spark: `getTransfers(...)` is built in.
  - EVM, Solana, TON, Tron: **no history method**. Use the Indexer API (mainnet-centric, needs a key) or an explorer API.
- BTC extras: `getMaxSpendable()`. **One address per account**: account `i` = `m/84'/1'/0'/0/i` on testnet and regtest (`wallet-manager-btc.js:140`). Change returns to the same address. `listUnspent` is not filtered by confirmations, so unconfirmed coins can be spent (unverified at runtime).
- Spark extras:
  - Deposits: `getSingleUseDepositAddress`, `getStaticDepositAddress`, `claimDeposit`, `claimStaticDeposit`.
  - Lightning: `createLightningInvoice`, `payLightningInvoice`, `quotePayLightningInvoice`.
  - Spark invoices: `createSparkSatsInvoice`, `paySparkInvoice`.
  - Withdrawal: `withdraw`, `quoteWithdraw`.
  - `syncWalletBalance`.

### 1.3 Worklet architecture (React Native)

```
RN app (Hermes)                                Bare worklet thread (react-native-bare-kit)
@tetherto/wdk-react-native-core  ── HRPC ──▶  .wdk-bundle/wdk-worklet.bundle.js
  WdkAppProvider, hooks                         = @tetherto/pear-wrk-wdk/worklet
  zustand + react-query + mmkv                  + @tetherto/wdk + wallet modules (bare.js entry)
  react-native-keychain (encrypted seed)        + bare-node-runtime (Node-like globals)
                                                + native addons (sodium-native, bare-tcp, bare-tls, …)
```

- HRPC methods (`pear-wrk-wdk/generated/hrpc/hrpc.json`): `workletStart`, `initializeWDK`, `registerWallet`, `registerProtocol`, `callMethod`, `callModule`, `generateEntropyAndEncrypt`, `getMnemonicFromEntropy`, `getSeedAndEntropyFromMnemonic`, `resetWdkWallets`, `dispose`, `log`, `moduleEvent`.
- `callMethod` (`src/handlers/execution.js`) does `wdk.getAccount(network, index)[methodName](...args)` on **any** account method. An array of args is spread. Methods can be locked down per network with `allowedMethods` in `wdk.config.js`. Without that, any method is callable, including key export via `keyPair`.
- In RN, `useAccount({network, accountIndex})` returns `{address, getBalance, send, sign, verify, estimateFee, extension}`.
  - `send({to, asset, amount})` maps to `sendTransaction` for a native asset and to `transfer` for a token.
  - `extension()` is a Proxy that forwards **any** method name to `callMethod`, for example `extension().getTransfers({limit: 20})` for BTC or `extension().createSparkSatsInvoice(...)` for Spark.
- Other hooks: `useWdkApp` (`state.status`: `INITIALIZING | NO_WALLET | LOCKED | READY | ERROR | REINITIALIZING`), `useWalletManager` (`createWallet(id)`, `restoreWallet`, `unlock(id)`, `lock()` (async, mutexed), `switchWallet`), `useAddresses`, `useBalance`, `useBalancesForWallet`, `useRefreshBalance`, `useProtocol`, `useModule`, and the `BaseAsset` entity.
- Identity is caller-owned: the library never auto-unlocks. `lock()` sends a one-way dispose and **does not prove seed erasure** (docs say so explicitly).
- Bare engine: V8 on Android and JavaScriptCore on iOS (inferred from `execution.js`, which special-cases JSC logging when `Bare.platform === 'ios'`).

### 1.4 Native addons — the non-obvious part

The bundle header lists `linked:` native addons. The starter's 12 MB bundle needs `sodium-native`, `bare-crypto`, `bare-tcp`, `bare-tls`, `bare-dns`, `bare-fs`, and others, plus `buildonspark__spark-frost-bare-addon` because the starter includes Spark. These must be compiled into the app:

- `react-native-bare-kit` **≤ 0.15.6** links them automatically. The podspec runs `prepare_command "node ios/link.mjs"` and Gradle `preBuild` runs `node link.mjs`. Both call `bare-link` on `node_modules/react-native-bare-kit/../../` (the app root) and write into `node_modules/react-native-bare-kit/ios/addons` and `android/src/main/addons`.
- **`react-native-bare-kit` 0.16.0 (2026-10-09) removed automatic addon linking** (commit "Remove automatic addon linking (#65)"). Core's peer range is `>=0.14.5`, so a fresh `npm i` can resolve 0.16.0, and the worklet then crashes at the first `require.addon`. **Pin `react-native-bare-kit` to `0.14.5`, as the starter and showcase do.** If you upgrade, run `bare-link` yourself.
- **pnpm hazard:** `link.mjs` resolves the app root as `../../..` from the package's *real* path. Under pnpm's symlinked store that is `node_modules/.pnpm/...`, not the app root, and it would also write into the content-addressed store. **Use npm**, as the starter does and as the Paykit RN example does with its `package-lock.json`. Or set pnpm `node-linker=hoisted` (unverified that it is sufficient). The podspec also reads `../../package-lock.json` (or `yarn.lock`) to version-bust the pod.
- Prebuilds exist for `ios-arm64`, `ios-arm64-simulator`, `ios-x64-simulator`, `android-arm64/arm/x64/ia32` (checked for `sodium-native@5.1.0` and `@buildonspark/spark-frost-bare-addon@0.0.12`). Apple-silicon simulators and emulators are covered.
- `react-native-bare-kit` is a TurboModule (`codegenConfig`), so the **New Architecture is required**. RN 0.83 is New-Arch-only anyway. Package size is about 353 MB unpacked (prebuilt Bare runtime for all ABIs).

---

## 2. Official React Native integration path

### 2.1 Hermes versus Bare

WDK modules ship a `bare.js` entry: `import 'bare-node-runtime/global'` plus re-exports with `imports: 'bare-node-runtime/imports'`. They depend on `sodium-universal`, which resolves to `sodium-native` (a native addon) under Bare. Running them in Hermes would need the old polyfill set, which `wdk-react-native-provider` used and which the starter explicitly abandoned. **Use the Bare worklet. Do not add `crypto.getRandomValues`/`Buffer`/`stream` polyfills for WDK.**

The starter still lists `react-native-get-random-values` and `buffer`, but they are for app code, not WDK.

### 2.2 Official starter to crib from

`tetherto/wdk-starter-react-native` (HEAD `f34ed48c`, alpha):

- Stack: Expo SDK **55** (`expo ^55.0.23`), `react-native 0.83.6`, React 19.2.0, expo-router, New Arch, **npm ≥ 11.10.1**, JDK **17** per `docs/ENVIRONMENT.md`.
- WDK packages: `@tetherto/wdk-react-native-core` **1.0.0-beta.17** (exact), `react-native-bare-kit` **0.14.5** (exact), `react-native-nitro-modules ^0.36.1` (for mmkv v4), `bare-node-runtime ^1.5.0`, `@tetherto/wdk-worklet-bundler ^1.0.0-beta.9` (dev), `@buildonspark/spark-frost-bare-addon ^0.0.12`.
- `postinstall: wdk-worklet-bundler generate` produces `.wdk-bundle/wdk-worklet.bundle.js`. The docs say the file is gitignored, but it is committed in the repo.
- `wdk.config.js` defines networks bitcoin → `wdk-wallet-btc`, spark → `wdk-wallet-spark`, and ethereum/arbitrum/polygon → `wdk-wallet-evm-7702-gasless`. `preloadModules: ['@buildonspark/spark-frost-bare-addon']`.
- Useful docs: `docs/WDK_INTEGRATION.md`, `docs/ARCHITECTURE.md`, `docs/TROUBLESHOOTING.md`, `docs/SECURITY.md`.

Starter issues **not** to copy:

- **BTC network mismatch.** `src/wdk/networks.ts` `buildBitcoinConfig` uses `network: 'bitcoin'` (mainnet derivation, `bc1…`) with a testnet Blockbook URL. Its own comment flags this. Use `network: 'testnet'`.
- **Stale version pins in docs.** The docs pin `wdk-react-native-core` to beta.10 because "beta.12+ needs expo-crypto ^56". `package.json` actually uses beta.17, and beta.21/22 peer range is `expo-crypto >=55 <57`, so SDK 55 is fine. Treat the docs as stale.
- **Hosted docs lag.** The rendered page <https://docs.wdk.tether.io/examples-and-starters/react-native-starter> still says Expo 54 / RN 0.81.4.

There is also `tetherto/wdk-examples/react-native-showcase` (same stack: Expo 55, RN 0.83.6, bare-kit 0.14.5, core `^1.0.0-beta.17`; networks btc, spark, erc-4337, tron-gasfree). Its config is mainnet-oriented apart from a Tron Nile example.

### 2.3 Exact setup steps (for our app)

1. Start an Expo SDK 55 app (RN 0.83.x) with CNG/prebuild. `expo-crypto` is a hard peer of core, so a bare RN app would need `npx install-expo-modules` anyway.
2. Install with npm, pinning exactly:

   ```bash
   npm i @tetherto/wdk-react-native-core@1.0.0-beta.21 react-native-bare-kit@0.14.5 \
         react-native-nitro-modules react-native-mmkv react-native-keychain@^10 \
         @tetherto/wdk @tetherto/wdk-wallet-evm @tetherto/wdk-wallet-btc bare-node-runtime
   npx expo install expo-crypto expo-build-properties
   npm i -D @tetherto/wdk-worklet-bundler@1.0.0-beta.15
   ```

   beta.21 and bundler beta.15 are each more than two weeks old. beta.22 and bundler beta.16 are days old; take them only if needed.
3. In `app.json`, set `expo-build-properties` → `android.minSdkVersion: 29` (bare-kit requirement). iOS deployment target is 15.1+.
4. Create `wdk.config.js`:

   ```js
   module.exports = {
     networks: {
       ethereum: { package: '@tetherto/wdk-wallet-evm' },
       bitcoin:  { package: '@tetherto/wdk-wallet-btc' }
     },
     // recommended: restrict callable methods (prevents keyPair export over RPC)
     allowedMethods: {
       ethereum: { methods: ['getAddress','getBalance','quoteSendTransaction','sendTransaction','getTransactionReceipt','sign','verify'] },
       bitcoin:  { methods: ['getAddress','getBalance','quoteSendTransaction','sendTransaction','getTransfers','getMaxSpendable','getTransactionReceipt','sign','verify'] }
     }
   }
   ```

   Add `"postinstall": "wdk-worklet-bundler generate"`, then import `.wdk-bundle/wdk-worklet.bundle.js`. The path differs between the starter and the docs (`./.wdk`). Check the bundler output.
5. Wrap the root: `<WdkAppProvider bundle={{ bundle }} wdkConfigs={wdkConfigs}>`, where `wdkConfigs = { networks: { ethereum: { blockchain: 'ethereum', config: {...} }, bitcoin: { blockchain: 'bitcoin', config: {...} } } }`.
6. Run `npx expo prebuild --clean && npx expo run:ios` / `run:android`. Restart the app after a worklet start failure. There is no in-process recovery (documented).

Lower-level fallback if core or Expo conflicts with the Paykit binding: use `react-native-bare-kit`'s `Worklet` + `@tetherto/pear-wrk-wdk` (`HRPC` export) + the bundler output directly. This drops `expo-crypto`, mmkv, and keychain, and the app manages seed storage itself. It is more code, but it decouples from Expo.

### 2.4 Version tension with Paykit (flag for planning)

- The Paykit RN example (PR #204) is **RN 0.78.2 bare**, using `uniffi-bindgen-react-native 0.29.3-1`.
- WDK core needs `expo-crypto` 55 or 56, which implies **Expo SDK 55/56, so RN 0.83+**.
- The combined app must therefore run the Paykit ubrn TurboModule on RN 0.83. **Unverified.** It is probably fine because ubrn emits a standard C++ TurboModule, but it is the first thing to smoke-test.
- **JDK:** the starter says JDK 17 is required ("JDK 21/24 cause Android codegen failures… `PlatformConstants`"). This machine has JDK 21.0.11, so either install JDK 17 or verify that 21 works.

---

## 3. Per-chain testnet facts

Live probes on 2026-10-26: Sepolia publicnode RPC OK; Solana devnet RPC OK; Candide and Pimlico public bundlers OK; Plasma testnet RPC OK (chainId 9746); Base Sepolia OK; Blockstream testnet3 Electrum TLS OK; mempool.space testnet4 Electrum TLS OK; Blockscout Sepolia and mempool testnet4 REST OK. `tbtc1.trezor.io` returned a Cloudflare challenge page to curl.

| Chain / module | Testnets supported by module | Config the module takes | Public endpoint w/o key | Confirmation | Balance / history source | Funding |
|---|---|---|---|---|---|---|
| **EVM** `wdk-wallet-evm` | Any EVM chainId: Sepolia 11155111, Base Sepolia 84532, Plasma testnet 9746… | `{ provider: url \| url[] \| EIP-1193, chainId?, retries?, transactionMaxFee?, transferMaxFee? }` | `https://ethereum-sepolia-rpc.publicnode.com` ✅, `https://sepolia.drpc.org` (free tier caps batch size at 3, per wdk-examples) | ~12 s block; receipt within 1–2 blocks | `getBalance`/`getTokenBalance` via RPC. **No history method.** Use keyless Blockscout `https://eth-sepolia.blockscout.com/api/v2/addresses/{addr}/transactions` ✅. The Indexer covers Sepolia **USD₮ only**. | Sepolia ETH faucets usually need a login or a mainnet balance (Google Cloud Web3 faucet, Alchemy ≥0.001 ETH, PoW faucet) **(unverified current terms)**. Fund once, then the sims pass it back and forth. |
| **EVM ERC-4337** `wdk-wallet-evm-erc-4337` | Sepolia documented | `{ chainId, provider, bundlerUrl, paymasterUrl, paymasterAddress, safeModulesVersion:'0.3.0', paymasterToken:{address}, transferMaxFee }` or `isSponsored` | Candide `https://api.candide.dev/public/v3/11155111` ✅ (paymaster `0x8b1f6cb5d062aa2ce8d581942bbb960420d875ba`); Pimlico `https://public.pimlico.io/v2/11155111/rpc` ✅ (paymaster `0x7777…834C`) | Bundler + 1 block (~15–30 s, unverified) | Same as EVM. Indexer works for Sepolia USD₮ with a key. | Gas paid in test USD₮, so **no ETH needed**. Candide test USD₮ `0xd077A400968890Eacc75cdc901F0356c943e4fDb` (verified on-chain: symbol `USD₮`, 6 decimals). Faucets: <https://dashboard.candide.dev/faucet>, <https://dashboard.pimlico.io/test-erc20-faucet> (JS-rendered; login requirement unverified). The address is a counterfactual Safe, deployed on the first send. |
| **BTC** `wdk-wallet-btc` | `network: 'bitcoin' \| 'testnet' \| 'regtest'`. Signet is not listed. Testnet3 and testnet4 both use `'testnet'` params (`tb1`). | `{ network, bip: 84, client: {type:'electrum'\|'electrum-ws'\|'blockbook-http', clientConfig:{host,port,protocol:'tls'} \| {url}}, retries?, transactionMaxFee? }`. **The default is mainnet Electrum `electrum.blockstream.info:50001`, so always set both `network` and `client`.** | testnet4: `mempool.space:40002` TLS ✅ (tip 157675). testnet3: `electrum.blockstream.info:60002` TLS ✅. Blockbook `https://tbtc1.trezor.io/api` (testnet3) is used by the starter but Cloudflare-challenged to curl, and the starter hit HTTP 429. | testnet4 ~10 min, often erratic; testnet3 erratic. Electrum balance includes unconfirmed, so the receiver sees funds in seconds. Blockbook **excludes unconfirmed incoming**. | `getBalance` + built-in `getTransfers` (no key). Keyless REST fallback: `https://mempool.space/testnet4/api/address/{addr}` ✅. Indexer: mainnet `bitcoin` only. | testnet4 faucets exist but are often gated (coinfaucet.eu, mempool.space options; login requirements unverified). One manual top-up, then ping-pong. Fallback: local `regtest` (bitcoind + electrs on this Mac; iOS sim → `127.0.0.1`, Android emulator → `10.0.2.2`) gives unlimited funds and instant blocks. |
| **Spark** `wdk-wallet-spark` | `MAINNET`, `REGTEST` (Lightspark-hosted). `TESTNET` and `SIGNET` fall back to local endpoints, so they are effectively unusable. | `{ network:'REGTEST', syncAndRetry?, sparkscan?:{apiKey?}, enableLogging? }`. The SDK manages endpoints. | Built in (Lightspark regtest infra, for example `regtest-mempool.us-west-2.sparkinfra.net` in the SDK) | Spark→Spark transfers in seconds, no fee. Deposits need L1 regtest confirmations. | `getBalance`, `getTransfers` (no key). Optional SparkScan. | Lightspark regtest faucet <https://app.lightspark.com/regtest-faucet> sends to a `bcrt1p…` static deposit address, then `claimStaticDeposit`. Login requirement unverified. **Breez docs say regtest "doesn't have a developed Lightning Network"**, so Lightning invoices may not work on regtest (unverified). Spark invoices should. Addresses: `sparkrt1…` (regtest prefix `sparkrt`, verified in spark-sdk 0.10.0). |
| **Solana** `wdk-wallet-solana` | devnet, testnet | `{ provider: 'https://api.devnet.solana.com', commitment?, retries?, transactionMaxFee?, transferMaxFee? }` (`rpcUrl` is a deprecated alias) | `https://api.devnet.solana.com` ✅ (heavily rate-limited) | ~1–2 s (confirmed) | `getBalance`. **No history method.** Use `getSignaturesForAddress` via RPC yourself. | `requestAirdrop` RPC is free but often 429 **(unverified current limits)**. faucet.solana.com needs GitHub for more. Rent-exempt minimum ~0.00089 SOL matters for new accounts. |
| **TON** `wdk-wallet-ton` | testnet | `{ tonClient: { url:'https://testnet.toncenter.com/api/v2/jsonRPC', secretKey? }, transferMaxFee? }` | toncenter testnet, about 1 rps without a key (unverified) | ~5 s | `getBalance`. No history. Indexer is mainnet only. | Telegram bot `@testgiver_ton_bot` (unverified). The wallet contract deploys on the first outgoing message, which adds UX edge cases. |
| **Tron** `wdk-wallet-tron` | Nile, Shasta (any fullnode URL) | `{ provider: 'https://nile.trongrid.io' \| 'https://api.shasta.trongrid.io', transferMaxFee?, transactionMaxFee? }` | Nile/Shasta TronGrid without a key for light use (unverified) | ~3 s (solidified ~1 min) | `getBalance`. No history. | Nile faucet (nileex.io) (unverified). Account activation cost plus bandwidth/energy model; the gasfree module needs API key + secret. The starter put Tron "on hold". |

**WDK Indexer** (`https://wdk-api.tether.io/api/v1/chains`, live): ethereum (usdt, xaut, usat), arbitrum, avalanche, polygon, plasma, **sepolia (usdt only)**, tron, ton, **bitcoin (btc, mainnet `^[13]…` address regex, so not even bech32)**, spark (btc). A key is required for everything except `health`/`chains`; free registration at <https://wdk-api.tether.io/register>. It has no native-ETH history (token enum is `usdt | xaut | btc`). Timestamps are milliseconds (the starter found this out the hard way). **Conclusion: skip the indexer for this testnet demo.** At most, add it for Sepolia USD₮ if we use 4337.

---

## 4. Recommendation

### 4.1 Scoring (1 = best)

| Criterion | Sepolia ETH (`wallet-evm`) | BTC testnet (`wallet-btc`, Electrum) | Spark REGTEST | Sepolia USD₮ (`erc-4337`) | Solana devnet | TON testnet | Tron Nile |
|---|---|---|---|---|---|---|---|
| RN/Bare compatibility and deps | 1 (ethers + noble; standard Bare addons only) | 1 (bitcoinjs; Electrum over bare-tcp/tls) | 3 (Spark SDK + Rust FROST addon ~90 MB of prebuilds) | 2 (abstractionkit, Safe) | 2 (@solana v3) | 2 | 3 (tronweb is heavy) |
| No API key | ✅ | ✅ | ✅ | ✅ (public bundlers) | ✅ | ✅ (rate-limited) | ✅ (light) |
| Funding difficulty | Medium (one faucet top-up) | Medium–hard (testnet4 faucets gated) | Medium (faucet + claim deposit) | Medium (USD₮ faucet; no ETH needed) | Easy–medium (in-app airdrop when not rate-limited) | Medium (Telegram) | Hard |
| Confirmation speed for demo | 12 s | ~10 min to confirm, mempool in seconds | ~instant | ~15–30 s | ~1 s | ~5 s | ~3 s |
| Built-in history (no key) | ❌ (Blockscout, keyless) | ✅ `getTransfers` | ✅ `getTransfers` | ❌ | ❌ | ❌ | ❌ |
| Fit for Paykit endpoints | Good (`0x…` payload) | **Best**: Bitkit/Paykit heritage, `btc-bitcoin-p2wpkh`; per-contact private addresses via account index | Very good: `sparkrt1…` + invoices for payment requests | Good (Tether-branded USD₮) | OK | OK | OK |
| UX diversity vs BTC | High (account, gas in ETH) | — | Low (same asset, different rail) | High (stablecoin) | High | High | High |

### 4.2 Ranked picks

1. **Ethereum Sepolia, native ETH, `@tetherto/wdk-wallet-evm@1.0.0-beta.24`.** This is the **single best minimal-dependency chain**.
   - It is pure JS on top of the standard Bare runtime addons.
   - Config is one RPC URL with no key: `{ provider: 'https://ethereum-sepolia-rpc.publicnode.com', chainId: 11155111 }`.
   - Blocks are deterministic at 12 s, and `sendTransaction`/`quoteSendTransaction`/`getTransactionReceipt` cover the whole send flow.
   - Read history from keyless Blockscout, or from Paykit receipts plus local tx records.
2. **Bitcoin testnet4 on-chain, `@tetherto/wdk-wallet-btc@1.0.0-beta.17`.** Config: `{ network: 'testnet', bip: 84, client: { type: 'electrum', clientConfig: { host: 'mempool.space', port: 40002, protocol: 'tls' } } }`.
   - It covers UTXO and fee-rate UX, and it is the native rail for Paykit/Pubky (Bitkit).
   - History is built in.
   - Distinct `accountIndex` values give distinct addresses, which is a natural way to demo Paykit **private per-contact payment lists**.
   - Electrum shows unconfirmed incoming within seconds, so the cross-sim demo still feels live.
   - testnet3 alternative: `electrum.blockstream.info:60002`.

**Stretch third rail: Spark REGTEST.** This is the best "instant" experience: Spark address endpoint plus Spark sats invoices for Paykit payment requests and subscriptions. Add it only after the two chains above work, because:

- it brings the FROST native addon and `preloadModules`;
- it depends on Lightspark regtest uptime;
- Lightning on regtest is doubtful.

**Alternative #2 if BTC testnet funding blocks progress:** Solana devnet (fast, in-app airdrop) or Sepolia USD₮ via ERC-4337 + Candide (Tether-branded, but more moving parts). Another fallback is local BTC regtest.

**Avoid for this demo:** TON (contract deploy on first send, Telegram faucet) and Tron (activation, energy, and on hold in the starter).

### 4.3 Paykit-specific cautions (push-back)

- **Testnet-specific endpoint identifiers.** EVM addresses are identical across chains. If we publish a Sepolia address under a mainnet-looking identifier such as `usdt-ethereum-address`, a real Paykit wallet could send *real* funds to the demo key. Use explicit identifiers such as `eth-sepolia-address` and `btc-testnet4-p2wpkh`, or similar. `tb1…` payloads are self-protecting, but naming them clearly is still better.
- **Separate keys.** Do not derive the Pubky/Paykit identity key from the WDK BIP-39 seed with a homemade derivation. Keep separate secrets, or use a documented derivation if Paykit defines one. Rolling our own derivation is a crypto footgun, even in a demo.
- **Restrict callable methods.** Set `allowedMethods` in `wdk.config.js`. Without it, any account method (including key access) is callable over the RPC bridge.
- **Seeds.** Throwaway testnet seeds only. Even in a demo, never log mnemonics or key material. WDK itself redacts and memzeros, and the app should do the same.

---

## 5. Risks and mitigations

1. **`react-native-bare-kit` 0.16 dropped auto addon linking.** Pin `0.14.5` exactly (lockfile committed), or run `bare-link` manually in a postinstall.
2. **pnpm breaks bare-kit linking.** Use npm with a committed `package-lock.json` (npm ≥ 11.10.1 per the starter).
3. **RN version clash.** WDK core needs Expo 55/56 (RN 0.83+); the Paykit example is RN 0.78. Smoke-test the ubrn Paykit module on RN 0.83 first. The fallback is bare-kit + pear-wrk-wdk without Expo.
4. **JDK.** The starter warns against JDK 21; this machine has 21. Install JDK 17 if Android codegen fails with `PlatformConstants`/`TurboModuleRegistry` errors.
5. **Testnet funding is a human step.** Plan a one-time "treasury" top-up per chain, done by Jason in a browser, then sim-to-sim transfers. Add an in-app "show address/QR" screen early. Consider a local BTC regtest fallback.
6. **Public endpoint rate limits.** Trezor Blockbook returned 429 to the starter, and drpc caps batches. Use Electrum for BTC and publicnode for Sepolia, keep a failover list (`provider: [..]`, `client: [..]`), and cap polling with a react-query `staleTime` of about 15 s.
7. **Sepolia lifetime.** An Ethereum Magicians proposal discusses sunsetting Sepolia around 2027; it is live today. Keep the RPC/chainId in one config file so moving to Hoodi or another testnet is trivial.
8. **Beta churn.** Every WDK package is beta, and some releases are under two weeks old. Pin exact versions, as the starter does, and record them in docs.
9. **Worklet start failure is unrecoverable in-process.** Show a "restart app" error state, as the starter does.
10. **Large native footprint.** Expect about 350 MB in `node_modules` for bare-kit and a bundle of about 5–12 MB. Fine for sims; Spark adds more.

## 6. Open questions

- Does the Paykit ubrn TurboModule (ubrn 0.29.3-1) build and run on RN 0.83 / Expo 55 alongside `react-native-bare-kit`?
- Current login requirements of the testnet4 BTC, Sepolia ETH, Candide/Pimlico USD₮, and Lightspark regtest faucets. Jason may need to fund once.
- Does Spark REGTEST support Lightning invoice payment between two Spark wallets, or only Spark-native invoices?
- Does `wdk-wallet-btc` with `network:'testnet'` against testnet4 Electrum behave correctly end to end (fee estimation via `blockchain.estimatefee` on testnet4, spending unconfirmed change)? Unverified at runtime.
- Should the demo use Expo (CNG, matches the starter) or bare RN (matches the Paykit example)? WDK core effectively forces Expo modules.

## 7. Key file references (read-only clones under the scratchpad)

- `wdk/repos/wdk-starter-react-native/{package.json,wdk.config.js,.env.example,src/wdk/networks.ts,docs/WDK_INTEGRATION.md,docs/ENVIRONMENT.md}`
- `wdk/repos/wdk-react-native-core/src/{hooks/useAccount.ts,types/accountMethods.ts,provider/WdkAppProvider.tsx}`
- `wdk/tar/tetherto-pear-wrk-wdk-1.0.0-beta.15/package/src/handlers/execution.js` (`callMethod`, `allowedMethods`)
- `wdk/repos/wdk-worklet-bundler/README.md` (config reference, addon linking)
- `wdk/repos/wdk-wallet-btc/src/{wallet-manager-btc.js,wallet-account-btc.js,wallet-account-read-only-btc.js}`
- `wdk/repos/wdk-docs/content/docs/start-building/react-native-quickstart.mdx`, `.../sdk/wallet-modules/*/configuration.mdx`, `skills/wdk/references/chains.md`
- `holepunchto/react-native-bare-kit` tag `v0.14.5`: `react-native-bare-kit.podspec` (`prepare_command "node ios/link.mjs"`), `android/build.gradle` (`preBuild.dependsOn link`)

Sources: <https://docs.wdk.tether.io>, <https://github.com/tetherto>, <https://github.com/holepunchto/react-native-bare-kit>, <https://wdk-api.tether.io/api/v1/chains>, <https://docs.spark.money/wallet/testing-guide>, <https://sdk-doc-spark.breez.technology/guide/testing.html>, <https://ethereum-magicians.org/t/sepolia-testnet-replacement-sunsetting/28647>.
