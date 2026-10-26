# Architecture

This app has two engines and one UI:

- **Tether WDK** holds the keys and moves the money. It runs in a separate
  Bare JavaScript runtime (a "worklet") that the app talks to over RPC.
- **Pubky Paykit** turns Pubky identities into payable contacts. It is a Rust
  library loaded into Hermes through JSI.
- The **React Native UI** talks to both through two small service layers:
  `src/wallet` and `src/paykit`.

## Data flow

```text
                ┌──────────────────────── React Native (Hermes, JS thread) ────────────────────────┐
                │                                                                                   │
  Screens       │  src/features/<feature>/*Screen.tsx                                               │
  (UI)          │        │ uses                                                                     │
                │        ▼                                                                          │
  Design system │  src/ui  (tokens, Text, Button, Row, Seal, ...)                                   │
                │                                                                                   │
  Hooks         │  src/wallet hooks                         src/paykit hooks                        │
                │  useWalletBalances, useSend, ...          usePaykit, useContacts, useLinkState    │
                │        │                                         │                                │
  Services      │        │                                  PaykitService (one per identity)        │
                │        │                                    ├─ SerialCallQueue  (one SDK call     │
                │        │                                    │   at a time, user calls first)      │
                │        │                                    └─ PaykitSyncLoop   (every 3 s while   │
                │        │                                        the app is active)              │
                │        ▼                                         │ async calls                    │
                │  wdk-react-native-core ── HRPC ──┐               ▼                                │
                │                                  │        Paykit SDK (Rust via JSI)               │
                │                                  │               │ synchronous callbacks          │
                │                                  │               ▼  (Rust thread waits)           │
                │                                  │        MmkvStateBlobStore   (encrypted MMKV)    │
                │                                  │        AppSessionProvider   (live session)     │
                │                                  │        WdkPaymentAdapter ── reads ──┐          │
                │                                  │                                     ▼          │
                │   PaykitProvider ── copies WDK addresses into ──────────▶ ReceivingAddressCache  │
                └──────────────────────────────────┼───────────────────────────────────────────────┘
                                                   ▼
                              WDK in a Bare worklet (react-native-bare-kit)
                              keys, signing, Electrum (Mutinynet), Sepolia RPC
```

## Module map

| Path | What it does |
|---|---|
| `src/App.tsx` | Providers from the outside in: SafeArea, `WdkAppProvider`, fonts, `PaykitProvider`, `NavigationContainer`. |
| `src/config/chains.ts` | Testnet constants with no imports (Mutinynet Electrum, Sepolia RPC, USD₮ token, Aave faucet, explorers, Blockscout). |
| `src/config/wdk.ts` | WDK runtime config, `WALLET_ID`, WDK asset descriptors. Keys must match `wdk.config.js`. |
| `src/config/paykit.ts` | Frozen identifiers: staging homeserver, Pubky client id, Paykit app id, endpoint identifiers. |
| `src/config/sync.ts` | Poll intervals, call timeout, link retry backoff. |
| `src/config/demo.ts` | Dev-only prefill from the git-ignored `demo.local.ts`. |
| `src/config/versions.ts` | WDK and Paykit package versions for You > Network details; a unit test keeps them in step with `package.json`. |
| `src/settings/appSettings.ts` | Non-secret flags in plain MMKV (onboarding complete). |
| `src/wallet/` | The wallet service (see below). |
| `src/paykit/` | The Paykit service (see below). |
| `src/ui/` | Design system from `docs/DESIGN.md`, including the seal (`src/ui/seal/`). |
| `src/navigation/` | Route types, root gate, onboarding stack, tabs, deep links (`contact`, `send`, `receive`, `profile`, `scan`, tab names). |
| `src/features/<feature>/` | Screens, one folder per feature: `onboarding`, `wallet`, `people`, `requests`, `you`. Phase-specific parts of shared screens sit in subfolders, e.g. `wallet/send/`, `wallet/receive/`, `wallet/activity/`, `people/scan/`. |
| `src/features/people/PersonSeal.tsx` | A seal with the person's profile photo from the profile cache. Every screen that shows a person uses it. |
| `src/media/pickProfilePhoto.ts` | Pick, crop and shrink a profile photo for upload. |
| `wdk.config.js` | Which WDK wallet modules go into the worklet, and which account methods the app may call. |
| `plugins/withPaykitSimulatorArchs.js` | Expo config plugin: arm64-only iOS simulator builds (Paykit ships no x86_64 slice). |
| `scripts/` | Paykit package build, Paykit Android patch (postinstall), demo prefill generator, and the demo funding scripts `fund-*.mjs` (see "Funding the demo"). |

## Wallet service (`src/wallet`)

WDK's React Native package is hook-based, so the wallet service is a set of
hooks plus pure helpers. All amounts are `bigint` in base units (sats, USD₮
micro-units, wei); `amounts.ts` formats and parses them.

```ts
// lifecycle
useWalletLifecycle(): {
  status: 'starting' | 'no-wallet' | 'locked' | 'ready' | 'error';
  error?: string;
  createWallet(): Promise<void>;
  restoreWallet(mnemonic: string): Promise<void>;   // deletes any existing wallet first; callers confirm
  unlock(): Promise<void>;
  getMnemonic(): Promise<string>;                   // for Paykit identity derivation and reveal
  isValidMnemonic(text: string): boolean;           // word count; WDK/Paykit check the checksum
  hasStoredWallet(): Promise<boolean>;
}
// addresses
useWalletAddresses(): { btc?: string; evm?: string; isLoading: boolean }     // account 0
useBtcAddressLoader(): (accountIndices: number[]) => Promise<Map<number, string>>
// balances (polled ~15 s while active)
useWalletBalances(opts?: { pollMs?: number }): {
  balances: Partial<Record<AssetId, bigint>>; isLoading; isRefreshing; error?; updatedAt?; refresh(): Promise<void>;
}
useContactBtcBalances(accountIndices: number[]): { balances; total: bigint; isRefreshing; refresh }
// sending from account 0
useSend(): {
  quote(req: { asset: AssetId; to: string; amount: bigint }): Promise<{ fee: bigint; feeAsset: AssetId; feeRate?: bigint }>;
  send(req: { asset: AssetId; to: string; amount: bigint; feeRate?: bigint }): Promise<{ hash: string; fee?: bigint; explorerUrl: string }>;
  maxBtcAmount(feeRate?: bigint): Promise<bigint>;    // getMaxSpendable on account 0
}
// history
useActivity(): { items: ActivityItem[]; isLoading; error?; refresh(): Promise<void> }
fetchEvmActivity(address: string): Promise<ActivityItem[]>
// test funds and per-contact accounts
useUsdtFaucet(): { mint(amount?: bigint): Promise<{ hash; explorerUrl }>; isReady: boolean }
useBtcContactAccount(accountIndex: number): { address?; sats?: bigint; transfers; refresh(); collect(): Promise<{ hash; explorerUrl } | undefined> }
// pure helpers
formatAssetAmount(value: bigint, asset: AssetId, opts?): string
parseAssetAmount(text: string, asset: AssetId): ParseResult
toPaykitDecimal(value: bigint, asset): string / fromPaykitDecimal(text, asset): ParseResult
isBtcTestnetAddress / isEvmAddress / chainOfAddress / transactionUrl / addressUrl
checkRecipientAddress(text, chain): { ok: true; address } | { ok: false; reason; message }  // refuses mainnet, wrong chain, pubkys, known contracts
payeeOfPaymentText(text) / payeeOfEthereumUri(rest)                                        // BIP-21 / EIP-681: the payee, never the token contract
checkAffordable({ asset, amount, balances, fee? }): SendProblem | undefined                // balance, amount + fee, "Not enough ETH for gas"
formatFee(fee, asset) / sendErrorMessage(error, asset)                                     // display text; never shows the raw WDK error
fetchBtcFeeRate() / fetchBtcTransactionStatus(txid)                                        // Mutinynet esplora (src/wallet/mutinynet.ts)
```

BTC fee rate: WDK estimates a fee rate itself but never reports it. `quote`
fetches Mutinynet's recommended sats/vB and passes it to WDK explicitly
(`quoteSendTransaction` through `extension()`), and the Send screen hands
the quote's `feeRate` back to `send`, so the transaction pays the rate the
review showed. If the rate API fails, WDK estimates as before and the
review shows the fee without a rate.

USD₮ is an ERC-20 token, so its fee is paid in ETH. `checkAffordable`
reports that case as its own problem ("Not enough ETH for gas"), and the
Send screen shows it as soon as USD₮ is chosen with a zero ETH balance.

History sources: BTC uses WDK's `getTransfers` (Electrum), which returns the
oldest transfers first and stops at `limit`, so the app fetches the whole
history and keeps the newest. WDK's EVM module
has no history call and the WDK Indexer does not cover testnets, so EVM
activity comes from the keyless Blockscout Sepolia API, merged with a local
in-memory record of transactions this app just sent.

## Paykit service (`src/paykit`)

```ts
class PaykitService {
  static connect(opts: { mnemonic: string; signupCode?: string; appPublished: boolean; log: SyncEventLog }): Promise<PaykitService>;
  static publicKeyForMnemonic(mnemonic: string): string;
  readonly publicKey: string;
  readonly sessionOrigin: 'import' | 'signIn' | 'signUp';
  readonly identity: FfiIdentityStatus;
  readonly addressCache: ReceivingAddressCache;
  readonly syncLoop: PaykitSyncLoop;
  readonly log: SyncEventLog;

  call<T>(label: string, task: (sdk, signal: AbortSignal) => Promise<T>, priority?: 'user' | 'background'): Promise<T>;
  dispose(): void;                                         // stops the loop, cancels queued calls, frees the SDK handle

  readonly profiles: ProfileDirectory;                     // cached names + avatars (see "Profiles and avatars")

  setUpIdentity(): Promise<FfiPaykitAppRegistry>;          // Noise key authorization + app registry, then public endpoints
  publishProfile(input: { displayName?: string; avatar?: { bytes; contentType } | null }): Promise<void>;
                                                           // left out = keep, '' = remove name, null = remove photo
  currentProfile(): Promise<FfiProfileResolution | undefined>;
  resolveProfile(publicKey: string): Promise<FfiProfileResolution | undefined>;
  fetchImageDataUri(pubkyUri: string, priority?): Promise<string | undefined>;  // size-capped, type from magic bytes
  setPublicAddresses(addresses: { btc: string; evm: string }): void;  // cache + publish once the app is registered
  publicEndpointChoice(): { btc: boolean; usdt: boolean };
  setPublicEndpointChoice(choice): Promise<void>;          // persist, then publish / remove to match
  publicEndpointStatus(): PublicEndpointStatus;            // { state: waiting | publishing | published | failed, published[], failed[], at? }
  subscribePublicEndpointStatus(listener): () => void;
  syncPublicEndpoints(priority?): Promise<FfiEndpointSyncReport>;      // the raw publish call
  normalizeKey(text: string): string;
  resolvePeer(text: string): Promise<{ publicKey; registry?; publicPayment; profile? }>;
  saveContactAndLink(text: string, label?: string): Promise<FfiContactRecord>;
  removeContact(publicKey: string): Promise<void>;
  blockContact(publicKey: string): Promise<void>;
  unblockContact(publicKey: string, label?: string): Promise<void>;
  refreshState(priority?): Promise<void>;
  getState(): FfiPaykitStateObservation | undefined;
  subscribeState(listener: () => void): () => void;
}

// React
<PaykitProvider autoConnect={boolean}>
usePaykit(): { connection; service?; log; connect(opts?: { signupCode?: string }): Promise<PaykitService> }
usePaykitService(): PaykitService | undefined
usePaykitState(): FfiPaykitStateObservation | undefined   // contacts, linkedPeers, paymentRequests, receipts
useContacts(): ContactSummary[]                            // { publicKey, label?, name?, imageUri?, linkState, createdAt }
useLinkState(pubky?: string): LinkState                    // none | waiting | connecting | linked | recovery | unreachable | blocked
useSyncStatus(): SyncStatus | undefined
useSyncLog(): SyncLogEntry[]
usePersonProfile(pubky?, hint?): { displayName?: string; image?: string /* data: URI */ }
useOwnProfile(): { displayName?; image? }
usePublicEndpointStatus(): PublicEndpointStatus | undefined
contactLinkFor(pubky), keyFromContactLink(text)
pubkyFromText(text): string | undefined                    // shape check for typed / scanned text; normalizeKey validates
// public payments (pay anyone by pubky)
resolvePublicPaymentOptions(service, text): Promise<{ options: PublicPaymentOptions; profile? }>
acceptedAssets(options): ('btc' | 'usdt')[]
cannotPayReason(options, asset, name): string | undefined  // a sentence with a next step
privatePaymentAddressesFor(service, pubky)                 // Phase 4 hook; undefined until then
loadNetworkDetails(service): Promise<NetworkDetails>       // identityStatus + our own app registry
// presentation, in src/ui: linkStateWords(state), sealRingFor(state)
```

| File | Responsibility |
|---|---|
| `PaykitService.ts` | Owns the one SDK handle; wires session, storage, adapter, queue and loop; the facade above. |
| `PaykitProvider.tsx` | Connects (auto after onboarding), hands WDK addresses to the service, derives contact BTC addresses, drops the service when its wallet goes away. |
| `hooks.ts` | Screen-facing hooks over the service. |
| `linkState.ts` | `LinkState` and `linkStateOf`: Paykit's `FfiLinkedPeerState` in this app's terms. The words and seal ring are in `src/ui/seal/linkStatePresentation.ts`. |
| `session.ts` | `importSession`, then `signIn` (or `signUp` for an identity known to be new), and the synchronous session provider. |
| `secureStorage.ts` | Keychain/Keystore: MMKV encryption key and the session secret. |
| `stateStore.ts` | Synchronous encrypted state blob store with the revision contract. |
| `addressCache.ts` | Synchronous address cache and the persisted contact -> BTC account map. |
| `paymentAdapter.ts` | The `FfiSdkPaymentAdapter` callbacks, plus `reservationInputsFor` for explicit private lists. |
| `endpoints.ts` | Payload build/parse/validate for `btc-mutinynet-p2wpkh` and `usdt-sepolia-address`. |
| `callQueue.ts` | Serialized SDK call queue: priorities, timeouts with abort, SharedStateBusy retries. |
| `syncLoop.ts` | The foreground sync loop and its extension hooks. |
| `eventLog.ts` | Secret-free developer log for You > Sync status. |
| `errors.ts`, `keys.ts`, `bytes.ts` | Small helpers. |
| `profiles.ts` | `ProfileDirectory`: names and avatars per pubky, cached 10 minutes, deduplicated loads, retry pause. No native imports, unit tested. |
| `publicPaymentOptions.ts` | Pure: turns a public endpoint resolution into checked addresses per asset, and says why someone can't be paid. Unit tested. |
| `publicPayments.ts` | `resolvePublicPaymentOptions`: SDK lookup (registry, public endpoints, profile) mapped through the pure module. |
| `networkDetails.ts` | `loadNetworkDetails` for You > Network details. |
| `privatePayments.ts`, `requests.ts` | Extension points for Phases 4 and 5. `privatePaymentAddressesFor` is the Phase 4 hook the Send screen already calls. |

### Why the callbacks are synchronous, and the address cache

Paykit calls the state store, the session provider and the payment adapter
**synchronously on the JS thread while a Rust worker thread blocks** waiting
for the answer. So these callbacks:

- cannot `await` anything: no AsyncStorage, no Keychain reads, and no WDK
  calls (WDK answers asynchronously from its worklet);
- must not call back into the same SDK handle (deadlock);
- must throw only `PaykitFfiError` values.

That is why:

- the state store is encrypted **MMKV** (synchronous), with its key read from
  the Keychain once, before the SDK is built;
- the session provider just returns an in-memory session object;
- the payment adapter reads a **ReceivingAddressCache** that the app fills
  ahead of time from WDK. `PaykitProvider` copies account-0 addresses in as
  soon as WDK derives them, and derives contacts' BTC addresses whenever a
  contact account is allocated. If the adapter is asked for a contact's
  private details before both addresses are cached, it throws
  `receiving_details_not_ready` instead of answering with a shorter list
  (Paykit treats every Private Payment List as complete, so a shorter list
  would remove endpoints), and schedules the derivation on a later tick. A
  later round retries.

Account model: BTC account 0 and EVM account 0 are public and spend
everything. Each contact gets a stable BTC account index (1, 2, ...) for its
private payment list, persisted in encrypted MMKV and never reused. EVM uses
account 0 for everyone, because each EVM index would need its own gas.
`useBtcContactAccount(index).collect()` moves a contact account's funds to
account 0. It is not a full sweep: WDK's `getMaxSpendable` keeps back a
dust-limit change output, so a few hundred sats may stay or go to the fee.

### The call queue

Every SDK call goes through `SerialCallQueue`: one call at a time, user
calls before queued background calls, a timeout that aborts the call through
its `AbortSignal`, and up to three retries with backoff for `SharedStateBusy`.
Use `service.call(label, task)` for any SDK method not in the facade; the
queue itself is private to the service. `dispose()` closes the queue:
queued calls are rejected and nothing new starts on the released handle.

### Publishing public endpoints

The SDK refuses to publish endpoints until `publishPaykitApp` has run on
this install ("Paykit app ... must be published before creating new
state"). So the service publishes them only after `setUpIdentity()` (or,
after onboarding, straight away), and only counts a publish with no failed
endpoint as done. Anything else is retried from the next sync round.

What gets published is the account-0 address of each asset switched on in
You > What you publish (`publicEndpointChoice`, persisted per identity in
the encrypted `paykit-app-<id>` MMKV file, both on by default).
`syncPublicEndpointsWithReceivingDetails` publishes the list it is given
and removes our other SDK-managed endpoints, so switching an asset off
removes its endpoint from the homeserver, and an empty list (both off)
removes all of them. Because an empty list is destructive, the service
sends one only when both addresses are known and both switches are off,
never because addresses are still loading. If the choice changes while a
publish runs, the service publishes again for the new choice. Private
payment lists are not affected: contacts always get both private
addresses.

"Check what others see" resolves your own pubky with
`resolvePublicContactPayment`, which reads the published data the way a
payer would.

### Profiles and avatars

`service.profiles` (`ProfileDirectory`, `profiles.ts`) caches each
person's published name and avatar: the profile (from `resolveProfile`
with the pubky.app fallback) for 10 minutes, the avatar by its URI (avatar
URIs contain a content hash, so they never go stale). Loads run at
background priority, are shared between callers, and a failure waits a
minute before the next try. Screens read it with `usePersonProfile(pubky,
hint)` (the hint is a contact record's profile from `observeState`) and
`useOwnProfile()`; `PersonSeal` puts the photo in the seal.

Profiles are someone else's data. Only `pubky://` images are fetched,
through the SDK with a 512 KB cap (an `https` URL could be used to see who
views a profile), the image type comes from the file's magic bytes rather
than its name, and names lose control characters and are cut at 128
characters. Display order for a contact's name: your local label, then
their published name, then the shortened key.

Publishing (`publishProfile`) uploads a new photo first, reads the current
profile, and publishes with that revision as `expectedRevision`, so a
change made elsewhere in between fails with ConcurrentUpdate instead of
being overwritten. The new profile goes straight into the cache.

### Paying a person by pubky (public endpoints)

The Send screen's "A person (pubky)" field (`wallet/send/PubkyRecipientField.tsx`):

1. `pubkyFromText` checks the shape (bare key, `pk:` prefix or contact
   link) on every keystroke; after a 300 ms pause `service.normalizeKey`
   validates it with the SDK. Your own key is refused.
2. `privatePaymentAddressesFor` (Phase 4 hook) is asked first, so a linked
   contact will be paid at their private address once Phase 4 fills it in.
3. Otherwise `resolvePublicPaymentOptions`: their app registry,
   `resolvePublicContactPayment` and their profile. The payment adapter
   already filters candidates; the pure `publicPaymentOptionsFrom` checks
   again that each endpoint belongs to that pubky and that its payload
   parses as one of ours (`parseEndpoint`), then keeps one address per
   asset.
4. The field reports `{ kind: 'pubky', publicKey, route, addresses }`.
   If the chosen asset is missing, `cannotPayReason` says why ("Ben
   doesn't accept USD₮ by pubky. Choose Bitcoin instead.", no wallet that
   takes payments by pubky, homeserver unreachable, nothing published) and
   Review stays disabled. The review shows the person and the exact address.

The wallet then sends on chain with `useSend`, exactly like an address
send. A pubky that nobody uses fails the registry lookup with a Transport
error, the same as a network problem, so the message covers both.

### Scanning codes

`people/ScanQrScreen.tsx` reads a QR code from the camera (expo-camera,
QR only, with its own permission step), from a photo in the library
(`scanFromURLAsync`, the way to test on simulators) or from pasted text.
`people/scan/parseScannedCode.ts` (pure, unit tested) decides where it
goes: a pubky or contact link to Add person (after `normalizeKey`), a
`tb1…`/`0x…` address, BIP-21, EIP-681 or `paykitwdk://send` link to Send
with the recipient filled in. It caps the length, strips control
characters, refuses mainnet and other EVM chains, and for an EIP-681 token
transfer pays the `address=` payee, never the token contract. Amounts in
codes are ignored: the payer types the amount and reviews the fee.

The URI rules live in one place, `src/wallet/addressFormat.ts`
(`payeeOfPaymentText`), and every way an address gets in uses them: the
scanner, the Send screen's address field, and a `paykitwdk://send?to=…`
link, which React Navigation hands straight to Send's route params. The
USD₮ token and Aave faucet contracts are refused as recipients there and
again in `useSend` (tokens sent to them are lost).

### The sync loop

Paykit has no push. While the app is active, `PaykitSyncLoop` runs a round
every 3 s (paused in the background):

1. `privateMessageSchedulingSnapshot()`;
2. `ensureLinkWithPeer(peer, 3)` for peers in Linking or RecoveryRequired
   and saved contacts without a link, with per-peer backoff on failure;
3. `processPendingPrivateMessages()` if anything is waiting to send;
4. `receivePrivateMessagesFromLinkedPeers()`;
5. `processPendingPrivateMessages()` again if anything arrived (delivery
   confirmations);
6. extension hooks (`syncLoop.addRoundHook(name, hook)`), including the
   service's own retry of a public endpoint publish that has not worked
   yet;
7. `observeState()`, which feeds the React hooks.

`syncLoop.flush()` runs a round immediately; call it after a user action
toward a peer. The loop never signs in: a failed round shows its error in
You > Sync status with a "Reconnect" button, which builds a fresh
connection (saved session first, then sign-in).

### Extension points for later phases

- **Private payments (Phase 4)** go in `src/paykit/privatePayments.ts`. Fill
  in `privatePaymentAddressesFor(service, pubky)` (the Send screen's pubky
  field already prefers it over public endpoints), and share
  private lists with `reservationInputsFor` +
  `syncPrivatePaymentListsWithReservationsAndProcessOutbound` from a round
  hook, and pay contacts with `prepareAndResolvePrivateContactPayment` + the
  wallet's `useSend`.
- **Payment requests and receipts (Phase 5)** go in `src/paykit/requests.ts`.
  The inbox is already in `usePaykitState().paymentRequests`.
- Round hooks are registered in `registerPrivatePaymentHooks` and
  `registerPaymentRequestHooks`. `PaykitService.connect` calls both once
  per service, before the loop starts, so neither phase edits the service or
  the provider to wire its hook.
- Feature agents work in their own `src/features/<feature>` folder. Shared
  layers (`src/ui`, `src/wallet`, `src/paykit`, `src/navigation`) change only
  for additions the feature needs.

### The Send flow and recipients

`SendScreen` runs three steps: compose (recipient, asset, amount with Max),
review (WDK fee quote and `checkAffordable`) and sent (hash, explorer link,
haptic). Who receives the money is decoupled from how the person chose
them, in `src/features/wallet/send/recipient.ts`:

```ts
type SendRecipient =
  | { kind: 'address'; label: string; addresses: Partial<Record<AssetId, string>> }
  | { kind: 'pubky'; label: string; publicKey: string; route: 'public' | 'private'; addresses: Partial<Record<AssetId, string>> };
type RecipientFieldProps = { asset: AssetId; initialText?: string; onChange(recipient?: SendRecipient): void };
```

Phase 2 ships `AddressRecipientField`, Phase 3 `PubkyRecipientField`
(see "Paying a person by pubky"); the compose step switches between them
with "A person (pubky)" / "An address", opens on Person when the `to`
param is a pubky, and switches to Person when a pubky is pasted into the
address field. Phase 4 fills in `privatePaymentAddressesFor`, which the
pubky field already asks first (`route: 'private'`). Review shows a
person's seal, name and the address paid (`send/PersonRecipient.tsx`).

### Files that several phases edit

Feature folders follow the tabs, but phases cut across them. These screens
carry TODOs for more than one phase, so **phases 2 to 5 run one after
another, not in parallel**:

| File | Phases |
|---|---|
| `src/features/wallet/SendScreen.tsx` | 2 (address send), 3 (pay a pubky), 4 (pay a contact privately) |
| `src/features/wallet/ReceiveScreen.tsx` | 2 (receive card), 3 (pay-me code) |
| `src/features/wallet/ActivityDetailScreen.tsx` | 2 (transaction), 5 (request and receipt links) |
| `src/features/you/YouScreen.tsx` | 2 (phrase, faucet, collect), 3 (profile, endpoints, network details) |

A phase that adds to one of these screens should put its part in its own
component file next to the screen (for example
`src/features/wallet/send/PubkyRecipientField.tsx`) and keep its edit to the screen
small. Phase 2 left marked slots (`{/* Phase 3: ... */}`, `{/* Phase 5: ... */}`)
where those parts render. Edits to the barrels (`src/paykit/index.ts`, `src/wallet/index.ts`,
`src/ui/index.ts`) and to routes (`src/navigation/types.ts`,
`RootNavigator.tsx`) are append-only: add lines, do not reorder or rewrite
existing ones, so merges stay trivial.

## Storage and secrets

| Data | Where | Notes |
|---|---|---|
| Mnemonic (WDK seed) | WDK's encrypted seed in the Keychain/Keystore | Read only to derive the Pubky key or to reveal it. Never logged. |
| Pubky session secret | Keychain/Keystore (`paykit-session`) | `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. |
| MMKV encryption key | Keychain/Keystore (`paykit-state-encryption-key`) | A 32-byte AES-256 key carrying 192 random bits (24 random bytes as base64, because MMKV takes the key as a string). |
| Paykit SDK state | Encrypted MMKV `paykit-state-<id>` | One snapshot value (blob + revision). |
| Contact -> BTC account map | Encrypted MMKV `paykit-app-<id>` | Never reuses an index. |
| Public endpoint choice (BTC / USD₮ on or off) | Encrypted MMKV `paykit-app-<id>` | Both on by default. |
| Profiles and avatars of people | Memory only (`ProfileDirectory`) | Public data; reloaded after a restart. |
| Onboarding flag, wallet origin | Plain MMKV `app-settings` | Not secret. The origin ('created' or 'restored') decides sign-up vs sign-in. |

On iOS, Keychain items survive an app uninstall, while MMKV files do not.
After a reinstall the seed, session secret and storage key are still there
but the onboarding flag is gone, so onboarding offers to continue with the
existing wallet (treated as restored: it signs in). Replacing that wallet
asks first, and deletes the saved session secret. The old identity's
encrypted Paykit files are kept, keyed by its pubky, so restoring the same
phrase later keeps its links.

The recovery phrase is shown in two places, You > Recovery phrase (behind a
confirmation) and onboarding's BackupPhrase step (after a tap). Both read
it from WDK only on request, hold it with `useForegroundSecret` (dropped
when the app leaves the foreground, so the app-switcher snapshot cannot
show it), never copy it to the clipboard and never log it.

Logging rules: ESLint forbids `console.log`. Paykit records are not redacted
in JS, so never log them; the event log takes short, secret-free strings.

## Funding the demo

The host-side scripts in `scripts/` read the git-ignored `.env.demo` and
derive the demo wallets' addresses with the same paths WDK uses, so
scripts and app agree (checked: the derived addresses match what both apps
show):

| Chain | Path | WDK call |
|---|---|---|
| EVM (ETH, USD₮) | `m/44'/60'/0'/0/i` | wallet-evm `getAccount(i)` |
| BTC (Mutinynet) | `m/84'/1'/0'/0/i`, P2WPKH `tb1q…` | wallet-btc `getAccount(i)`, `network: 'testnet'` |

Both use the BIP-39 seed with an empty passphrase. The iOS demo wallet's
EVM account 0 is the treasury that signs the Sepolia scripts. The scripts
use `ethers` and `@scure/base` (pinned devDependencies); the app does not.

## Rules for developing

- Never reload JS with Cmd-R or the dev menu after Paykit has loaded; cold
  relaunch instead (see README). The WDK worklet does not hot reload either.
  Fast Refresh counts too: saving a file while an app is open can leave its
  Paykit handle disposed ("Paykit is disconnected" in the log), so relaunch
  both apps cold after editing code.
- One SDK handle per identity: always go through `usePaykit()`.
- Amounts are `bigint` until they are formatted for display.
