# Plan

This document records the decisions and phases for the example wallet. The
research behind each decision is in [`research/`](research/).

## Goal

Build a React Native wallet that runs twice on one Mac: once on an iOS
simulator and once on an Android emulator. The two wallets add each other as
Paykit contacts and send each other testnet money in both directions. Along the
way they demo as many Paykit features as possible.

This is a reference app, not production software. It favors code that is easy
to read over code that is hardened.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| App framework | Expo SDK 55 (React Native 0.83), dev build (`expo prebuild`), New Architecture, Hermes. npm with a committed lockfile. | WDK's React Native core needs `expo-crypto` 55+. Paykit's package supports Expo dev builds. `react-native-bare-kit` breaks under pnpm. |
| WDK integration | `@tetherto/wdk-react-native-core`, `@tetherto/wdk-worklet-bundler`, `react-native-bare-kit@0.14.5` (exact). | WDK runs in a Bare worklet, not in Hermes. bare-kit 0.16 dropped native addon auto-linking. |
| Paykit package | `@synonymdev/react-native-paykit` built from paykit-rs PR #204 at `23c702c8`. See `scripts/build-paykit.sh`. | Not on npm yet. Builds must come from a pinned upstream commit, not a local checkout. |
| Chain 1 | **USD₮ on Ethereum Sepolia** (`@tetherto/wdk-wallet-evm`). The token is Aave's test USDT `0xaA8E…33D0`, mintable by anyone through the Aave faucet. ETH pays gas. | WDK is Tether's kit, so the stablecoin is the hero asset. Sepolia has 12 s blocks, a keyless RPC and near-zero gas. |
| Chain 2 | **Bitcoin on Mutinynet** (signet, 30 s blocks), `@tetherto/wdk-wallet-btc` over Electrum TCP `electrum.mutinynet.com:50001`. | UTXO model and `tb1` addresses give a different UX from the EVM account. 30 s blocks keep the demo moving. Fallback: testnet4 over Electrum TLS. |
| Paykit rail ids | `usdt-sepolia-address`, `btc-mutinynet-p2wpkh`. | Testnet-explicit ids, so nobody mistakes them for mainnet endpoints. Valid under Paykit's id and conversion-rate rules. |
| Pubky homeserver | Staging, `ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy`. Signup codes come from the `pubky-staging-invite` skill. | Shared infrastructure, no local stack to run. Local `pubky-testnet` is the fallback. |
| Identity | One BIP-39 mnemonic per wallet. WDK derives the chain keys. Paykit's `pubkySecretKeyFromBip39Mnemonic` derives the Pubky key. | This is the convention Bitkit and Pubky Ring use: one backup phrase. Documented as testnet-only, because the keys are not domain-separated. |
| Paykit state | Callback blob store on encrypted MMKV, with the key in the Keychain/Keystore. | Paykit callbacks are synchronous, so AsyncStorage can't work. Shared-state mode is reported to be slow on staging. |
| Session | Persist the exported session secret. On launch, `importSession`, then fall back to `signIn`. | Staging limits `POST /session` to 20 per minute per IP, and both simulators share one IP. |
| Addresses | EVM: account 0 for everything. BTC: account 0 is the public address. Each contact gets its own stable BTC account index for private payment lists. A "collect" sweep moves BTC back to account 0. | A WDK BTC account is one address. Per-contact addresses show what private payment lists are for. |
| Sync | One serialized Paykit call queue. A foreground poll every 3 s, plus an immediate outbound flush after each user action. | Paykit delivery is pull-based, and the sync callbacks must never overlap. |
| Funding | A treasury key per chain in the gitignored `.env.demo`. A human tops it up once: Sepolia ETH, and a Mutinynet GitHub device login. Scripts then fund the wallets: Aave USDT mint and the Mutinynet faucet API. | Every public faucet needs a human at least once. Local regtest and Anvil are documented as a fallback. |
| App ids | Paykit app id `wdk-paykit-demo`. Pubky client id `com.jasonvdb.paykitwdkwallet` (never changes). Deep link `paykitwdk://contact?pubky=<key>`. | Grants are bound to the client id. |

## Features to demo

**WDK**
- Create or restore a wallet from a mnemonic.
- BTC and USD₮ balances. ETH shown as gas.
- Receive (address + QR) and on-chain send with a fee quote.
- Transaction history.
- A "Get test USD₮" faucet button.

**Paykit**
- Pubky identity signup on staging. Paykit app registry and Noise key authorization.
- Profile: display name and avatar.
- Public payment endpoints: publish your BTC and USD₮ addresses, and pay anyone by pubky.
- Contacts: add by pubky (paste, QR or deep link), see their profile, and follow the Encrypted Link handshake to "Linked".
- Private payment lists: per-contact addresses, synced automatically.
- Pay a contact through their private endpoints.
- Payment requests: request, inbox, accept and pay, proof, verification and receipt.
- Recurring payment requests (per-minute billing for the demo).
- Receipts in the activity feed.
- Stretch: allowances, block or forget a peer, backup and restore, key rotation.

## Phases

Each phase ends with commits pushed to `main` and a check on both simulators
where it applies. Phases 2 to 5 run one after another: several screens
(Send, Receive, Activity detail, You) carry work for more than one phase
(see "Files that several phases edit" in [`ARCHITECTURE.md`](ARCHITECTURE.md)). Device builds run one at a time: this Mac has crashed under a
simulator, an emulator, Xcode and Gradle all at once.

0. **Spike.** Expo app with both native stacks on both simulators. WDK
   generates a mnemonic and reads Mutinynet and Sepolia balances. Paykit signs
   up on staging, publishes, and the Android app resolves the iOS identity.
   This de-risks the version mix, Electrum TCP in the worklet, and pkarr
   resolution on Android API 36.
1. **Foundation.** Project structure, design system, navigation, the wallet
   service (WDK), the Paykit service (storage, session, payment adapter with a
   synchronous address cache, call queue, poll loop).
2. **Wallet.** Onboarding (create or restore), home balances, receive, send,
   history, faucet button and treasury funding scripts.
3. **Identity and public payments.** Profile, public endpoints, pay by pubky.
4. **Contacts and private payments.** Add contact, link status, private
   payment lists, pay a contact, BTC collect sweep.
5. **Payment requests and receipts.** One-time and recurring requests, proofs,
   verification and receipts.
6. **Polish and demo.** Stretch features, docs, a demo script, and a full
   two-simulator run with money moving both ways.
