# 06 - Completeness critic: contradictions, verified claims, and plan gaps

Research date: 2026-10-26. Read-only review of reports 01 to 05 in this folder, plus spot checks against
code and live endpoints. "Verified" means I checked it myself today with the command or file named.
"Unverified" means nobody has proven it yet.

Sources used for the checks:

- Paykit: the read-only clone at
  `/private/tmp/claude-501/-Users-jason-Documents-Repositories/008626ab-f4cf-47ae-baa1-9f7a347c4ea6/scratchpad/ref/paykit-rs`
  (`$PK`), at commit `23c702c8`.
- WDK: the researchers' clones under `.../scratchpad/wdk/repos/`.
- npm registry tarballs, unpacked into new `critic-*` scratch folders.
- `pkarr-8.1.0` in `~/.cargo/registry`.
- `gh api`.
- Live probes from this Mac.

---

## 0. TL;DR - what the plan must decide differently from the reports

1. **The app must be Expo SDK 55 / RN 0.83, not RN 0.78.2.** `@tetherto/wdk-react-native-core`
   peer-requires `expo-crypto >=55 <57`, and `expo-crypto@55` peer-requires the `expo` 55 package (RN
   0.83 line). Core uses expo-crypto only for SHA-256 (`src/utils/mmkvKeyManager.ts`,
   `src/storage/secureStorage.ts`). The Paykit package therefore has to run on RN 0.83, which nobody has
   tested yet. The evidence says this is likely fine (section 2.1). This is the first spike.
2. **The API 28 emulator fallback in reports 01 and 04 is impossible.** `react-native-bare-kit@0.14.5`
   sets `minSdk 29` (verified in `android/build.gradle` at tag v0.14.5). The only AVD image on this Mac
   that can run the app is API 36. That is the image with the pkarr-relay OCSP issue. If the issue
   blocks us, install an API 35 image (`sdkmanager "system-images;android-35;google_apis;arm64-v8a"`).
3. **The Android OCSP issue degrades the app but should not block it (verified in pkarr source).**
   pkarr 8.1.0's combined backend publishes to relays and the DHT with `tokio::join!`. Publish succeeds
   if either side succeeds (`publish_result_accumulator.rs`). Resolve takes the first acceptable answer
   from either side (`combined.rs` `first_acceptable_or_wait_second`). On API 36, Android therefore falls
   back to DHT-only. The PR's `android_https` step still failed. That step is a single fresh-handle
   `paykitAppRegistry(a.publicKey)` resolve, so **DHT-only resolution from the emulator is unproven**.
   The spike must test "Android resolves an identity that iOS published".
4. **Per-contact rotating addresses would fragment the wallet.** In WDK BTC, account `i` is exactly one
   address (`m/84'/1'/0'/0/i`), and it spends only that address's UTXOs
   (`wallet-manager-btc.js getAccount`, `listUnspent(address)`). In WDK EVM, each index is a separate
   EOA that needs its own gas. Report 02's headline demo ("fresh WDK address per contact per chain",
   with rotation through `afterPrivatePaymentListVersion`) would scatter funds across accounts that
   cannot be spent together. Section 4.1 gives a workable design.
5. **The chain and identifier recommendations conflict across reports.** Recommended resolution
   (section 3):
   - **Ethereum Sepolia**: Aave test USDT as the main asset, plus a little ETH for gas.
   - **Bitcoin Mutinynet**: signet with 30 s blocks, Electrum over TCP 50001.
   - Identifiers with an explicit test-network rail: `usdt-sepolia-address`, `eth-sepolia-address`,
     `btc-mutinynet-p2wpkh`.
   - Never use the mainnet-looking `btc-bitcoin-p2wpkh` or `usdt-ethereum-address` that report 04
     suggests.
6. **Funding needs two one-time human steps from Jason.** Everything after them is scriptable.
   - Get about 0.05 Sepolia ETH into a treasury key (faucet with login), or create a CDP API key.
   - Do one GitHub device login for the Mutinynet faucet.
   - The plan should ask for both in one message, early, without blocking non-funding work.
7. **Staging signup needs two invite codes**, one for each simulator identity. Mint them with
   `/synonym-skills:pubky-staging-invite` when Jason approves. Homegate per-IP limits are unknown and
   both simulators share one IP. Persist the mnemonics, so that reinstalls sign in instead of signing
   up again.

---

## 1. Contradictions between reports, and the resolution

| # | Topic | What the reports say | Resolution (with evidence) |
|---|---|---|---|
| C1 | RN version | 01: pin **RN 0.78.2** (the example's versions). 03: WDK core forces **Expo 55 / RN 0.83**. | **RN 0.83 / Expo 55.** Verified with npm: core beta.21 peers are `expo-crypto >=55 <57`, `react-native-bare-kit >=0.14.5`, `react-native >=0.70`. `expo-crypto@55.x` peers `expo: *`, and Expo SDK 55 is the RN 0.83 line. The Paykit README explicitly supports Expo dev builds (`$PK/paykit-react-native/README.md:35-39`, "npx expo prebuild ... with the New Architecture enabled"). The alternative, bare RN 0.78 with raw `react-native-bare-kit` + `@tetherto/pear-wrk-wdk` and no core, is more code and less "reference-like" for WDK. Keep it only as a fallback. |
| C2 | Android fallback image | 01 and 04: try API 28 if API 36 OCSP hurts. | **Impossible.** bare-kit 0.14.5 `minSdk 29` (verified). Use API 36. If needed, add an API 35 image. Existing AVD `PaykitRN_rnb_api36` is usable. |
| C3 | JDK | 03: "This machine has JDK 21; install Temurin 17." 01: openjdk@17 is installed. | **01 is right.** Verified: `/opt/homebrew/opt/openjdk@17` exists (21 and 26 too). `/usr/libexec/java_home` finds none of them, so set `JAVA_HOME=/opt/homebrew/opt/openjdk@17` explicitly in build scripts. |
| C4 | Pubky key from the WDK mnemonic | 03: "Do not derive ... homemade derivation is a footgun; keep separate secrets." 01: separate random key is cleaner. 02 and 05: use `pubkySecretKeyFromBip39Mnemonic` (Bitkit and Ring do). | **Use Paykit's own `pubkySecretKeyFromBip39Mnemonic` on the WDK mnemonic.** It is not homemade. It is Paykit's exported function and documented convention (`$PK/paykit-sdk/src/identity.rs:149-185`, verified: first 32 bytes of the BIP39 seed, empty passphrase, seed zeroized). 03's push-back is right that this is not domain-separated. The README must say so and must say "testnet demo only". WDK core exposes `generateMnemonic()`, `restoreWallet(mnemonic, walletId)` and `getMnemonic(walletId)` (`useWalletManager.ts:57-114`, verified), so the app can hold one mnemonic and feed both libraries. |
| C5 | BTC network | 03: **testnet4** via `mempool.space:40002` TLS. 04: **Mutinynet** via `electrum.mutinynet.com:50001` TCP. | **Mutinynet** for the demo, with testnet4 as a config switch. Reasons: 30 s blocks versus about 10 min of erratic testnet4 blocks, and an API faucet (GitHub JWT) versus captcha-gated testnet4 faucets. The cost is plaintext Electrum, because the 50002 certificate has expired (both verified live today). Both servers answered `server.version` today. Keep host, port, protocol and network in one config module. |
| C6 | EVM asset | 03: Sepolia **native ETH** (simplest). 04: Sepolia **USDT** (Aave faucet, permissionless mint) plus ETH gas. 02: `usdt-sepolia-address`. | **Both on Sepolia, with USDT as the hero asset.** WDK is a Tether product, and USDT makes the USD-priced conversion demo meaningful. ETH is needed for gas anyway, so expose it as a second EVM asset. Use Aave USDT `0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0` (6 decimals), not Candide's owner-mint `0xd077...` (04 verified). The UX still shows **two chains**: Bitcoin and Ethereum. |
| C7 | Endpoint identifiers | 01: `btc-testnet-p2wpkh`, `eth-sepolia-address`. 02: `btc-testnet4-p2wpkh`, `usdt-sepolia-address`. 03: `eth-sepolia-address`, `btc-testnet4-p2wpkh`. **04: `btc-bitcoin-p2wpkh`, `usdt-ethereum-address`** (mainnet-looking). 05: Bitkit fixture `btc-regtest-p2wpkh`. | Use `btc-mutinynet-p2wpkh`, `usdt-sepolia-address`, `eth-sepolia-address`. Verified valid: validation is ASCII alphanumeric plus `-_.`, ≤64 characters, not `private` (`$PK/paykit-lib/src/payment_endpoint.rs:46-75`). Conversion needs exactly three lowercase alphanumeric segments `asset-rail-format` (`$PK/paykit-lib/src/payment_request/conversion.rs:311-326`), and these pass. Rate selectors `usdt`, `btc`, `eth` (or `usdt-sepolia`) work. Reject 04's mainnet ids: a Sepolia `0x` address published as `usdt-ethereum-address` could attract real mainnet USDT from a real Paykit wallet (03's point). EVM payload: `{"value":"0x..","chain_id":"11155111","token":"0xaA8E..."}` (omit `token` for ETH). |
| C8 | Shared-state storage on staging | 02: needs 0.16.2 + GCS, "unverified for staging". 05: staging config is `google_bucket` (GCS). | **05 is right**, so shared state is possible on staging. Still choose the **callback blob store on encrypted MMKV**: it is faster, and shared state was reported slow on staging. WDK core already brings `react-native-mmkv@^4.3.1` + `react-native-nitro-modules` + `react-native-keychain@^10`, so there are no new native dependencies. |
| C9 | fmt C++17 Podfile hack | 01 and 05: required (RN 0.78 + Xcode 26). | **Probably unnecessary on RN 0.83.** RN 0.83.6 pins `fmt` **12.1.0** (verified in `third-party-podspecs/fmt.podspec`). The hack is for fmt 11.0.2. Keep it only if the build fails. |
| C10 | Poll cadence | 01: 3-5 s. 02: 3 s (1 s on flow screens). 05: Bitkit 10 s inbox / 60 s maintenance; polar-paykit 2 s. | One single-flight loop: **3 s while foregrounded**, plus an immediate `processOutboundPrivateMessages(peer)` after each user action. Add a "Sync now" button. Keep staging `POST /session` (20/min/IP) out of the loop entirely. |
| C11 | Deep link scheme / App ID / client ID | 02: `wdkpaykit://contact/<pubky>`, app id `wdk-paykit-demo`. 05: `paykitwdk://contact?pubky=<key>`, `wdk-wallet`, `com.jasonvdb.paykitwdkwallet`. | Pick one and freeze it in Phase 0. Suggested: scheme `paykitwdk://contact?pubky=<key>` (mirrors Bitkit's strict format), Paykit App ID `wdk-paykit-demo`, Pubky client ID `com.jasonvdb.paykitwdkwallet`. The client ID must never change once grants exist. |
| C12 | Spark | 03: stretch third rail. 04: avoid (web-only faucet, no Lightning on regtest). | **Out of scope.** It adds about 90 MB of FROST prebuilds, a `preloadModules` entry and a human-only faucet, and gives no BOLT11 demo. |
| C13 | Electrum fee estimation risk | 04: an estimate of `-1` on a quiet signet is unverified. | **Handled by WDK** (verified): `_buildSignedTransaction` sets `feeRate = max(feeEstimate * 100_000, 1)`, so `-1` becomes 1 sat/vB (`wallet-account-btc.js:621-626`). |
| C14 | WDK EIP-712 signing for the ERC-20 proof profile | 02: unverified. | **Exists**: `WalletAccountEvm.signTypedData({domain, types, message})` (`wdk-wallet-evm/src/wallet-account-evm.js:192`). `getTransactionReceipt` is also there for the log index, so the `erc20-transfer-eip712` proof profile is buildable. |

---

## 2. Decision-critical claims I verified (or narrowed)

### 2.1 Paykit ubrn 0.29.3-1 module on RN 0.83 (unverified overall, but no blocker found)

- `com.facebook.react.TurboReactPackage` still exists in RN 0.83.6, deprecated and aliased to
  `BaseReactPackage` (verified in the npm tarball, `ReactAndroid/.../TurboReactPackage.kt`). The generated
  Kotlin compiles with a deprecation warning only.
- The package CMake sniffs `ReactAndroid_VERSION_MINOR GREATER_EQUAL 76` and links the merged
  `ReactAndroid::reactnative`. 83 passes (`$PK/paykit-react-native/android/CMakeLists.txt:54`).
- ubrn release notes from 0.30.0-1 to 0.31.0-6 mention no RN-version-specific fixes that 0.29.3-1 lacks
  (checked with `gh api .../releases`). Do not upgrade ubrn: 0.30+ moves to UniFFI 0.30/0.31 and changes
  generated names.
- The library's Gradle `buildscript` pins `kotlin-gradle-plugin:$kotlin_version` from the root `ext`. Expo
  55 prebuild sets its own Kotlin version. Whether that clashes is **unverified**. Watch the first build.
- iOS: podspec uses `install_modules_dependencies(s)`, fine on 0.83. Whether RN 0.83 or Expo 55
  prebuilt-core options (`RCT_USE_PREBUILT_RNCORE`) interact badly with a source C++ TurboModule is
  **unverified**. Keep prebuilt core off if linking fails.
- Hermes: ubrn is JSI-only, and RN 0.83 ships Hermes (`hermes-compiler 0.14.1`). Fine.

### 2.2 WDK does not run in Hermes (verified)

`wdk-wallet-btc/bare.js` does `import 'bare-node-runtime/global'` and re-exports with
`imports: 'bare-node-runtime/imports'`. WDK code runs in a Bare worklet thread inside
`react-native-bare-kit`, not in Hermes. Paykit's synchronous callbacks run on the Hermes JS thread, so
the two runtimes do not contend. But **every WDK call from a Paykit callback is impossible** (they are
async IPC). The cache design in 01 and 02 is mandatory.

### 2.3 Electrum inside the worklet (narrowed; still needs a runtime spike)

`bare-node-runtime@1.5.2` `imports.json` maps `net → bare-net` and `tls → bare-tls` (verified).
`@mempool/electrum-client@1.1.9` (used by `ElectrumTcp`/`ElectrumTls`) should therefore work in Bare,
provided the worklet bundler links the `bare-tcp`/`bare-tls` addons. The starter bundle lists them. No
public WDK example uses Electrum in RN (all use Blockbook), so **spike it**. Fallback: testnet4 via
Trezor Blockbook `tbtc4.trezor.io` (HTTP; verified in sync by 04).

### 2.4 Android API 36 TLS (narrowed)

- Only the pkarr **relay** HTTPS client uses the platform verifier (01 traced this). Homeserver
  traffic uses raw-public-key TLS.
- pkarr 8.1.0 combined backend (verified in source):
  - publish: `tokio::join!(relay, dht)`. The accumulator returns Ok if any backend stored the packet.
  - resolve: first acceptable result, otherwise wait for the other.
  - So relay failure should be survivable.
- Unexplained: the PR's own API 36 `android_https` step (fresh handle, resolve A) **failed**. That is
  exactly what the Android app does when it first resolves the iOS user. **Highest-priority staging
  spike**: iOS signs up and publishes; Android (fresh install) runs `paykitAppRegistry(iosPubky)` and
  `ensureLinkWithPeer`.
- If the spike fails, options are:
  1. API 35 image (unverified whether it has the same verifier behaviour).
  2. Retry with longer timeouts (DHT lookups can take tens of seconds).
  3. A local pubky-testnet with `adb reverse` (05, A8). This abandons staging for the Android side,
     so it is a last resort.

### 2.5 Staging reachability (verified today from this Mac)

- `https://homeserver.staging.pubky.app/` → 200.
- `https://pkarr.pubky.app/ufibw...` → 200.
- TCP `34.65.231.81:6287` → open.

### 2.6 Testnet endpoints (verified today)

- `electrum.mutinynet.com:50001` TCP → `mempool-electrs 3.3.0`.
- `electrum.mutinynet.com:50002` TLS → `CERTIFICATE_VERIFY_FAILED: certificate has expired`.
- `mempool.space:40002` TLS (testnet4) → `mempool-electrs 3.4.0-dev`.

### 2.7 WDK keychain on simulators (verified)

Core stores secrets with `Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY` and no biometric access
control (`secureStorage.ts:242`). Unattended simulator runs will not hit a biometric prompt.

### 2.8 WDK EVM can call the Aave faucet in-app (verified)

`EvmTransaction` has `data` (`wallet-account-read-only-evm.js:63-75`). Through core this goes via
`useAccount().extension().sendTransaction({ to: FAUCET, value: 0, data })`, because `send()` only takes
`{to, asset, amount}`. `allowedMethods` in `wdk.config.js` must include `sendTransaction`. A "Get test
USDT" button is feasible once the account holds a little ETH.

### 2.9 Expo config can carry most native tweaks (verified)

`expo-build-properties@55.0.18` supports:

- `android.buildArchs`: use `["arm64-v8a"]`, which satisfies Paykit's `checkPaykitNativeArtifacts`.
- `android.minSdkVersion: 29`.
- `ios.deploymentTarget`.

The iOS `EXCLUDED_ARCHS[sdk=iphonesimulator*]=x86_64` post_install still needs a small local Expo
config plugin. Without it, any simulator build with `ONLY_ACTIVE_ARCH=NO` (Release) fails with
`ld: library 'paykit' not found`.

---

## 3. Recommended chain, asset and funding decision (consolidated)

| Chain (UX) | WDK module | Config | Assets | Paykit identifier | Funding |
|---|---|---|---|---|---|
| Ethereum Sepolia | `@tetherto/wdk-wallet-evm` (pin exact, beta.24) | `{ provider: ['https://ethereum-sepolia-rpc.publicnode.com', <fallback>], chainId: 11155111, transferMaxFee }` | USDT (Aave mock, 6 dp), ETH (gas) | `usdt-sepolia-address`, `eth-sepolia-address` | Human: about 0.05 ETH once into the treasury. Script: Aave `mint(USDT, app, 1000e6)` (permissionless, verified by 04), plus 0.001 ETH per app. |
| Bitcoin Mutinynet | `@tetherto/wdk-wallet-btc` (pin exact, beta.17) | `{ network: 'testnet', bip: 84, client: { type: 'electrum', clientConfig: { host: 'electrum.mutinynet.com', port: 50001, protocol: 'tcp' } } }` | BTC (sats) | `btc-mutinynet-p2wpkh` | Human: one GitHub device login (`mutinynet-cli login`). Script: `POST /api/onchain` ≤1M sats/day. |

Notes:

- Signet and Mutinynet use testnet address params (`tb1`, `m/84'/1'`), so WDK `network: 'testnet'` is
  right.
- Explorer links: `https://mutinynet.com/tx/<txid>` and `https://eth-sepolia.blockscout.com/tx/<hash>`.
- WDK's Indexer is not used. EVM history comes from Blockscout (keyless) plus the app's own transaction
  log plus Paykit receipts. BTC history comes from `getTransfers`.
- The local regtest + Anvil fallback from 04 should be **documented, not built**, unless public funding
  fails.

---

## 4. Gaps the plan must cover (nobody fully addressed these)

### 4.1 Wallet account model versus Paykit private lists (new finding)

- WDK BTC: one address per account index, and spends only from that address. WDK EVM: one EOA per
  index, and each needs its own gas.
- Recommended v1 model:
  - **Spending account** = index 0 on each chain. It is used for all sends and is the public endpoint
    (`syncPublicEndpointsWithReceivingDetails`).
  - **Private list per contact**:
    - BTC gets a **stable dedicated account index per contact** (index = 1 + contact ordinal, persisted
      in MMKV), so incoming BTC is attributable to that contact.
    - EVM (USDT/ETH) shares index 0. EVM attribution comes from Payment Request + proof, which is
      Bitkit's USDT model (05, B3).
  - Add a **"Consolidate"** action that sweeps BTC contact accounts to index 0. On Mutinynet the fee is
    negligible.
  - Show the total balance as a sum, with a per-contact breakdown.
- Rotation (`afterPrivatePaymentListVersion` → `WaitingForUpdatedPaymentList`) is a stretch demo for BTC
  only. It needs a new account index per payment, which makes fragmentation worse.

### 4.2 Persistence on device (spread across reports; consolidated)

| Data | Store | Notes |
|---|---|---|
| Mnemonic (shared WDK + Pubky) | WDK core's keychain storage (`restoreWallet`/`getMnemonic`) | Do not duplicate it in a second store. Derive the Pubky key at boot. |
| Pubky session secret (`exportSessionSecret()`) | `react-native-keychain` | Boot: `importSession` → on failure `signIn` → persist the new secret. |
| Paykit state blob + revision | MMKV v4 instance `paykit-state`, `encryptionKey` from Keychain (loaded **before** constructing the SDK, because Keychain reads are async) | One value = `encodeSdkStateBlobSnapshot`. Exclude it from iCloud and Android auto-backup (02 §8). The MMKV v4 API name (`createMMKV`) needs checking against the installed version. |
| Contact → BTC account index, consumed list versions, local tx log, receipt-id drafts | MMKV (same or a second instance) | Small JSON. |
| Signup code | Never persisted | Single-use. |

### 4.3 Identity, names and profile display

Reports 02 and 05 cover the APIs (`publishPaykitProfile`, `resolveProfile(pk, true)`,
`uploadProfileAvatar`). The plan needs:

- an onboarding "Display name" field, with an optional avatar from the simulator photo library;
- a contact row showing name, truncated `pubky…`, and a link badge (`FfiLinkedPeerState`);
- a 10-minute profile cache, as Bitkit does;
- name fallback: label → Paykit profile → pubky.app profile → truncated key.

### 4.4 QR codes and deep links

- Neither simulator can scan a QR from the other simulator's screen. Render a QR
  (`react-native-qrcode-svg`) for realism, but the **working paths are copy/paste and deep links**.
- Paste: the iOS Simulator and Android emulator both sync with the macOS clipboard.
- Deep links: register the scheme in `app.json`, then:
  - `xcrun simctl openurl booted 'paykitwdk://contact?pubky=<k>'`
  - `adb shell am start -a android.intent.action.VIEW -d '...'`
- A camera scanner (`expo-camera`) is optional. Leave it out of v1.

### 4.5 Notifications and liveness

- Paykit has no push. The plan should state that the demo works **only with both apps foregrounded**.
- Use in-app toasts and auto-present incoming requests (Bitkit pattern, 05 B3).
- Local OS notifications (`expo-notifications`) add little on simulators. Skip them.
- On every foreground: `republishIdentity` (5 s cap) → loop.

### 4.6 Settlement verification before receipts

- The payee must verify on chain before `issueReceipt`. Paykit never does this.
- BTC: `getTransaction(txid)` → output to the payee's address ≥ amount.
- EVM: `getTransactionReceipt(hash)` → `Transfer` log to the payee for the token contract.
- Both methods exist in WDK (verified method lists) and must be in `allowedMethods`.
- Amount conversion helpers are needed: Paykit decimal strings ↔ WDK bigint base units (sats, 6 dp
  USDT, 18 dp ETH).

### 4.7 iOS ↔ Android interop specifics

- Both apps use the same staging homeserver and the same app/client IDs. Only the mnemonic differs.
- Android ↔ iOS link establishment depends on 2.4. Test it before any UI work.
- Metro: one dev server can serve both (`adb reverse tcp:8081 tcp:8081`). For the final demo, prefer
  **release builds** (no Metro, less memory). A release build reintroduces the x86_64 iOS link issue
  unless the config plugin from 2.9 is in place.

### 4.8 Build pipeline and time budget

1. Paykit native build (reports 01 and 02): about 5-10 min iOS sim-only and 5-8 min Android arm64 on
   this Mac (unverified), plus the first `ubrn` CLI compile. Cargo target is about 5-10 GB.
2. App: `npm ci`:
   - bare-kit unpacks about 353 MB;
   - the worklet bundle is generated in `postinstall`;
   - `npx expo prebuild --clean`, then `pod install` (bare-kit's `prepare_command` runs `bare-link`).
3. Xcode build about 10 min, Gradle about 10 min (estimates).
4. **Use npm, not pnpm** (bare-kit `link.mjs` resolves `../../..` and reads `../../package-lock.json`).
   This overrides the machine's pnpm-first habit.
5. Host: 16 GiB RAM (verified `hw.memsize`), 64 GiB free disk (verified). Serialize the Rust, Xcode
   and Gradle builds. Shut the emulator down during builds.
6. Android packaging: Paykit's AAR excludes `libc++_shared.so` and others. bare-kit also ships native
   libraries. A `pickFirst` for duplicate `.so` files may be needed (**unverified**).

### 4.9 Things nobody mentioned

- **Android `minSdk` 29** (from bare-kit) must be set app-wide. Paykit's default is 24.
- **Metro hot reload with live Rust handles**: 01 flags it as unverified. Plan for full reloads to
  rebuild the SDK handle, and guard against two handles restoring the same grant (05 A4).
- **Concurrency between WDK and Paykit**: none on the JS thread. Still serialize Paykit SDK calls in one
  JS queue (UI before poll).
- **`allowedMethods`** in `wdk.config.js` must list every method the app uses:
  - shared: `getAddress`, `getBalance`, `quoteSendTransaction`, `sendTransaction`,
    `getTransactionReceipt`, `sign`, `verify`;
  - EVM: `getTokenBalance`, `transfer`, `quoteTransfer`, `signTypedData`;
  - BTC: `getTransfers`, `getTransaction`, `getMaxSpendable`.
- **Reinstall story**: fresh random mnemonics plus a "Restore from phrase" screen, so a reinstall signs
  in without a new code. A dev launch argument that injects a mnemonic is a secret-handling footgun.
  If used, read it from a git-ignored `.env.demo` and never log it.
- **Message size**: two EVM payloads plus one BTC payload is about 250-300 bytes of endpoint JSON, which
  should fit 1000 bytes with the envelope (**unverified**). Measure it in the spike. A request with
  `paymentEndpoints` + metadata + conversion rates is the likeliest to overflow.

---

## 5. Suggested Phase 0 spike (before any UI), in order

1. Clone paykit-rs @ `23c702c8` into a gitignored `.paykit-build/`. Build sim-only + arm64-v8a.
   `npm pack`.
2. Create an Expo 55 app (npm) with the following, configured with `buildArchs: ['arm64-v8a']`,
   `minSdkVersion: 29` and the EXCLUDED_ARCHS config plugin:
   - Paykit tarball;
   - `@tetherto/wdk-react-native-core@1.0.0-beta.21`;
   - `react-native-bare-kit@0.14.5` (exact);
   - `@tetherto/wdk-worklet-bundler@1.0.0-beta.15`;
   - wallet-evm and wallet-btc;
   - expo-crypto and expo-build-properties.
3. On both simulators:
   - Paykit `defaultConfig()` sync call;
   - WDK `generateMnemonic` → `restoreWallet` → `getAddress` for Sepolia and Mutinynet;
   - `getBalance` over Electrum TCP.
4. Staging, cross-device: iOS `signUp` (code 1) → publish Noise key + app. Android `signUp` (code 2)
   → `paykitAppRegistry(iosPubky)` → both `ensureLinkWithPeer` until `Linked`. This decides between API
   36 and the fallbacks.
5. Ask Jason for the funding steps in parallel with steps 2-4.

## 6. Open questions for Jason

- Approve minting two staging invite codes now (one per simulator)?
- Will you do the one-time Sepolia ETH faucet (or CDP key) and the Mutinynet GitHub device login?
  Does Synonym already have a funded Sepolia key?
- OK with Expo SDK 55 / RN 0.83, given that WDK's RN core forces it and Paykit's example is RN 0.78?
- OK with one shared mnemonic for WDK + Pubky (Bitkit convention, documented as testnet-only)?
- OK to install an API 35 emulator image (about 1.5 GB) if API 36 cannot resolve peers over the DHT?
