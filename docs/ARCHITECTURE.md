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
| `src/navigation/` | Route types, root gate, onboarding stack, tabs, deep links (`contact`, `send`, `receive`, `profile`, `scan`, `request-money?pubky=`, `request?counterparty=&requestId=`, `person?pubky=`, `automatic-payments?pubky=`, tab names). |
| `src/features/<feature>/` | Screens, one folder per feature: `onboarding`, `wallet`, `people`, `requests`, `you`. Parts of shared screens sit in subfolders by what they do, e.g. `wallet/send/`, `wallet/receive/`, `wallet/activity/`, `people/scan/`. |
| `src/features/people/PersonSeal.tsx` | A seal with the person's profile photo from the profile cache. Every screen that shows a person uses it. |
| `src/features/people/usePersonName.ts`, `personName.ts` | What to call a person (your label, else their published name, else the short key) and whether that name is a contact's or self-chosen. Every screen that names a person uses it. |
| `src/features/people/person/` | The Person page's parts: `LabelEditor` (your local name for them), `WhatTheyAccept` (public endpoints and private lists both ways), `AutomaticPayments` (Allowances both ways, with usage), `PersonActions` (Block, Unblock, Forget, Remove), `PersonHistory`, and the pure `personWords.ts`. `contactOrder.ts` sorts the People list; `justAdded.ts` lets the page play the seal closing when the link formed during Add. `../AutomaticPaymentsScreen.tsx` is the modal that offers a contact automatic payments. |
| `src/features/wallet/activity/` | Activity rows: `activityText.ts` (words), `activityPeople.ts` (which contact a transaction involves, pure), `useActivityPeople.ts`, `ActivityRow.tsx`, `ContactAccountWatchers.tsx` (feeds contact accounts' history into Activity) and `ActivityPaykitLinks.tsx` (the request and receipt a transaction belongs to). |
| `src/features/requests/` | Payment requests: `RequestMoneyScreen`, `RequestsScreen` (+ `RequestRow`), `RequestDetailScreen` (+ `RequestTimeline`, `RecurringPayments`, `AutomaticPaymentNote`), `PayRequestScreen` (the Send review, locked), `requestSchedule.ts` (what is due, pure) and `PaymentChainBridge.tsx` (hands the round hooks WDK, including the fee quote and send for automatic payments; mounted in `MainTabs`). |
| `src/features/you/BackupSection.tsx` | You > Contacts and requests backup: make one (Copy or Share), when the last one was made, check a copied one. |
| `src/media/pickProfilePhoto.ts` | Pick, crop and shrink a profile photo for upload; `photoDataUri` previews it. |
| Shared across features | A few feature components are used by other features on purpose: `wallet/receive/PayMeCode.tsx` (Receive, You, onboarding Ready), `you/RecoveryPhraseSection.tsx` (You, and onboarding before replacing a wallet), `people/PersonSeal.tsx` and `people/usePersonName.ts` (every screen that shows a person), `wallet/GetTestUsdtButton.tsx` (Wallet, Receive, You), `wallet/activity/ActivityRow.tsx` and `useActivityPeople.ts` (Wallet, Person history), `you/ContactAccountsSection.tsx`'s `ContactAccountRow` (You, Person), `wallet/send/PersonRecipient.tsx`'s `PersonHeader` (Send, Request money). Import them from their home folder; everything else crosses features only through `src/ui`, `src/wallet` and `src/paykit`. |
| `wdk.config.js` | Which WDK wallet modules go into the worklet, and which account methods the app may call. |
| `plugins/withPaykitSimulatorArchs.js` | Expo config plugin: arm64-only iOS simulator builds (Paykit ships no x86_64 slice). |
| `plugins/withMmkvBackupExclusion.js` | Expo config plugin: excludes `Documents/mmkv` from iCloud and Finder backups at every launch (see "Storage and secrets"). |
| `src/ui/useScreenCaptureBlock.ts` | Blocks screenshots, recordings and the app-switcher snapshot while a secret is on screen (expo-screen-capture). `useForegroundSecret` uses it. |
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
  quote(req: { asset: AssetId; to: string; amount: bigint; feeRate?: bigint }): Promise<{ fee: bigint; feeAsset: AssetId; feeRate?: bigint }>;  // feeRate: the rate Max used
  send(req: { asset: AssetId; to: string; amount: bigint; feeRate?: bigint }): Promise<{ hash: string; fee?: bigint; explorerUrl: string }>;
  maxBtcAmount(feeRate?: bigint): Promise<bigint>;    // getMaxSpendable on account 0
}
// history
useActivity(): { items: ActivityItem[]; isLoading; error?; refresh(): Promise<void> }
fetchEvmActivity(address: string): Promise<ActivityItem[]>
// test funds and per-contact accounts
useUsdtFaucet(): { mint(amount?: bigint): Promise<{ hash; explorerUrl }>; isReady: boolean }
useBtcContactAccount(accountIndex: number): { address?; sats?: bigint; transfers; refresh(); collect(): Promise<{ hash; explorerUrl } | undefined> }
useContactAccountWatcher(accountIndex): void              // polls one contact account's transfers into Activity
clearContactAccountActivity(): void
// pure helpers
formatAssetAmount(value: bigint, asset: AssetId, opts?): string
parseAssetAmount(text: string, asset: AssetId): ParseResult
toPaykitDecimal(value: bigint, asset): string / fromPaykitDecimal(text, asset): ParseResult
isBtcTestnetAddress / isEvmAddress / chainOfAddress / transactionUrl / addressUrl
checkRecipientAddress(text, chain): { ok: true; address } | { ok: false; reason; message }  // refuses mainnet, wrong chain, pubkys, known contracts
payeeOfPaymentText(text) / payeeOfEthereumUri(rest)                                        // BIP-21 / EIP-681: the payee, never the token contract
checkAffordable({ asset, amount, balances, fee? }): SendProblem | undefined                // balance, amount + fee, "Not enough ETH for gas"
formatFee(fee, asset) / sendErrorMessage(error, asset)                                     // display text; never shows the raw WDK error
sendFailureFor(error, asset): { outcome: 'not-sent' | 'unknown'; message }                // after a send: 'unknown' = may have been broadcast, do not retry
parseTypedAmount(text, asset): ParseResult                                                // decimal comma vs thousands separator; '1,000' is 'ambiguous'
fetchBtcFeeRate() / fetchBtcTransactionStatus(txid)                                        // Mutinynet esplora (src/wallet/mutinynet.ts)
retryIfElectrumDropped(read) / isElectrumConnectionLost(error)                             // one quiet retry of a Bitcoin read (src/wallet/electrumRetry.ts)
nextFailureStreak / shouldReportFailure                                                    // when a polled read has failed long enough to say so (src/wallet/failureStreak.ts)
// payment requests
useAccountZeroPaymentChecks(): { btcSent(txid); evmTransaction(hash); signErc20Payment(typedData) }   // WDK getTransaction / signTypedData
useBtcReceivedReader(accountIndex): ((txid, address) => Promise<BtcReceipt>) | undefined              // WDK getTransfers on one account
erc20PaymentTypedData / erc20PaymentDigest / erc20PaymentSigner / isErc20PaymentTypedData            // src/wallet/erc20PaymentProof.ts, pure
btcReceiptFromTransfers / evmTransactionFrom / erc20TransferFromLog / findErc20TransferLog         // src/wallet/paymentEvidence.ts, pure
```

BTC fee rate: WDK estimates a fee rate itself but never reports it. `quote`
fetches Mutinynet's recommended sats/vB and passes it to WDK explicitly
(`quoteSendTransaction` through `extension()`), and the Send screen hands
the quote's `feeRate` back to `send`, so the transaction pays the rate the
review showed. If the rate API fails (or takes over 5 s), WDK estimates as
before and the review shows the fee without a rate. Max sizes a BTC amount
at a rate too; the Send screen passes that rate to `quote`, so amount + fee
still fits the balance. Collect uses one rate for `getMaxSpendable` and the
send for the same reason.

Sends that may have left: WDK's BTC `sendTransaction` broadcasts first and
then polls Electrum for up to 10 s, and an EVM RPC timeout on
`eth_sendRawTransaction` is just as unclear. So `sendFailureFor` treats
every error it does not recognise as raised before the broadcast (dust,
balance, checksum, fee cap, a reverting call) as "may have been sent". The
Send review, the faucet button and Collect then stay disabled and say to
check Activity, instead of offering a retry that could pay twice. The Send
screen also freezes what it reviews (asset, recipient, amount) with the
quote, locks its inputs while a quote runs, and guards every money handler
with a ref so a double tap cannot send twice.

USD₮ is an ERC-20 token, so its fee is paid in ETH. `checkAffordable`
reports that case as its own problem ("Not enough ETH for gas"), and the
Send screen shows it as soon as USD₮ is chosen with a zero ETH balance.

Dropped Electrum connections: WDK's Bitcoin client keeps one socket to
Mutinynet's Electrum server and, by default, reopens it only twice per
session; after a third close (an idle timeout, the app in the
background) every Bitcoin call failed with "Connection to server lost"
until a restart. `src/config/wdk.ts` passes `maxRetry` and
`retryPeriod` so it keeps reconnecting a second after each close. Every
`getTransfers` read goes through `retryIfElectrumDropped`, which waits
1.5 s and tries once more on that error only (never for a send).
Balances and history keep their last values when a poll fails, and the
screen says "Couldn't load …" only after a run of failures
(`failureStreak.ts`: two polls with nothing to show, four with older
data). WDK logs each failure with `console.error` first; in dev builds
App.tsx tells LogBox to ignore exactly that line, so no toast covers the
UI.

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
  fetchImageDataUri(pubkyUri: string, priority?): Promise<string | undefined>;  // byte- and pixel-capped, type from magic bytes
  setPublicAddresses(addresses: { btc: string; evm: string }): void;  // cache + publish once the app is registered
  publicEndpointChoice(): { btc: boolean; usdt: boolean };
  setPublicEndpointChoice(choice): Promise<void>;          // persist, then publish / remove to match
  publicEndpointStatus(): PublicEndpointStatus;            // { state: waiting | publishing | published | failed, published[], failed[], at? }
  subscribePublicEndpointStatus(listener): () => void;
  syncPublicEndpoints(priority?): Promise<FfiEndpointSyncReport>;      // the raw publish call
  normalizeKey(text: string): string;
  resolvePeer(text: string): Promise<{ publicKey; registry?; publicPayment; profile? }>;
  saveContactAndLink(text: string, label?: string): Promise<FfiContactRecord>;  // saveContact + ensureLinkWithPeer
  setContactLabel(publicKey: string, label: string): Promise<void>;             // local only; '' = their published name
  removeContact(publicKey: string): Promise<void>;         // ends automatic payments, withdraws our list, ends the link; a blocked person stays blocked (see "Contacts")
  readonly privateLists: PrivateListStore;                 // lists shared and received, for display
  blockPeer(publicKey: string): Promise<void>;             // end automatic payments, withdraw our list, then blockPeer; keeps the contact (see "Blocking and forgetting")
  unblockPeer(publicKey: string): Promise<void>;           // back to NotLinked; the sync loop forms a fresh link
  forgetPeer(publicKey: string): Promise<'forgotten' | 'kept'>;  // blocked only; 'kept' when we have history with them
  // backups (./backup.ts; see "Backup and restore")
  sealBackup(plaintext, nonce): string / openBackup(text): string   // key from the recovery phrase, never logged
  inScratchState(label, task): Promise<T>                  // a throwaway SDK handle (in-memory store, same session) in this queue
  readonly restoredFromBackup?: BackupSummary;             // set when connect({ restoreBackup }) restored one
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
pubkyFromText(text): string | undefined                    // shape check for typed / scanned text (or a shared pay-me message); normalizeKey validates
// public payments (pay anyone by pubky)
resolvePublicPaymentOptions(service, text): Promise<{ options: PublicPaymentOptions; profile? }>
acceptedAssets(options): ('btc' | 'usdt')[]
cannotPayReason(options, asset, name): string | undefined  // a sentence with a next step
privatePaymentAddressesFor(service, pubky)                 // a Linked contact's private addresses, else undefined
loadReceivedPrivateList(service, pubky, priority?)         // currentPrivatePaymentLists, checked
usePrivateLists(pubky): { incoming?; outgoing? }           // what they shared with you / whether yours reached them
usePrivateListSummary() / usePrivateAddressOwners() / useContactAccounts()
loadNetworkDetails(service): Promise<NetworkDetails>       // identityStatus + our own app registry
// payment requests (./requests.ts; see "Payment requests")
requestMoney(service, { payer, asset, amount, note, expiry, repeat, count }): Promise<RequestView>
acceptRequest / declineRequest / cancelRequest(service, counterparty, requestId, ...)
preparePayment(service, counterparty, requestId, period?): Promise<PreparedPayment>     // claim + resolve; nothing reserved
startPayment(service, prepared): Promise<attemptId>                                    // accept if needed, ledger reserve + begin
finishPayment(service, prepared, attemptId, { hash } | { failure })                    // book, outcome, BTC proof
deferPayment(service, counterparty, requestId, period)                                 // deferPaymentOccurrence
paymentRequestsOf(service): { book: RequestBook; attachChain(chain: PaymentChain) }
usePaymentRequests() / usePaymentRequest(cp, id) / useRequestFacts(view, name) / useRequestBook() / useRequestLinks()
requestStatusWords(facts) / requestTimeline(facts, payment) / paymentWords(...)          // ./requestStatus.ts, pure
// backup and restore (./backup.ts, ./restoreReview.ts)
exportBackup(service): Promise<{ text; meta }>             // sealed text, and the meta to record once it is kept
recordBackupKept(service, meta)                            // on Copy, or a Share iOS confirms: "Last backup" from then on
readBackupStatus(service): Promise<BackupStatus>           // backupStateRevision, observedBackupStateRevision, last backup, changed since
checkBackup(service, text): Promise<BackupSummary>         // dry-run restore into a throwaway handle; nothing here changes
PaykitService.connect({ ..., restoreBackup })              // the real restore, during onboarding; writes the restore review
useRestoreReview() / resumeAfterRestore(store)             // what a restore left to check; the person resumes automatic payments
// automatic payments (./allowances.ts, ./automaticPayments.ts, ./allowanceTerms.ts, ./acceptanceTiming.ts)
offerAutomaticPayments(service, pubky, terms) / acceptAutomaticPayments / declineAutomaticPayments / endAutomaticPayments
endAutomaticPaymentsWith(service, pubky)                   // before Block and Remove: stop on this phone, then end with them
buildAllowanceTerms(draft) / readAllowanceTerms / allowanceTermsWords / allowanceCovers / allowanceUsage / allowanceUsageWords   // pure
acceptProblem(terms, weWouldPay, now) / automaticFeeProblem(quote) / nextAcceptanceTiming(...)                                  // pure
useAllowancesWith(pubky) / useAllowanceLedger() / useAutomaticPaymentNote(key)
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
| `signUpErrors.ts` | Pure: which step of a sign-up failed, from the SDK's Identity error context (the invite code was refused, the identity already exists, or only signing in is left), and the sentence for each. Unit tested. |
| `profiles.ts` | `ProfileDirectory`: names and avatars per pubky, cached 10 minutes, deduplicated loads, retry pause. No native imports, unit tested. |
| `publicPaymentOptions.ts` | Pure: turns a public endpoint resolution into checked addresses per asset, and says why someone can't be paid. Unit tested. |
| `publicPayments.ts` | `resolvePublicPaymentOptions`: SDK lookup (registry, public endpoints, profile) mapped through the pure module. |
| `networkDetails.ts` | `loadNetworkDetails` for You > Network details, including each contact's Encrypted Link recovery markers (`encryptedLinkRecoveryMarkerStatus`, a local read; `ensureLinkWithPeer` publishes and reads them, and this app never removes one). |
| `privatePayments.ts` | Private Payment Lists over the sync loop (share ours, read theirs) and paying a contact privately (`privatePaymentAddressesFor`). See "Private payments". |
| `privatePaymentLists.ts` | Pure: when to share (`planPrivateListShares`), checking received endpoints, and the `PrivateListStore` screens read. Unit tested. |
| `requests.ts` | Payment requests: propose, accept, decline, cancel, pay (claim, resolve, ledger, proof), views of the SDK records, and `registerPaymentRequestHooks`. See "Payment requests". |
| `requestRounds.ts` | The three request round hooks: finish our payments (and find or release ones that lost their hash), check arrived proofs and issue receipts, retrieve receipts. |
| `requestLinks.ts` | Pure: which transactions Activity links to a request (our own payments, and verified ones only). Unit tested. |
| `requestTerms.ts` | Pure: build our terms (bound address, schedule, note) within one private message; read anyone's. Unit tested. |
| `recurrence.ts` | Pure: billing periods from a schedule, what has started, what is due. Unit tested. |
| `paymentProofs.ts` | Pure: Bitcoin and ERC-20 proof JSON and the payee's on-chain rules, including the payment-time rule. Unit tested. |
| `requestBook.ts` | The wallet's own persisted notes: payments in flight, when we asked, proof checks, claimed transfers, deferred periods. Unit tested. |
| `requestStatus.ts` | Pure: status words and the five-step timeline. Unit tested. |
| `allowances.ts` | Allowances: offer, accept, decline, end; the per-service cache of `listAllowances` and the payment ledger (`allowanceAccountingState`) as plain data. See "Automatic payments". |
| `allowanceTerms.ts` | Pure: the demo's default limits, reading terms, words, whether limits cover a request (display only), usage per period. Unit tested. |
| `automaticPayments.ts` | The `allowances` and `automatic-payments` round hooks: accept covered requests and pay due ones under an Allowance, through the same ledger, book, WDK send and proof path as the Pay button. |
| `acceptanceTiming.ts` | Pure: whether our acceptance of a request left before it expired, as the automatic payment hook observes it. Unit tested. |
| `backup.ts` | Make, check and apply backups of the Paykit state and the app's own records. See "Backup and restore". |
| `restoreReview.ts` | After a restore: which requests came back (paid by hand) and whether automatic payments are paused until the person resumes them. Unit tested. |
| `backupCrypto.ts` | Pure: the backup key (HKDF over the phrase-derived identity secret), XChaCha20-Poly1305 sealing, the envelope. Unit tested. |

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
than its name, an image whose header declares more than 2048 px a side or
4 MP is dropped before anything decodes it (`readImageSize` in `bytes.ts`;
a small file can declare a huge canvas), and names lose control, bidi-override, zero-width and other
invisible format characters and are cut at 128 characters (hints from
contact records too). Display order for a person's name, in one place
(`usePersonName`): your local label, then their published name, then the
shortened key.

A published name is a claim: anyone can publish "Ben" with Ben's photo.
So where a payment depends on it (the Send payee card and the review),
`PersonHeader` also shows the shortened pubky and says whether the person
is in your contacts or "Not in your contacts: this is the name they gave
themselves".

Publishing (`publishProfile`) uploads a new photo first, reads the current
profile, and publishes with that revision as `expectedRevision`. That is a
field-level merge: fields the edit leaves out, and `extraJson`, keep what
was just read, and ConcurrentUpdate only catches a write from another
device in the moment between that read and the publish. It does not
protect what the Edit profile screen showed when it opened: a name edited
there replaces whatever another device published meanwhile. The new
profile goes straight into the cache.

### Paying a person by pubky (public endpoints)

The Send screen's "A person (pubky)" field (`wallet/send/PubkyRecipientField.tsx`):

1. `pubkyFromText` checks the shape (bare key, `pk:` prefix or contact
   link) on every keystroke; after a 300 ms pause `service.normalizeKey`
   validates it with the SDK. Your own key is refused.
2. `privatePaymentAddressesFor` is asked first: a Linked contact is paid at
   the private address they shared only with you (see "Private payments").
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
6. extension hooks (`syncLoop.addRoundHook(name, hook)`): the service's
   own retry of a public endpoint publish that has not worked yet, then
   `private-payment-lists` and `received-private-lists` (private
   payments), then `payment-request-payments`, `payment-request-proofs`
   and `payment-request-receipts` (payment requests), then `allowances`
   and `automatic-payments` (automatic payments);
7. `observeState()`, which feeds the React hooks.

`syncLoop.flush()` runs a round immediately; call it after a user action
toward a peer. The loop never signs in: a failed round shows its error in
You > Sync status with a "Reconnect" button, which builds a fresh
connection (saved session first, then sign-in).

### Contacts

Adding someone (People > Add, a scanned pay-me code or a
`paykitwdk://contact` link) previews them first: `resolvePublicPaymentOptions`
reads their registry, public endpoints and profile, so the screen shows the
seal, published name, photo, short key and what they accept publicly, or
says their homeserver can't be reached (you can still add them). Your own
key and existing contacts are caught before saving. "Add Ben" runs
`saveContactAndLink`: `saveContact` (with your optional label), allocate
their Bitcoin account, `refreshContactPaykitProfile`, then
`ensureLinkWithPeer`. That call picks initiator or responder from the two
keys, so the app never calls `initiateLinkWithPeer`, `acceptLinkWithPeer`
or `advanceLinkHandshake` itself; the sync loop keeps calling
`ensureLinkWithPeer` until the link is Linked.

A label is your own name for a contact (`setContactLabel`, a
`saveContact` with the new label). It stays on this phone and wins over
their published name everywhere (`personName.ts`).

Removing a contact ends the private connection, not just the record. The
SDK's `removeContact` deletes only the Contact Record and leaves the
Encrypted Link (and their messages) running, so `PaykitService.removeContact`
instead:

1. ends automatic payments with them (`endAutomaticPaymentsWith`, see
   "Blocking and forgetting");
2. sends an empty Private Payment List (`clearPrivatePaymentListAndProcessOutbound`,
   best effort), so their wallet drops our private addresses;
3. runs `removeContactsAndBlockPeers`, which removes the record and
   discards the link in one transaction;
4. runs `unblockPeer`, which returns them to NotLinked and clears our
   recovery attempt id. Not for someone the person had blocked: removing
   them keeps the block, so their messages stay refused (the Remove
   confirmation says so).

Adding them again then starts a fresh link with a new attempt id; their
side sees it on its next receive, marks the old link for recovery and links
again. Their Bitcoin account index is kept (indices are never reused), so
money they sent stays collectable. Blocking and forgetting are below.

### Blocking and forgetting

The Person page has Block (with Unblock and Forget once blocked) next to
Remove, each after a confirmation (`person/PersonActions.tsx`):

- **Block** (`PaykitService.blockPeer`): the SDK's `blockPeer` discards
  the Encrypted Link (keys and handshake), marks every message still
  queued for them as needing a fresh link, and from then on the request,
  allowance and payment calls refuse this peer and their messages are not
  read. Stored requests, proofs and receipts stay. The contact record
  stays too, so the page shows "Blocked" (Graphite dashed ring, as
  DESIGN.md defines) with their history, and the People list puts blocked
  people under their own "Blocked" heading at the bottom (with the empty
  state above it when no one else is left). Pay and Request are hidden,
  including the Pay button in their empty history. The app first ends
  automatic payments with them (below), withdraws our Private Payment
  List (best effort), and refuses while a proof of our payment to them
  has not gone out (the same guard as Remove: the proof would be
  dropped). The sync loop skips blocked contacts.
- **Automatic payments end on Block and Remove**
  (`endAutomaticPaymentsWith` in `allowances.ts`). The SDK's `blockPeer`
  leaves Allowances alone, and an accepted one would pay again after an
  Unblock or a re-add, while the Person page can't reach it in between.
  So every Allowance we pay them under (accepted, or offered by us and
  open) is first stopped on this phone: its id goes into a persisted list
  (`stopped-allowances-v1`, kept in backups) that `usableAsPayer()`
  leaves out for good. Then each live Allowance with them is ended with
  `endAllowance`, which queues an End message and needs a ready link; for
  a peer who is unreachable, that fails, and the local stop still holds.
  After an Unblock the Person page marks a stopped Allowance as stopped,
  with End to tell them, and allows a new offer. Checked on the
  simulators: blocking Ben ended Ana's accepted Allowance on both phones
  (the End left with the withdrawn list, before the block), and after
  Unblock a new offer and acceptance worked.
- **Unblock** (`unblockPeer`): back to NotLinked; the SDK does not restore
  the old link. Because they are still a contact, the next sync round
  calls `ensureLinkWithPeer` with a new attempt id; their wallet sees the
  new recovery marker and links again. Checked on the simulators: the
  link was ready again about 30 seconds after Unblock.
- **Forget** (`forgetPeer`), blocked only: deletes what they sent that we
  never acted on (received private stream items, including their Private
  Payment List, the Event Message dedupe records, Receipt Access never
  used). It notifies no one and can't be undone. The SDK refuses (Policy)
  when we have any history with them: a request or allowance message we
  sent (lists and confirmations don't count), an execution claim, a
  ledger occurrence or association, or a retrieved receipt, because those
  records name only ids the peer could reuse with other terms.
  `forgetPeer` then returns `'kept'` and the page says, as a Graphite
  note (a normal outcome, not an error), that you have requests, payments
  or automatic payments together, so that history is kept and they stay
  blocked. Between the two demo phones, which have requested and answered
  each other, Forget is always refused; that is what was checked.

The seal's closing animation plays when a seal's ring goes from linking to
linked while it is on screen. The second person to add the other often
completes the handshake inside the Add call, so Add person marks the key
(`justAdded.ts`) and the Person page starts that seal from the dashed ring.

### Private payments

`src/paykit/privatePayments.ts` registers two round hooks
(`registerPrivatePaymentHooks`, called by `PaykitService.connect`):

- **`private-payment-lists`** shares our list with every contact whose link
  is Linked. The list is that contact's own Bitcoin account address plus the
  shared USD₮ (EVM account 0) address, built by
  `reservationInputsFor(addressCache, peer)` and sent with
  `syncPrivatePaymentListsWithReservationsAndProcessOutbound(updates, false)`.
  `planPrivateListShares` (pure) skips a contact whose addresses are not
  all derived yet (never a partial or empty list: a new list replaces the
  old one), refuses a list that would not fit in one 1000-byte private
  message, and sends again only when the list or the link changes. "The
  link changed" is the pair of recovery attempt ids in the link record,
  which name the link's stream generation, so a re-formed link gets the
  list again. `clearUnlistedLinkedPeers` is false, so a contact skipped
  this round keeps the list they have. When a missing address is derived,
  the address cache change flushes the loop.
- **`received-private-lists`** reads what each Linked contact shared with
  `currentPrivatePaymentLists` when they sent us something this round, on
  first sight, or every five minutes. Payloads go through our own endpoint
  parser before anything is shown or paid.

Both hooks write to `service.privateLists` (memory only), which the Person
page ("Private addresses shared with you" / "Your private addresses shared
with them"), You > Network details and activity attribution read.

Paying: the Send screen's pubky field asks `privatePaymentAddressesFor`
first. For a Linked contact it calls
`prepareAndResolvePrivateContactPayment(peer, undefined, undefined, steps)`,
which advances the link, drains private messages for that one peer and
resolves only their Private Payment List through the adapter's private
select/build callbacks. It never falls back to public endpoints; the app
does, when the result is not Payable (or both the prepare call and the
local-only `resolvePrivateContactPayment` fail). Each endpoint must belong
to that pubky and parse as one of ours. Notes from the Rust side:

- resolving makes no reservation or claim, it only reads;
- `afterPrivatePaymentListVersion` lets a payer refuse a list it already
  used, for payees with single-use addresses; our addresses are stable and
  reusable, so the app passes undefined;
- `recordPaymentOutcome` belongs to Allowance accounting
  (reserve / begin / record), not to paying a list, so it is not called.

Only Bitcoin is private. The list's USD₮ address is EVM account 0, the
same address everyone pays, and the words say so: the payee card says
"Ben shared a Bitcoin address only with you, and their USD₮ address,
which is the same for everyone"; Review says "A Bitcoin address Ben
shared only with you" or "Ben's USD₮ address. It is the same one everyone
pays, so this payment is not private" (`personWords.ts`).

Receiving: BTC a contact pays privately lands in their Bitcoin account on
our side, which Send does not spend from. The Wallet tab shows "Plus … from
contacts. Collect it to spend it" under the BTC balance (linking to You >
Bitcoin from contacts), and the Person page has the same Collect row.

Activity with people: `ContactAccountWatchers` (on the Wallet tab) renders
one watcher per contact account (WDK's account hooks are bound to one
index each), which merges that account's transfers into `useActivity`;
`collapseInternalMoves` shows a Collect once. `activityPersonFor` (pure)
names the contact: a receive on their account ("Ben paid you"), a send to an
address they shared privately ("You paid Ben"), or a transaction linked to
a payment request (see "Payment requests"). Money arriving *from* an
address in Ben's list is not labelled as his: the list is only his claim,
and he could list anyone's address. An address two contacts both list
names neither. Bitcoin received on account 0 carries no sender, so it
stays "Received".

### Payment requests

A payment request is a conversation over the Encrypted Link: the payee
asks, the payer answers and pays, the payer proves it, the payee checks
the proof on chain and sends a receipt. Paykit carries every step as a
private Event Message (FIFO per direction, confirmed by delivery
confirmations, retried until confirmed) and keeps the records; the
wallets do the paying, the checking and the scheduling
(`specs/payment-requests.md`).

**The state machine.** The SDK derives each request's lifecycle from the
ordered events (`FfiPaymentRequestLifecycleState`):

```text
              payee: proposePaymentRequest
                          │
                          ▼
   ┌──────────────── Proposed ─────────── time passes proposal_expires_at ──▶ ProposalExpired
   │                      │                                                       │
   │ payer: reject        │ payer: claimAndAcceptPaymentRequest                   │ payer: reject
   ▼                      ▼                                                       ▼
Rejected        one-time: Accepted ── payer: submitPaymentProof ──▶ ProofSubmitted     Rejected
(terminal)      recurring: ActiveRecurring ── a proof per billing period; stays ActiveRecurring

   either side: cancelPaymentRequest from Proposed, ProposalExpired, Accepted,
   ActiveRecurring or ProofSubmitted ──▶ Canceled (terminal)
```

- Rejected and Canceled are terminal; a later acceptance cannot reopen
  them. A cancel and an acceptance that cross on the wire are both kept;
  the request stays Canceled.
- A proof after cancellation is still allowed for a payment that left
  before the payer saw the cancel (the spec's "irreversible boundary"),
  and it does not reopen the request. This app relies on that: a payment
  already broadcast always gets its proof.
- ProofSubmitted means a proof arrived, not that money settled. Recurring
  requests never reach it: each proof covers one billing period.
- RecoveryRequired and InvalidConflict are shown as "Reconnecting" and
  "Couldn't read this request".

Next to the SDK state, the app keeps its own facts apart and the
timeline (Requested -> Accepted -> Paid -> Verified -> Receipt,
`requestStatus.ts`) shows each one separately: whether our own event left
the outbound queue, our payment in flight (payer), our on-chain check
(payee), and the receipt. The payer never sees the payee's check; it
learns the payment was verified when the receipt arrives.

**Asking (payee).** Request money builds the terms (`requestTerms.ts`):
the amount as Paykit decimal text, a reference (`pkw-…`, copied into
every proof and receipt), how long the payer can accept, an optional
schedule, the one accepted rail, `required_app_id` = our app, a note in
`metadata`, and the exact address to pay, bound in `payment_endpoints`:
the payer's own contact Bitcoin account (an address only they have) or
our USD₮ address. Binding the address means the on-chain check compares
against the terms alone, not against whatever list we share later. The
proposal is one private message, so its size is checked against 1000
bytes before `proposePaymentRequest`. Only Linked contacts can be asked.

**Paying (payer)**, in the order the Rust SDK expects
(`requests.ts`, `PayRequestScreen`):

1. `claimPaymentRequestForPreparation`: take the request for this app.
   It is the current form of `claimPaymentRequestForExecution` (that one
   is kept for compatibility and does not refuse a blocked peer).
2. `prepareAndResolvePrivatePaymentRequest` (falls back to
   `resolvePrivatePaymentRequest` from saved state): the address the
   request allows. It must equal the address bound in the terms.
3. The Send review shows the amount and that address, locked, with
   WDK's fee. Without the balance (or ETH for gas) the screen stops here
   and says so.
4. On Pay: `claimAndAcceptPaymentRequest` if still Proposed and not yet
   accepted by us (claim and queue the acceptance in one transaction,
   naming the proposal the person saw), so the acceptance precedes the
   proof in our send order. Pay then waits, up to 20 s, until the
   acceptance has left the outbound queue, and refuses to accept within
   two minutes of the proposal's expiry. See "Acceptance and expiry"
   below for why.
5. The payment ledger: `reconcileAllowanceAccounting` once per install,
   and again after a backup restore (the ledger refuses every payment
   until the wallet attests its history; see below and "Backup and
   restore"), then `reserveManualPayment` (admits exactly this
   request, or this billing period, once) and `beginPaymentExecution`
   (issues the handoff). The attempt id goes into the request book
   before WDK sends.
6. WDK sends. The transaction hash goes into the book at once.
7. Bitcoin: `submitPaymentProof` right away. USD₮: the proof names the
   Transfer's position in the transaction receipt, so the round hook
   waits for the block, finds the log, has WDK sign the proof
   (`signTypedData`) and submits it.
8. `recordPaymentOutcome`: Succeeded once the transaction is confirmed,
   Failed when the send never left or reverted (the request can be paid
   again), Unknown when we cannot tell. Failed is recorded before the
   book entry is forgotten; if that ledger call fails, the entry stays as
   `not-sent` and the next round (or the next Pay) records it. A
   `beginPaymentExecution` that throws or is Blocked releases its attempt
   the same way.

`quotePaymentRequest` is not used: this app requests and pays the same
asset, so there is no conversion rate to agree on.

**No double payment.** A ref guards the Pay button; the ledger refuses a
second reserve for the same request or period while any attempt is not
Failed; the book records the attempt before the send and the hash right
after; a send whose outcome is unclear (`sendFailureFor` says
"unknown") is recorded as Unknown, which keeps the reservation, and the
review offers only "Close and check Activity". If the app stops after
the broadcast, the `payment-request-payments` round hook finds the
payment in the book and finishes it (proof, outcome) instead of anything
offering to pay again.

**Payments that lost their hash.** If the app stops between the handoff
and WDK's answer (book stage `sending`), or the send's outcome was
unclear (`unknown`), the book has no hash. After two minutes the round
hook looks for the payment in account 0's history
(`PaymentChain.findSentPayment`): a transfer of exactly the amount to the
request's address, after the payment started, that no other payment
uses. Found, it carries on as broadcast. Bitcoin's history comes from
Electrum and includes the mempool, so half an hour of empty searches
means it never left: Failed is recorded and the request can be paid
again. USD₮'s history comes from Blockscout, which can lag by hours, so a
missing USD₮ payment stays reserved ("May have been paid. Check
Activity") and the search goes on every five minutes.

**"Dropped" is not failed.** WDK's EVM `getTransaction` says `dropped`
when it finds the transaction but no receipt, and the sender's nonce has
moved past it. The public Sepolia RPC is load balanced, and a node that
lags on receipts says exactly that about a mined transaction. The payer
believes it only after an unbroken run of `dropped` answers for ten
minutes (at least ten checks); any other answer resets the run. The payee
keeps such a proof pending and checks it once a minute.

**Acceptance and expiry.** The payee's SDK judges an acceptance by when
it *fetches* it (`record_time` is the receive time), and one fetched
after `proposal_expires_at` makes the request InvalidConflict on its
side; later events are ignored, so a proof for it is never checked and no
receipt comes. The payer's SDK exposes no Delivery Confirmation, so the
payer can't know when the payee stored the acceptance. This app narrows
the gap three ways: Pay waits until the acceptance is published, refuses
to accept-and-pay within two minutes of expiry, and the review warns when
expiry is within fifteen minutes. Requests keep the expiry the person
chose (a recurring request's expiry is not cut to its schedule's end).
What remains: a payee whose app stays closed until after the expiry
still voids the request, after the payer has paid.

**Proofs and the payee's check** (`paymentProofs.ts`, the
`payment-request-proofs` round hook). Paykit leaves proof contents to
the wallets. This app uses:

- Bitcoin: `{"type":"bitcoin-onchain-tx","network":"mutinynet","txid":"…"}`.
  The payee reads that transaction from the payer's contact account with
  WDK `getTransfers` and requires at least the amount paid to the bound
  address, in a block.
- USD₮: the spec's `erc20-transfer-eip712` profile
  (`specs/erc20-payment-proofs.md`): chain id, transaction hash, receipt
  log index and an EIP-712 signature over the request binding (payer,
  payee, app, request id, reference, endpoint, billing period). Our USD₮
  address is public, so without the signature anyone could claim someone
  else's transfer. The payee reads the transaction with WDK
  `getTransaction`, requires success and a block, a Transfer of the USD₮
  contract to our address of at least the amount at that log, and
  recovers the signer (`src/wallet/erc20PaymentProof.ts`, checked against
  the spec's test vectors) to equal the Transfer's sender. It rebuilds the
  binding from the request it knows, never from the proof.
- Both: a recurring proof's period must be one of the schedule's and must
  have started; one transfer pays one request or period (the book keeps
  which); a missing, unconfirmed or `dropped` transaction is "pending",
  never "rejected".
- Both, the payment-time rule: the payment must be no older than the
  request (the time we proposed it, saved in the book) or than its
  billing period's start. Without it, any earlier transfer from the payer
  to that address that no request had claimed (a plain private Bitcoin
  send, an old USD₮ transfer to our public address) would pass once.
  Bitcoin uses the block's timestamp from Mutinynet's esplora (WDK's
  transfers carry only a height), with ten minutes' allowance for block
  timestamps and phone clocks. USD₮ uses an upper bound read through WDK:
  Sepolia makes at most one block per 12 s slot, so a transaction with n
  confirmations was mined at least (n-1) × 12 s ago; five minutes'
  allowance covers the phones' clocks. A proof after a cancellation is
  not rejected: the spec forbids rejecting a proof only because a
  cancellation came first, and the time bound can't tell "just before"
  from "just after" anyway.

**Receipts.** Once a payment checks out, the payee issues a receipt
(`issueReceipt` with a receipt id chosen and saved first, which makes it
retry-safe: it prepares the issuance, stores the encrypted receipt on our
homeserver and queues Receipt Access, the `prepareReceiptIssuance` +
`processReceiptIssuance` pair in one call). The payer's
`payment-request-receipts` hook reads `receiptAccess` when a contact sent
something (or every 30 s while a receipt is expected) and fetches each
new one with `retrieveReceipt`; retrieved receipts appear in
`observeState().receipts`.

**Recurring requests.** Paykit carries the schedule and runs no
scheduler. `recurrence.ts` derives the billing periods from the
immutable terms (anchor + k × every × unit, inside `starts_at` and
`ends_at`; this app proposes minute schedules with a number of
payments). Whether a period is on the schedule is worked out from its
index k, so period 500 of an endless schedule from another wallet is as
payable and checkable as period 1; only lists stop at 120. The schedule
starts when the request is sent, not when it is accepted, so a payer who
accepts late finds the missed periods due at once (the Request money
screen says so). The payer sees started periods without a payment as
due and pays each with a tap, or the wallet pays them under an Allowance
(see "Automatic payments"); "Not now" records `deferPaymentOccurrence`,
and the row then says "put off for now" (automatic payment skips it
too). Either side can cancel to stop future
payments.

**Round hooks** (`requestRounds.ts`) are cheap and idempotent: they read
the last observed state and the book, call the SDK or WDK only for work
that is due, and check what is already done before each step. WDK
reaches them through a `PaymentChain` that `PaymentChainBridge` attaches
from React (WDK's API is hooks bound to one account each).

**Activity.** `useRequestLinks` (`requestLinks.ts`) maps transaction
hashes to requests, and the row then names the person. A hash is public,
so a proof naming one proves nothing: links come only from our own
payments (proofs we sent, payments in flight) and from payments to us
whose proof our check verified, and no link replaces another. A proof
still being checked, or one that didn't check out, shows on the request
page only. Rows say "Paid Ana's request" or "Receipt from Ana" (payee:
"Paid your request, receipt sent"), and Activity detail links to the
request and its receipt.

**Removing or blocking a contact** ends the link and drops its queued
messages, so `removeContact` and `blockPeer` refuse while a proof of our
payment to them has not left (`paymentsWithUndeliveredProof`).

**Demo simplifications**, each a decision a production wallet would
make differently:

- The ledger is reconciled with an empty history on first use. On a
  fresh install that is true (only this module pays requests, and the
  ledger keeps every attempt), and an empty history never erases what the
  SDK holds. After a backup restore it is not: payments made after the
  backup are missing. There the attestation is the person's (a Pay tap
  after the request page warned them to check Activity, or resuming
  automatic payments), never the background hook's, and restored
  requests are never paid automatically (`restoreReview.ts`; see "Backup
  and restore"). A production wallet would attest its complete payment
  records, rebuilt from chain history.
- One confirmation is enough (Mutinynet blocks come every 30 s, Sepolia
  every 12 s). Reorgs are not handled.
- A payment made after the request, to its address, for something else
  (a plain private send of at least the amount) can still be claimed as
  its proof once. The time rule only rules out older ones.
- `signTypedData` is allowed in `wdk.config.js` for the app to call; the
  app only ever signs the proof domain (`isErc20PaymentTypedData`).

### Automatic payments (Allowances)

An Allowance (`specs/allowances.md`) is private, scoped authority from an
Allower (the payer, who keeps the money) to an Allowee (the payee, who
sends requests): with an accepted one, the Allower's wallet may accept
and pay the Allowee's qualifying payment requests without a tap each.
It does not schedule anything and is never named in a request; the
payer's wallet picks it.

**Who proposes, and the lifecycle** (`allowances.ts`). Either side may
propose; authority exists only once the other side accepts. This app
proposes as the payer: Person > Automatic payments > "Set up automatic
payments" (`AutomaticPaymentsScreen`) sends `proposeAllowance(peer,
Allower, terms)`. The payee's Person page shows "Ana offers to pay your
requests automatically" with Accept (`acceptAllowance`, naming the
proposal's stream item, so terms that changed after the person read them
are refused) or Decline (`rejectAllowance`). A proposal from another
wallet that asks to be paid (it proposes as Allowee) shows the same way on
the payer's side. Either side can end it at any time (`endAllowance`,
which also withdraws our own proposal); the SDK derives Proposed,
Accepted, Rejected, Ended or Conflicted from the private Event Messages.
Terms are immutable: to change them, end it and offer again.

**The limits model and the demo defaults** (`allowanceTerms.ts`). Every
rule applies together: exact asset; a per-payment range; any number of
period limits, each an amount and/or a count over a rolling or anchored
period; a lifetime amount; a start and an end; the allowed payment
methods. Terms need at least one money ceiling or an end. This app
offers: up to a chosen amount per payment (1, 5 or 10 USD₮; 1,000,
5,000 or 10,000 sats) and at least a tenth of it, at most 10 payments
and 4 payments' worth in any rolling hour, 10 payments' worth in all,
only our payment method for the asset, ending after 1 hour, 1 day or
1 week. The summary reads, for 5 USD₮: "From 0.50 USD₮ to 5.00 USD₮ a
payment. At most 10 payments and 20.00 USD₮ an hour. 50.00 USD₮ in all.
Until …". The Person page shows the limits and, to the payer, what has
been used against them (`allowanceUsage`, from the payment ledger's
automatic attempts: committed and still-reserved ones count, failed
ones don't).

**Network fees.** No limit counts fees, which the payer pays on top of
each payment (for USD₮, in ETH). The floor of a tenth of the per-payment
limit, with the total, bounds an Allowance to at most 100 payments, so a
payee can't make the payer pay a fee for many tiny requests. And the
hook leaves a payment for the person when its fee is out of proportion
(`automaticFeeProblem`): over 5,000 sats or 0.0005 ETH of gas, or, for
Bitcoin, more than half the amount.

**Offers the other side wrote.** A contact can ask to be paid
automatically under limits they wrote (they propose as the Allowee).
Accept is not offered for limits this wallet can't read or that have
ended, nor, when we would pay, for limits without both a per-payment
and a total ceiling, or above this wallet's caps (ten times its largest
per-payment choice, per payment and in all: `acceptProblem`); the page
says why instead. Accepting as the payer asks first and repeats every
limit, and a missing ceiling reads "No limit …". The offer screen (also
reachable by the `automatic-payments` deep link) refuses a second offer
while one is accepted or open: two accepted Allowances would each have
their own limits.

**Paying automatically** (`automaticPayments.ts`, the
`automatic-payments` round hook, after the payment request hooks). For
each request from a contact we have an accepted Allowance with:

1. Still proposed and statically covered (`allowanceCovers`: asset,
   amount, method, not ended), with at least two minutes before it
   expires: `claimPaymentRequestForPreparation`, then
   `evaluateAllowanceCandidates` (the SDK's own matching, time and
   lifecycle checks), then the bound address (the same
   `resolveRequestAddress` as Pay), WDK's fee and the balance
   (`PaymentChain.quoteSend`). If the wallet can't pay now, the request
   is left for the person: nothing is accepted automatically. Otherwise
   `acceptPaymentRequestAutomatically` persists the choice and queues the
   ordinary acceptance in one transaction (for a one-time request the SDK
   also checks the limits here; for a recurring one at each payment).
2. Accepted (one-time) or active (recurring), with that Allowance chosen
   in the ledger, once our acceptance has left the outbound queue before
   the request expired (`acceptanceTiming.ts`: the hook watches every
   acceptance each round and keeps the final answer in the app store; the
   payee ignores a proof for a request whose acceptance arrived after its
   expiry, so a late one is left for the person with a note): the
   one-time payment, or the oldest started billing period that has no
   proof, no book entry, no live ledger attempt, isn't manual-only and
   wasn't put off. Claim, resolve, quote again, then
   `reserveAutomaticPayment` (the ledger admits this occurrence under the
   Allowance and its limits, atomically with its usage and time
   watermark) and `beginPaymentExecution` (rechecks the request and the
   Allowance right before the money moves and issues the handoff). The
   book records the attempt (with the Allowance id), WDK sends
   (`PaymentChain.send`), and `finishPayment` carries on exactly as for a
   manual payment: the proof (which names the Allowance, the spec's
   optional attribution), the USD₮ proof after its block, the outcome.

At most one such step per round, so rounds stay short. A step that can't
go ahead is noted per request or period (memory only) and tried again
after a minute (the wallet) or two (the SDK or the ledger said no). The
request page (`AutomaticPaymentNote`) says what actually happened, from
the ledger: "Within your limits for automatic payments: it is accepted
and paid in a moment" (proposed and covered), "Accepted automatically.
It is paid in a moment." (accepted, no payment yet), "Paid
automatically, within your limits for Ben." (an automatic payment is
recorded), "Paid automatically within your limits for Ben as payments
come due." (recurring), "Outside the amount you allowed for one
automatic payment, so it waits for you.", or, when the Allowance ended
and something is still due, "Pay what is due yourself". Why the last try
stopped is a second line ("Couldn't pay it automatically. Not enough
USD₮. …", "Not paid automatically. It would go over your hourly limit
for automatic payments. You can pay it yourself."). The payee's page
says "Ana pays requests like this automatically". Payment words, request rows and
Activity say "Paid automatically" for payments made under an Allowance:
the payer from its own book, the payee from a verified proof that names
one (informational only; it decides nothing).

**No double payment.** Automatic and manual payments share the SDK's
one ledger and the wallet's one request book. Any manual answer (accept,
decline, cancel, Pay) marks the request or period manual-only in the
ledger (the SDK does this inside those calls), and the hook never
touches it again, as the spec requires. A manual payment in flight makes
`reserveAutomaticPayment` say `PaymentAlreadyRecorded`, and the other way
round. A reservation that got no handoff is released (Failed), or left
as a `not-sent` book entry for the payment hook to release if that call
fails. Ending an Allowance, a cancel, or a blocked peer stops the next
payment at `reserveAutomaticPayment` or `beginPaymentExecution`; a
payment already sent still gets its proof. After a backup restore, the
requests that came back are never paid automatically, and nothing is
until the person resumes automatic payments (see "Backup and restore").

**Demo simplifications.** Trusted time is the phone's clock (a
production wallet would use a time source it trusts; the SDK's watermark
still refuses to go back in time). Local enablement is the accepted
Allowance plus a funded wallet; there is no extra per-device switch.
Candidate priority is "the first eligible one the SDK lists".
Reassociating a recurring request with another Allowance
(`authorizeAllowanceReassociation`) and `markPaymentManualOnly` are not
used.

### Backup and restore

The recovery phrase brings back the money (WDK derives every account
from it) and the identity (Paykit derives the Pubky key from it). It
can't bring back what lives only on this phone: the Paykit SDK state
(contacts and labels, Encrypted Links, Private Payment Lists, requests,
proofs, receipts, Allowances, the payment ledger) and the app's own
records about it (each contact's Bitcoin account index, the request
book, the public endpoint switches). `backup.ts` backs those up.

**Which call, and is it encrypted?** `exportBackupString` is
`exportBackupState`'s bytes as hex; the SDK encrypts neither, and the
state holds secrets (link keys, receipt keys). So the app seals it
(`backupCrypto.ts`): the key is HKDF-SHA256 over the Pubky identity
secret that Paykit derives from the recovery phrase (salt
`paykit-wdk-wallet backup`, info `backup encryption key v1`), the cipher
XChaCha20-Poly1305 (`@noble/ciphers`) with a random 24-byte nonce, and
the text is `pkwbackup1:` plus hex. Inside is a JSON envelope: the SDK
backup, the three app store entries, the identity and the time. **The
recovery phrase alone opens it**, but the person must keep the backup
text itself (Copy or Share it to Files, a note, AirDrop): this app has no
way to store a file on the homeserver. The app never stores, logs or
shows it.

**You > Contacts and requests backup** (`BackupSection.tsx`): "Back up
contacts and requests", then Copy or Share; when the last backup was
made here and whether anything changed since (`backupStateRevision`, a
fingerprint of what a backup would hold, compared with the one at the
last backup). A backup counts as made only once it was kept
(`recordBackupKept`): on Copy, or a Share that iOS confirms. Android's
share sheet reports success even when it was dismissed, so there the
page says it can't tell and offers "I saved it". The revisions
themselves are developer detail and show only in Network details.
`observedBackupStateRevision` is for the SDK's shared-state storage mode
only; with on-phone storage it returns nothing (Network details shows
both).

**Checking a backup** ("Check a copied backup", `checkBackup`): opens the
backup with this phrase and restores it into a throwaway SDK handle
(`PaykitService.inScratchState`: an in-memory state store, a session
provider wrapping the live session so nothing can drop it, no payment
adapter, no sync loop, run in this service's call queue and released
after), then counts its contacts, requests and receipts. Nothing on the
phone changes. This is how the round trip was verified on both demo
identities without wiping them.

**Restoring** happens in onboarding, on the sign-in step of a restored
wallet: "Paste a backup". `PaykitService.connect({ restoreBackup })`
opens it before building anything (a wrong paste fails at once with
"made with another recovery phrase, or it is damaged"), then right after
`initialize` and before the sync loop or `setUpIdentity` write anything,
`restoreBackupString(…, RequireRecovery)`, then the app entries, then the
address cache reloads. The SDK restores only into a state that is empty
apart from the identity; on a phone that already has this identity's
contacts or requests it refuses, and the screen says so. RequireRecovery,
never Resume: a backup may be older than the last message this identity
sent, and resuming a link from a stale snapshot would reuse a transport
key and nonce. Every linked contact comes back as "Reconnecting
privately…" and the sync loop forms a fresh link (messages the backup
had not received are not read from the old link). Ready then says what
was restored. If publishing the payment keys fails after the restore,
Sign in retries only that step on the same connection; the pasted
backup is dropped once restored, so it is never restored twice. The
SDK's two refusals (state already on the phone, or other SDK work in
progress) get their own sentences.

**A restore can't be trusted for automatic payments.** A backup is a
snapshot: anything paid after it was made is missing from what comes
back (the request's proof, the request book entry, the ledger's attempt
and the Allowance's usage), and the payee's events this phone had
already confirmed are not sent again on the new link. A restored request
can look unpaid when it was paid, and a restored Allowance less used
than it is. The SDK requires the ledger to be reconciled after every
restore, and the Allowances spec says restored execution state stays
ineligible until the wallet has established that no later payment is
missing. This wallet can't prove that from chain history, so
`connect({ restoreBackup })` writes a restore review
(`restoreReview.ts`, app store `restore-review-v1`):

- every payer request that came back is never paid automatically; its
  request page says to check Activity before paying it by hand;
- if the backup held Allowances we pay under, no automatic payment is
  made until the person checks Activity and taps "Resume automatic
  payments" in You > Contacts and requests backup (after a confirmation
  that says the limits count only the payments in the backup). The
  Person page and Ready say so. `ensureLedgerReady(service,
  'automatic')` refuses while paused, so only a person's Pay or Resume
  attests the ledger after a restore.

Not exercised on a device: the onboarding restore itself, because it
needs an install with no state for the identity, which means wiping one
of the demo identities. The same SDK call, on the same backup, runs in
the check above.

**Key rotation** (`rotatePaykitIdentityKey`) is not used and was not
tried on the demo identities: it moves the identity to a new Paykit key
generation, both sides must link again, and the session provider must
hand the SDK the new key from then on.

### How features plug in

- Round hooks are registered in `registerPrivatePaymentHooks`,
  `registerPaymentRequestHooks` and `registerAllowanceHooks`.
  `PaykitService.connect` calls each once per service, before the loop
  starts, so a feature wires its background work without editing the
  service or the provider.
- Screens live in their own `src/features/<feature>` folder. Shared
  layers (`src/ui`, `src/wallet`, `src/paykit`, `src/navigation`) hold
  what more than one feature needs.

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

There are two fields, `AddressRecipientField` and `PubkyRecipientField`
(see "Paying a person by pubky"); the compose step switches between them
with "A person (pubky)" / "An address", opens on Person when the `to`
param is a pubky, and switches to Person when a pubky is pasted into the
address field. For a Linked contact the pubky field gets
`privatePaymentAddressesFor` first (`route: 'private'`). Review shows a
person's seal, name and the address paid (`send/PersonRecipient.tsx`).

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
| Contacts, labels, links, received Private Payment Lists | Paykit SDK state | Labels never leave the phone. |
| What we shared / received, for display | Memory only (`service.privateLists`) | Rebuilt by the sync loop within a few rounds after a restart. |
| Payment requests, proofs, receipts, the payment ledger | Paykit SDK state | Records are not redacted in JS: never log them. |
| Request book (payments in flight, proof checks, claimed transfers, deferred periods) | Encrypted MMKV `paykit-app-<id>` (`payment-requests-v1`) | What the wallet must remember to never pay twice and to finish after a restart. Automatic payments carry their Allowance id. |
| Allowances and the payment ledger (usage, associations, watermarks) | Paykit SDK state | Read for display into memory (`allowances.ts`); never logged. |
| Why an automatic payment didn't go ahead | Memory only | Rebuilt by the next try. |
| When the last backup was kept, and its revision | Encrypted MMKV `paykit-app-<id>` (`backup-meta-v1`) | Written on Copy or a confirmed Share, not when the backup is sealed. Not in the backup itself. |
| Allowances stopped on this phone (blocked or removed peers) | Encrypted MMKV `paykit-app-<id>` (`stopped-allowances-v1`) | Never paid under again. Travels with backups. |
| Whether each acceptance left before its request expired | Encrypted MMKV `paykit-app-<id>` (`acceptance-timing-v1`) | Final answers only; the automatic payment hook watches the rest each round. |
| What a restore left to check | Encrypted MMKV `paykit-app-<id>` (`restore-review-v1`) | Requests that came back (paid by hand) and whether automatic payments are paused. Not in backups. |
| The backup text | Nowhere | Held in memory until it is copied or shared, or the app leaves the foreground. Sealed with a key from the recovery phrase. |
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
when the app leaves the foreground), never copy it to the clipboard and
never log it. Restore's Paste empties the clipboard after reading a
phrase from it.

While the phrase is on screen, while Restore's phrase field holds any
words, and while a sealed backup waits to be copied, the app blocks
screen capture natively (`useScreenCaptureBlock`, expo-screen-capture
55.0.18): `FLAG_SECURE` on Android (screenshots and recordings come out
black, the recents thumbnail is blank) and, on iOS, a secure layer that
blanks screenshots and recordings plus a blur over the app-switcher
snapshot. iOS can't refuse a screenshot; it just captures nothing
readable. The protection is lifted only once the app is in front again,
so it can't race the snapshot the OS takes on the way out. Checked on
the Android release build: with a backup held, the app's window carries
`FLAG_SECURE`, and it is gone once the backup is copied. Not checkable
on the iOS simulator: `simctl io screenshot` reads the framebuffer, not
the system screenshot path, so it still shows the screen.

Device backups: Android's `allowBackup` is false (app.json). On iOS,
`plugins/withMmkvBackupExclusion.js` sets `NSURLIsExcludedFromBackupKey`
on `Documents/mmkv` at every launch, which covers every MMKV file there
(Apple: excluding a directory excludes its contents). The files are
encrypted with a Keychain key that is `THIS_DEVICE_ONLY`, so a backed-up
copy could never be opened elsewhere anyway; excluding them keeps stale
ciphertext of private records out of iCloud. Not done: Android 12+
device-to-device transfer, which `allowBackup="false"` does not stop
(it needs `dataExtractionRules`); the transferred files would be
unreadable without the Keystore key.

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
- Release builds (README, "Release builds") bundle the JavaScript, so a
  code change needs a new native build to reach them; use the dev client
  while developing.
- One SDK handle per identity: always go through `usePaykit()`.
- Amounts are `bigint` until they are formatted for display.
