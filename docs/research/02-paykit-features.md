# 02 — Paykit feature surface (FFI / React Native) and domain model

Research for the WDK + Paykit example wallet. Source of truth: paykit-rs PR #204,
branch `feat/react-native-bindings`, pinned head
`23c702c8f75c7bc211b2deaaaafbcac6f33f15d1` (read from a scratch clone; nothing
was modified).

Files read: `README.md`, `THESAURUS.md`, `CHANGELOG.md`, `docs/*`, `specs/*`
(`paykit-sdk.md`, `paykit-sdk-bindings.md`, `payment-requests.md`,
`payment-conversion.md`, `payment-endpoint-identifier.md`, `allowances.md`,
`erc20-payment-proofs.md`), `skills/paykit/**`, every non-test file in
`paykit-ffi/src/**`, the parts of `paykit-sdk/src/**` and `paykit-lib/src/**`
needed for semantics, and `paykit-react-native/{README.md,package.json,src,example/**}`.

## 0. TL;DR for the plan

- The React Native package is `@synonymdev/react-native-paykit` **0.1.0**
  (FFI crate `paykit-ffi` 0.1.1-rc1, UniFFI 0.29.4, `uniffi-bindgen-react-native`
  `0.29.3-1`). It is **not on npm** (`npm view` returns 404 on 2026-10-26), so we
  must build it from the pinned commit (fetched from GitHub, not a local checkout).
- **Generated TypeScript is not committed** (`src/generated/`, `cpp/generated/`
  are gitignored). The TS API is a mechanical mirror of the Rust `#[uniffi::export]`
  surface: methods become camelCase, types **keep the `Ffi` prefix**
  (`FfiPaykitSdk`, `FfiSdkPaymentAdapter`...), async Rust methods return Promises,
  errors are thrown as `PaykitFfiError` tagged classes. The example app's
  `example/src/smoke.ts` confirms these conventions.
- The FFI exposes essentially the **whole SDK runtime**: comparing every
  `pub async fn` in `paykit-sdk/src/runtime/**` with the FFI, only 4 internal
  helpers are missing (`allowance_record`, `enqueue_private_payment_list_with_reservations`,
  `propose_payment_request_with_id`, `submit_payment_proof_submission`).
- Paykit does **not** execute payments, choose a final endpoint, run schedulers,
  or verify settlement. WDK does all of that. Paykit gives: identity-wide app
  registry, public endpoints, profiles, contacts, Encrypted Links, private
  per-contact payment lists, payment requests (one-time + recurring),
  conversion rates/quotes, payment proofs, encrypted receipts, allowances with
  accounting, backup/restore, key rotation.
- **Any Payment Endpoint Identifier is allowed** as long as it is path-safe
  (`[A-Za-z0-9_.-]`, max 64 chars, not `private`). Recommended convention is
  `{asset}-{rail}-{format}`, lowercase. Payloads are opaque UTF-8 (max 64 KiB
  public; every private message incl. a whole Private Payment List must fit in
  **1000 bytes**). Spec examples already include `usdt-ethereum-address`,
  `usdt-tron-address`, `usdc-solana-address`, and the ERC-20 proof profile uses
  `usdt-arbitrum-address`. So BTC + an EVM USDT rail are first-class fits.
- **No push and no background service**: everything is pull. Both apps must run
  a foreground sync loop (`receivePrivateMessagesFromLinkedPeers`,
  `processPendingPrivateMessages`, `ensureLinkWithPeer` for `Linking` peers).
  Two foregrounded apps on two simulators are fine.
- **Callbacks are synchronous on the JS thread**. WDK calls are async, so the
  payment adapter must answer from precomputed in-memory state, and the state
  blob store must be synchronous + encrypted (MMKV with an encryption key, not
  AsyncStorage). Prefer the explicit-input SDK calls
  (`syncPublicEndpointsWithReceivingDetails`,
  `syncPrivatePaymentListsWithReservationsAndProcessOutbound`) so publication
  does not depend on callbacks.
- **Becoming contacts requires both sides to know each other's pubky key** and
  both call `ensureLinkWithPeer(other)`; the SDK picks initiator/responder
  deterministically (lexicographic key order). There is no "incoming contact
  request" discovery API. On simulators, exchange keys by copy/paste (host
  clipboard) or deep link, not camera QR.

## 1. Domain model

```text
Pubky identity (Ed25519 keypair, "pubky..." public key)
 ├─ Pubky session/grant on a homeserver (staging: ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy)
 ├─ Paykit Identity Secret, generation g (derived from the Pubky secret; rotatable)
 │    └─ derives Noise routing key + X25519 static key + shared-state encryption key
 ├─ PUBLIC (homeserver /pub/...)
 │    ├─ /pub/paykit-authority/v0/current-key.json   Paykit Noise Key Authorization (identity-signed)
 │    ├─ /pub/paykit/v0/app-registry.json            App Registry: apps{app_id: display_name, capabilities},
 │    │                                              key_generation, noise_public_key, default app prefs
 │    ├─ /pub/paykit/v0/apps/{app_id}/endpoints/{identifier}   Public Payment Endpoints (payload per identifier)
 │    ├─ /pub/paykit/profile.json                    Paykit Profile (display_name, image_uri, extra JSON)
 │    ├─ /pub/paykit/blobs/...                       Paykit Blobs (avatar etc.)
 │    ├─ /pub/paykit/contacts/...                    optional Public Contact Markers
 │    ├─ /pub/paykit/v0/private/...                  Noise handshake/message slots (encrypted) + recovery markers
 │    └─ (read-only) /pub/pubky.app/profile.json, /pub/pubky.app/follows/
 └─ PRIVATE SDK STATE (one opaque blob per identity: our MMKV, or Pubky shared state)
      ├─ IdentityState
      ├─ Contact Records (pubky key, label, cached profile, marker status)
      ├─ Linked Peers (state: NotLinked/Linking/Linked/RecoveryRequired/Blocked) + pinned peer key auth
      ├─ Encrypted Link snapshots / handshake snapshots (one link per identity pair, shared by all apps)
      ├─ Private stream items (raw inbound messages, in send order) + Event ID dedupe
      ├─ Outbound queue (Private Application Messages + Delivery Confirmations)
      ├─ Private Payment List views (latest-state per counterparty per app) + Endpoint Reservations
      ├─ Payment Request records (derived from events: proposal, acceptance, rejection, cancellation,
      │                           conversion quotes, proofs, execution claim)
      ├─ Allowance records + Allowance accounting ledger (associations, occurrences, attempts, watermarks)
      ├─ Receipt issuance records, Receipt Access records, decrypted Receipt records (+ decryption keys)
      └─ Public endpoint publication records
```

Key concepts (from `THESAURUS.md`):

- **Paykit App / App ID**: one app participating in an identity (ours: e.g.
  `wdk-paykit-demo`). It scopes public endpoints and attributes private
  messages. It does **not** own a separate link or stream.
- **Payment Endpoint** = Payment Endpoint Identifier + Payment Endpoint Payload.
  **Payment List** = set of endpoints (public, or private per counterparty).
- **Encrypted Link**: Noise (`pubky-noise`) channel between two identities,
  carried over homeserver files. All private traffic (lists, requests,
  allowances, receipt access, delivery confirmations) flows over it.
- **Latest-State Message** (Private Payment List: newest valid supersedes, per
  app) vs **Event Message** (requests, proofs, allowances, receipt access:
  every one matters, FIFO per direction, `event_id` UUIDv4, deduped, confirmed
  by Delivery Confirmations the SDK sends on its own).
- **Payment Request**: payee-initiated, one-time or recurring ("Subscription" is
  only product shorthand for an accepted recurring request).
- **Payment Proof**: payer-sent, method-specific opaque JSON.
- **Receipt**: payee-issued, encrypted at a Receipt Location on the issuer's
  homeserver; **Receipt Access** (event) gives the counterparty the key.
- **Allowance**: Allower-granted, scoped authority letting the Allower's wallet
  auto-pay qualifying Payment Requests from the Allowee.

## 2. TypeScript surface conventions (inferred; generated TS not committed)

| Rust | TS (ubrn) | Evidence |
| --- | --- | --- |
| `FfiPaykitSdk::with_payment_adapter_and_pubky_client_config` | `FfiPaykitSdk.withPaymentAdapterAndPubkyClientConfig(...)` (static) | `smoke.ts` |
| `pub async fn` | returns `Promise<T>` | `smoke.ts` |
| `Option<T>` | `T \| undefined` | `smoke.ts` passes `undefined` |
| `Vec<u8>` | `ArrayBuffer` | `stateBlobStore.ts` (`exportBytes().slice(0)`) |
| `HashMap<String,String>` | `Map<string,string>` | `mockWallet.ts` (`new Map(...)`) |
| `u32` | `number` | `maxAdvanceSteps` |
| `u64` | `bigint` (**unverified**, standard ubrn mapping) | `proposalStreamItemId`, `privatePaymentListVersion`, `generation` |
| `uniffi::Record` | plain object, camelCase fields | `smoke.ts` (`{ amount: { value, asset }, ... }`) |
| `uniffi::Object` | class instance (`new FfiPaymentPayload(text)`) | `mockWallet.ts` |
| flat enum | TS enum (`FfiLinkedPeerState.Linked`) | `smoke.ts` |
| enum with fields | `new FfiPaymentDeadline.At({ timestamp })` style (**unverified**; same shape as `new PaykitFfiError.ConcurrentUpdate({code, context})` in `stateBlobStore.ts`) | |
| `#[uniffi::export(with_foreign)] trait` | TS interface you `implements` (`FfiSdkPaymentAdapter`) | `mockWallet.ts` |
| `PaykitFfiError` | thrown; `PaykitFfiError.instanceOf(e)`, `e.tag` (`PaykitFfiError_Tags.*`), `e.inner.code` | `smoke.ts` |

Error tags (`paykit-ffi/src/errors.rs`), each `{ code: string, context: string }`:
`ConcurrentUpdate`, `Storage`, `Identity`, `Transport`, `NotFound`, `Protocol`,
`Policy`, `PaymentAdapter`, `RecoveryRequired`, `SharedStateBusy`. Per-peer batch
reports carry `FfiPrivateOperationError` objects with `category()`, `code()`,
`redactedContext()`, `exportDebugDetails()` (sensitive).

Security note: TS records are **not redacted** (Swift/Kotlin override
`toString`; JS cannot). The package README lists ~70 record types that must not
be logged (payment requests, contact records, targets, receipts, allowance
terms...). Our app should have a lint rule / logger wrapper that never logs
Paykit records.

## 3. Feature catalogue (what we can demo)

Signatures are the TS names with Rust types (TS mapping per §2). All `FfiPaykitSdk`
methods below are `async` unless marked "sync". `counterparty`/`publicKey`
params accept raw z32 or `pubky...`; returned keys are `pubky...`.

### 3.1 Bootstrap, keys, sessions (module functions + `FfiPubkySessionBootstrap`)

File: `paykit-ffi/src/session.rs`, `secrets.rs`, `config.rs`.

| API | Signature | Demo idea |
| --- | --- | --- |
| `pubkySecretKeyFromBip39Mnemonic` (sync) | `(mnemonicPhrase: string) -> FfiPubkyLocalSecretKey` | **One mnemonic drives both WDK wallets and the Pubky identity.** Show "your pubky" on the seed screen. |
| `pubkySecretKeyFromBip39Seed` (sync) | `(seed: ArrayBuffer /*64 bytes*/) -> FfiPubkyLocalSecretKey` | Alternative if WDK hands us the seed. |
| `pubkyPublicKeyFromSecret` (sync) | `(FfiPubkyLocalSecretKey) -> string` | Display / QR. |
| `normalizePubkyPublicKey`, `rawPubkyPublicKey`, `redactedPubkyPublicKey` (sync) | `(string) -> string` | Validate pasted contact keys; short display form. |
| `defaultConfig` (sync) | `(appId: string) -> FfiPaykitSdkConfig {appId, endpointManagementScope: ManagedOnly, publicContactSharing: PrivateOnly}` | Set `publicContactSharing: Enabled` to demo public contact markers. |
| `defaultPubkyClientConfig` (sync) | `() -> FfiPubkyClientConfig {requestTimeoutSecs: 30, localTestnetHost?: string, authRelayUrl?: string}` | `localTestnetHost` only for a local stack. |
| `requiredSessionCapabilities` (sync) | `() -> "/pub/paykit/:rw"` | |
| `paykitAuthorizerSessionCapabilities` (sync) | `() -> "/pub/paykit/:rw,/pub/paykit-authority/v0/current-key.json:rw"` | **We need this one**: our app holds the root key and must publish the Noise key authorization. |
| `new FfiPubkySessionBootstrap(clientId)` / `.withPubkyClientConfig(clientId, cfg)` | constructor | |
| `bootstrap.signUp` | `(localSecretKey, homeserverPublicKey: string, signupCode?: string, requiredCapabilities: string) -> FfiPubkySessionBootstrapResult {sessionAccess, publicKey, capability}` | First run on staging with a single-use invite token. |
| `bootstrap.signIn` | `(localSecretKey, requiredCapabilities) -> FfiPubkySessionBootstrapResult` | Every later launch. |
| `bootstrap.importSession` | `(sessionSecret: string, localSecretKey?, requiredCapabilities) -> ...Result` | Restore a persisted grant instead of signing in again. |
| `bootstrap.republishIdentity` | `(publicKey) -> boolean` | "Keep me discoverable" (rebroadcast PKARR record). Optional. |
| `bootstrap.startSignInAuth` / `startSignUpAuth` / `resumeAuth` / `approveAuth` / `approveAuthWithCompanionClaim`; `FfiPubkyAuthRequest.authorizationUrl/saveState/complete`; `parsePubkyAuthUrl` | Pubky Ring-style external-signer auth | Not needed (we hold the key). Could demo "approve a pubky auth QR" but skip for v1. |
| `FfiPubkySessionAccess` | `new(clientId, sessionSecret, localSecretKey?, paykitIdentitySecretKey?)`; `exportSessionSecret()`, `exportLocalSecretKey()`, `exportPaykitIdentitySecretKey()`, `clientId()` | Persist `exportSessionSecret()` in Keychain/Keystore if we want `importSession`. |
| `FfiPubkyLocalSecretKey` | `new(bytes)`, `exportBytes()`, `derivePaykitIdentitySecretKey(keyGeneration: u64)` | Key rotation (gen+1). |
| `FfiPaykitIdentitySecretKey` | `new(bytes, keyGeneration)`, `exportBytes()`, `keyGeneration()` | |
| `resolvePubkyUrl`, `parsePubkyResource` (sync) | `(uri) -> string / FfiPubkyResourceRef` | Render avatar URLs. |

Note on the mnemonic link (unverified security assessment): the Pubky secret is
the **first 32 bytes of the BIP39 seed** (`paykit-sdk/src/identity.rs`
`from_bip39_seed`), while BIP32 master keys come from HMAC-SHA512 over the whole
64-byte seed. That does not obviously expose the BIP32 keys, but it means a
leaked Pubky secret leaks half the seed. Fine for a testnet demo; call it out
in the docs.

### 3.2 SDK runtime lifecycle (`FfiPaykitSdk`)

File: `paykit-ffi/src/sdk.rs`.

| API | Signature | Demo idea |
| --- | --- | --- |
| Constructors | `new(stateStore, sessionProvider, config)`, `withPubkyClientConfig(...)`, `withPaymentAdapter(stateStore, sessionProvider, paymentAdapter, config)`, **`withPaymentAdapterAndPubkyClientConfig(stateStore, sessionProvider, paymentAdapter, config, pubkyClient)`**, `withPubkySharedState(sessionProvider, config)`, `withPubkySharedStateAndClientConfig`, `withPaymentAdapterAndPubkySharedState`, `withPaymentAdapterAndPubkySharedStateAndClientConfig` | Use callback storage (MMKV) + adapter. Shared-state mode needs Homeserver 0.16.2 with GCS on every instance (unverified for staging). |
| `initialize` | `() -> FfiIdentityStatus {publicKey?, capability}` | `capability` must be `PrivateLinkCapable` for private features. |
| `identityStatus` | `() -> FfiIdentityStatus?` | Gate UI. |
| `signOut` | `() -> FfiIdentityStatus` (revokes grant, keeps state) | Settings > Sign out. |
| `forgetSessionAccess` | `() -> FfiIdentityStatus` | |
| `config` (sync) | `() -> FfiPaykitSdkConfig` | |
| `stateRevision` (sync) | `() -> string?`; throws `SharedStateBusy/state_transaction_in_progress` if a transaction runs | |
| `backupStateRevision` | `() -> string` | Mark "backup dirty" indicator. |
| `observedBackupStateRevision` (sync) | `() -> {stateRevision, backupRevision}?` (shared-state mode only) | |
| `observeState` | `() -> FfiPaykitStateObservation {publicKey, keyGeneration, observedAt, contacts[], linkedPeers[], paymentRequests[], receipts[]}` | **One call to render the Home/Activity screen.** Display only, never for authorization. |
| `exportBackupString` / `exportBackupState` | `() -> string(hex) / FfiSdkBackupBlob` | "Export Paykit backup" (plaintext secrets! encrypt it). |
| `restoreBackupString` / `restoreBackupState` | `(backup, linkPolicy: FfiRestoredLinkPolicy.Resume\|RequireRecovery) -> FfiRestoreReport {..., recoveryRequiredPeers[]}` | "Restore on a fresh install" demo; use `RequireRecovery`, then `ensureLinkWithPeer` each listed peer. Requires empty store. |
| `recoverSharedStateFromBackup` | `(FfiSdkBackupBlob, replacementKey) -> FfiPaykitAppRegistry` | Shared-state mode only. Skip. |
| `encodeSdkStateBlobSnapshot` / `decodeSdkStateBlobSnapshot` (module, sync) | `(FfiSdkStateBlobSnapshot) -> ArrayBuffer` / reverse | Store blob + revision in **one** MMKV value (atomic). |

### 3.3 App Registry and Noise key authorization

File: `paykit-ffi/src/app_registry.rs`.

| API | Signature | Demo idea |
| --- | --- | --- |
| `publishPaykitNoiseKeyAuthorization` | `() -> FfiPaykitNoiseKeyAuthorization {owner, noisePublicKey, noiseStaticPublicKey, keyGeneration}` | Onboarding step; required before any private feature. Needs authorizer grant + root key. |
| `paykitNoiseKeyAuthorization` | `(publicKey) -> FfiPaykitNoiseKeyAuthorization` | Contact detail: "verified Paykit key, generation N". |
| `publishPaykitApp` | `(displayName, capabilities: FfiPaykitAppCapabilities {privatePayments, paymentRequests, receipts, outgoingPayments}) -> FfiPaykitAppRegistry` | Onboarding; set all four true. |
| `paykitAppRegistry` | `(publicKey) -> FfiPaykitAppRegistry? {keyGeneration, noisePublicKey?, apps[{appId, displayName, capabilities}], defaultAppId?, defaultAppsByEndpoint: Map}` | Contact detail: "uses: WDK Paykit Demo (private payments, requests, receipts)". |
| `setDefaultPaykitApp` | `(appId?) -> registry` | Optional. |
| `setDefaultPaykitAppForEndpoint` | `(identifier, appId?) -> registry` | Optional. |
| `paykitAppRemovalBlockers` | `() -> {activePaymentRequests, undeliveredPrivateEvents, incompleteReceiptIssuances, sharedPrivatePaymentLists}` (u64) | Settings "Leave Paykit" pre-check. |
| `removePaykitApp` | `() -> registry` | |
| `rotatePaykitIdentityKey` | `(replacementKey: FfiPaykitIdentitySecretKey) -> registry` | Advanced demo: rotate to gen+1, both peers then relink. Persist new key first; session provider must return the new key afterwards. Risky; stretch goal. |

### 3.4 Public Payment Endpoints ("directory")

Files: `payment_adapter.rs`, `payment_resolution.rs`.

| API | Signature | Demo idea |
| --- | --- | --- |
| `syncPublicEndpoints` | `() -> FfiEndpointSyncReport {published[], removed[], failed[]}` (calls adapter `currentPublicReceivingDetails`) | |
| `syncPublicEndpointsWithReceivingDetails` | `(details: FfiPublicReceivingDetail[] {identifier, payload: FfiPaymentPayload}) -> FfiEndpointSyncReport` | **Preferred**: "Publish my public addresses" toggles per chain. Empty array removes all managed endpoints. |
| `resolvePublicContactPayment` | `(counterparty, amount?: FfiPaymentAmountContext {value, asset}) -> FfiPublicContactPaymentResolution {status: Payable\|NoEndpoint\|UnsupportedEndpoint\|Unavailable, payableEndpoints[{counterparty, appId, identifier, payload, target}], failures[{appId, kind, context}]}` | "Pay any pubky" (not a contact) — paste a key, see their public BTC/USDT endpoints, pay. |
| `resolvePublicPaymentRequest` | `(counterparty, paymentRequestId) -> same` | Pay a request publicly. |

Privacy note in spec: public endpoints are visible to anyone; reuse is correlatable.
Good UX contrast: public = static address, private = per-contact address.

### 3.5 Profiles, blobs, Pubky reads

File: `paykit-ffi/src/profiles.rs`.

| API | Signature | Demo idea |
| --- | --- | --- |
| `publishPaykitProfile` | `(profile: FfiPaykitProfile {displayName?, imageUri?, extraJson?}, expectedRevision?) -> FfiPaykitProfileRecord {publicKey, profile, path, revision, updatedAt}` | Onboarding: name + avatar. `extraJson` could carry `{"wallet":"WDK","chains":["btc","usdt"]}`. |
| `fetchPaykitProfile` | `(publicKey) -> record?` | Get revision before update. |
| `deletePaykitProfile` | `(expectedRevision) -> void` | |
| `uploadProfileAvatar` | `(bytes: ArrayBuffer, contentType) -> FfiPaykitBlobRecord {publicKey, path, uri, sizeBytes, updatedAt}` | Use returned `uri` as `imageUri`. |
| `publishPaykitBlob` / `deletePaykitBlob` | `(blobName, bytes)` / `(uriOrPath)` | |
| `fetchPubkyFile` / `fetchPubkyFileBounded` (≤5 MiB) / `fetchPubkyText` | `(uri, maxBytes: u64) -> ArrayBuffer?/string?` | Load contact avatars. |
| `listPubkyDirectoryPage` | `(uri, cursor?, limit: u16) -> string[]` | |
| `fetchPubkyProfile` | `(publicKey) -> FfiPubkyProfileRecord? {profile: {name, bio?, image?, links[], status?}}` | Fallback display for pubky.app users. |
| `fetchPubkyFollows` | `(publicKey, maxEntries: u64) -> string[]` | "Import contacts from your Pubky follows". |
| `resolveProfile` | `(publicKey, allowPubkyProfileFallback: bool) -> FfiProfileResolution? {source, displayName?, imageUri?, paykitProfile?, pubkyProfile?}` | Contact row rendering. |
| `currentProfile` | `(allowPubkyProfileFallback) -> resolution?` | My profile header. |

### 3.6 Contacts

File: `paykit-ffi/src/profiles.rs`.

| API | Signature | Demo idea |
| --- | --- | --- |
| `saveContact` | `(update: FfiContactUpdate {publicKey, label?}) -> FfiContactRecord` | "Add contact" by pasted key / deep link. |
| `saveContacts` | `(updates[]) -> records[]` (atomic batch) | Bulk import. |
| `importContacts` | `(expectedIdentity, publicKeys[]) -> records[]` | Import from Pubky follows. |
| `saveContactsAndUnblockPeers` | `(updates[]) -> records[]` | "Unblock" flow. |
| `contactRecord` / `contactRecords` | `(publicKey) -> record?` / `() -> records[]` | Contact list. `FfiContactRecord {publicKey, label?, profile?, profileFetchedAt?, createdAt, updatedAt, publicContactMarkerStatus, ...}` |
| `refreshContactPaykitProfile` | `(publicKey) -> record?` | Pull-to-refresh. |
| `removeContact` | `(publicKey) -> record?` | |
| `removeContactsAndBlockPeers` | `(publicKeys[]) -> records[]` | "Block". |
| `publishPublicContact` / `removePublicContact` / `syncPublicContactMarkers` | `(publicKey) -> record` ... | Opt-in public social graph (needs `publicContactSharing: Enabled`). Optional demo. |

### 3.7 Encrypted Links and private stream (sync engine)

File: `paykit-ffi/src/private_links.rs`.

| API | Signature | Use |
| --- | --- | --- |
| `ensureLinkWithPeer` | `(counterparty, maxAdvanceSteps: u32) -> FfiLinkedPeerHandshakeReport {counterparty, state, generation: u64, handshakeRole?}` | **The one call to start/advance a link.** Role chosen deterministically. |
| `initiateLinkWithPeer` / `acceptLinkWithPeer` / `advanceLinkHandshake` | `(counterparty) -> report` | Lower-level (the smoke test uses these). |
| `linkedPeers` | `() -> FfiLinkedPeerRecord[] {counterparty, state, lastSyncAt?, lastPrivateReceiveAt?, failureCount, recovery fields...}` | Contact badge: Linking / Linked / Recovery needed. |
| `blockPeer` / `unblockPeer` / `forgetPeer` | `(counterparty) -> record` | |
| `receivePrivateMessages` | `(counterparty) -> FfiPrivateStreamIntakeReport {receiveBatchId?, streamItemIds: u64[], eventConflicts[]}` | |
| `receivePrivateMessagesFromLinkedPeers` | `() -> FfiPrivateStreamCounterpartyIntakeReport[]` | Sync loop intake. |
| `processOutboundPrivateMessages` | `(counterparty) -> FfiOutboundPrivateSendReport {attempted, sent, failed[], reservationCleanupFailures[], recoveryMarkerFailures[]}` | Immediate send after a user action. |
| `processPendingPrivateMessages` | `() -> FfiOutboundPrivateCounterpartySendReport[]` | Sync loop delivery. |
| `pendingOutboundPrivateCounterparties` | `() -> string[]` | |
| `privateMessageSchedulingSnapshot` | `() -> {linkedPeers[], pendingOutboundCounterparties[]}` | Scheduler input in one read. |
| `encryptedLinkRecoveryMarkerStatus` / `publishEncryptedLinkRecoveryMarker` / `observeEncryptedLinkRecoveryMarker` / `removeEncryptedLinkRecoveryMarker` | `(counterparty) -> FfiEncryptedLinkRecoveryMarkerReport` | "Repair link" button (debug screen). |

### 3.8 Private Payment Lists (per-contact receiving details)

File: `paykit-ffi/src/private_lists.rs`.

| API | Signature | Demo idea |
| --- | --- | --- |
| `enqueuePrivatePaymentList` | `(counterparty) -> FfiQueuedPrivateMessage` (adapter callbacks) | |
| `enqueuePrivatePaymentListWithReceivingDetails` | `(counterparty, details: FfiPrivateReceivingDetail[]) -> FfiQueuedPrivateMessage` | Simple: same as public but private. |
| **`syncPrivatePaymentListsWithReservationsAndProcessOutbound`** | `(updates: FfiPrivatePaymentListReservationUpdateInput[] {counterparty, reservations: {reservationId, identifier, payload: string, expiresAt?, attribution: Map}[]}, clearUnlistedLinkedPeers: bool) -> FfiPrivatePaymentListDeliveryReport {queued, cleared, failedToQueue, failedToDeliver}` | **Headline demo: a fresh WDK address per contact per chain** (e.g. BTC account/index allocated to that contact, EVM account index per contact). Incoming funds on that address are attributable to that contact even without a Payment Request. |
| `syncContactPrivatePaymentLists` / `...AndProcessOutbound` | `(clearUnlistedLinkedPeers) -> report` | Re-share lists to all saved contacts (uses adapter callbacks). |
| `clearPrivatePaymentList` / `clearPrivatePaymentListAndProcessOutbound` | `(counterparty)` | "Stop sharing addresses with X". |
| `currentPrivatePaymentLists` | `(counterparty) -> FfiPrivatePaymentListView[] {appId, latestStreamItemId?, paymentEndpoints[{identifier, payload}], lastRefreshAt?}` | Contact detail: "addresses X shared with you". |
| `prepareAndResolvePrivateContactPayment` | `(counterparty, amount?, afterPrivatePaymentListVersion?: u64, maxAdvanceSteps: u32) -> FfiPreparedPrivateContactPayment {resolution, linkReport?, receiveReport?, outboundReport?}` | **"Pay contact"**: one call does link/receive/send and returns payable private targets. |
| `resolvePrivateContactPayment` | `(counterparty, amount?, afterVersion?) -> FfiPrivateContactPaymentResolution {status: Payable\|NoEndpoint\|UnsupportedEndpoint\|WaitingForUpdatedPaymentList, state: Available\|NoPrivateEndpoint\|RecoveryPending, privatePaymentListVersion?, payableEndpoints[]}` | |

Consumption rule (spec "Resolve Private Payment"): after paying from a list,
persist `privatePaymentListVersion` as consumed for that contact and pass it as
`afterPrivatePaymentListVersion` next time. You then get
`WaitingForUpdatedPaymentList` until the payee sends a fresh list. This is the
anti-address-reuse mechanism: the payee should rotate the per-contact address
after receiving and re-sync the list. Nice demo of "fresh address every time".

### 3.9 Payment Requests (one-time and recurring), conversion, deadlines, proofs

File: `paykit-ffi/src/payment_requests/mod.rs`, `payment_resolution.rs`.

Terms record `FfiPaymentRequestTerms`:
`{ amount: {value, asset}, paymentReference: FfiPaymentReference, proposalExpiresAt?: RFC3339Z, recurrence?: {every: u32, unit: 'minute'|'hour'|'day'|'week'|'month'|'year', startsAt, anchor, endsAt?}, acceptedPaymentEndpointIdentifiers: string[] (non-empty), paymentEndpoints?: Map<identifier, payload> (fixed destinations; requires requiredAppId), requiredAppId?: string, conversion?: FfiPaymentConversion.Fixed{rates[{asset, value}]} | PerPeriod, paymentDeadline?: FfiPaymentDeadline.At{timestamp} | PeriodStart{seconds: u64}, metadata: FfiPrivateJsonObject }`.

| API | Signature | Demo idea |
| --- | --- | --- |
| `new FfiPaymentReference(text)` | ≤256 chars, no control chars | "Pizza 🍕" / invoice no. |
| `new FfiPrivateJsonObject(text)` | must be a JSON object | memo/note in `metadata`, e.g. `{"note":"pizza"}`. |
| `proposePaymentRequest` (payee) | `(counterparty, terms) -> FfiPaymentRequestRecord` | **"Request money"** from a contact. |
| `receivedPaymentRequestsFrom` / `paymentRequestsWith` / `paymentRequests` / `listPaymentRequests(filter)` / `actionableReceivedPaymentRequests` / `activeRecurringPaymentRequests` | list records | Inbox ("Alice requests 5 USDT"), Activity, Subscriptions tab. |
| `readPaymentRequests` | `(counterparty, expectedIdentity?) -> {identityStatus?, paymentRequests[]}` | Fresh read before paying. |
| `claimPaymentRequestForPreparation` (payer) | `(counterparty, id) -> record` | Before building tx. |
| `claimAndAcceptPaymentRequest` (payer) | `(counterparty, id, expectedProposalStreamItemId: u64) -> record` | **"Approve"** button. |
| `acceptPaymentRequest` | `(counterparty, id, expectedProposalStreamItemId) -> record` | |
| `rejectPaymentRequest` (payer) | `(counterparty, id, reason?) -> record` | **"Decline"**. |
| `cancelPaymentRequest` (either) | `(counterparty, id, reason?) -> record` | Payee withdraws; payer cancels subscription. |
| `releasePaymentRequestExecutionClaim` | `(counterparty, id) -> record` | |
| `claimPaymentRequestForExecution` | legacy; do not use | |
| `resolvePrivatePaymentRequest` | `(counterparty, id, afterVersion?) -> FfiPrivateContactPaymentResolution` | Where to pay, filtered by request's accepted identifiers/required app. |
| `prepareAndResolvePrivatePaymentRequest` | `(counterparty, id, afterVersion?, maxAdvanceSteps) -> FfiPreparedPrivateContactPayment` | |
| `submitPaymentProof` (payer) | `(counterparty, id, proof: FfiPaymentProofSubmission {billingPeriod?, paymentAppId, paymentEndpointIdentifier, allowanceId?, conversionQuoteId?, proof: FfiPrivateJsonObject}) -> record` | After WDK broadcast: `{"type":"bitcoin-txid","txid":"...","vout":0}` or the ERC-20 EIP-712 profile. |
| `quotePaymentRequest` (payee) | `(counterparty, id, billingPeriod {startsAt, endsAt}, rates[], expiresAt) -> record` | Per-period FX quote for recurring cross-asset. |
| `paymentDeadlineAt` (module, sync) | `(deadline, billingPeriod?) -> string` | "Pay by ..." label. |

Lifecycle states (`FfiPaymentRequestLifecycleState`): `Proposed`,
`ProposalExpired`, `Accepted`, `Rejected`, `Canceled`, `ProofSubmitted`,
`ActiveRecurring`, `RecoveryRequired`, `InvalidConflict`. Record fields include
outbound statuses per event (`Pending/Sending/Sent/Failed/...`) — useful for
"sent / delivered" ticks — plus `paymentProofs[]`, `conversionQuotes[]`,
`terms`, `localRole` (`Payer`/`Payee`).

Demo ideas that diversify the two-chain UX:

- **Request in USD, pay in BTC or USDT**: `amount {value:"5", asset:"usd"}`,
  `acceptedPaymentEndpointIdentifiers: [btcId, usdtId]`,
  `conversion: Fixed{rates:[{asset:"usdt",value:"1"},{asset:"btc",value:"0.0000105"}]}`.
  Payer picks the chain; both sides compute the same amount (round up to the
  endpoint's smallest unit). Rates must be explicit; never fetch a market rate.
- **Invoice with a unique address**: `paymentEndpoints: {usdtId: "<fresh address payload>"}`,
  `requiredAppId: ourAppId`. Payer must use exactly that address (no fallback),
  so settlement matching is trivial. Must fit 1000 bytes.
- **Subscription**: `recurrence {every: 1, unit: "minute", ...}` for a live demo
  (minute is a valid unit). Payer app schedules each Billing Period, pays,
  sends a proof with `billingPeriod`. Record stays `ActiveRecurring`.
- **Expiry / deadline**: `proposalExpiresAt` +2 min, show it expiring;
  `paymentDeadline`.

### 3.10 Receipts

File: `paykit-ffi/src/receipts/mod.rs`.

| API | Signature | Demo idea |
| --- | --- | --- |
| `generateReceiptId` (module, sync) | `() -> string` | Persist before issuing (retry-safe). |
| `issueReceipt` (payee) | `(counterparty, draft: FfiReceiptDraft {receiptId (required here), paymentReference, paymentRequestId?, billingPeriod?, paymentEndpointIdentifier?, amount?: {value, asset}, metadata}) -> FfiReceiptIssuanceView` | After the payee's WDK wallet sees the funds, issue an encrypted receipt. Also works **without** a Payment Request (e.g. a per-contact address received funds). |
| `prepareReceiptIssuance` / `processReceiptIssuance` | `(counterparty, draft)` / `(counterparty, receiptId)` | Two-step retryable variant. |
| `issuedReceipts` / `issuedReceiptsTo` / `receiptIssuanceRecords` | lists | "Receipts I sent". Status `PendingStorage/Stored/AccessQueued/Failed`. |
| `receiptAccess` / `receiptAccessFrom` / `receiptAccessRecords` | `-> FfiReceiptAccessView[] {retrievalStatus: Pending/Retrieved/NotFound/Failed, ...}` | Payer side: "receipt available". |
| `retrieveReceipt` (payer) | `(counterparty, receiptId) -> FfiReceiptRecord {issuer, receiptId, paymentReference, paymentRequestId?, billingPeriod?, recipientPublicKey, paymentEndpointIdentifier?, amount?, metadata, retrievedAt}` | Open receipt screen. |
| `receipts` / `receiptsFrom` / `receiptRecords` | lists | Receipts tab. |

### 3.11 Allowances (pre-approved auto-pay) and accounting

Files: `paykit-ffi/src/allowances/mod.rs`, `allowance_accounting/{mod,types}.rs`, spec `specs/allowances.md`.

Lifecycle: `proposeAllowance(counterparty, localRole: Allower|Allowee, terms: FfiAllowanceTerms) -> FfiAllowanceRecord`,
`acceptAllowance(counterparty, allowanceId, expectedProposalStreamItemId)`,
`rejectAllowance(counterparty, allowanceId)`, `endAllowance(counterparty, allowanceId)`,
`listAllowances(filter {counterparty?, localRole?, states[]})`, `getAllowance(counterparty, allowanceId)`.
States: `Proposed/Accepted/Rejected/Ended/Conflicted`.

Terms objects (validated constructors): `new FfiAllowanceTerms(asset, perPaymentAmount?: FfiAllowanceAmountRange(min,max), periodLimits: FfiAllowancePeriodLimit(amountLimit?, paymentCountLimit?, FfiAllowancePeriod(kind 'anchored'|'rolling', every, unit, anchor?))[], lifetimeAmountLimit?, activeFrom?, expiresAt?, allowedPaymentEndpointIdentifiers?)`. Every Allowance needs a monetary ceiling or an expiry.

Accounting (needed only if the wallet really auto-pays):
`allowanceAccountingState()`, `reconcileAllowanceAccounting({expectedRevision?, history, outcomes, trustedTime})`
(empty history = attest "no prior payments"), `evaluateAllowanceCandidates(scope {counterparty, paymentRequestId}, trustedTime)`,
`selectAllowance(scope, {allowanceId, expectedRevision?, trustedTime})`,
`acceptPaymentRequestAutomatically(scope, selection, checks)`,
`reserveAutomaticPayment(occurrence {request, billingPeriod?}, expectedAssociationRevision, checks)`,
`reserveManualPayment(occurrence, checks)`, `beginPaymentExecution(attemptId, checks)` (only `Ready` + `Submitted` permits WDK send; use `attemptId` as idempotency key),
`recordPaymentOutcome({attemptId, outcome: Succeeded|Failed|Unknown})`,
`deferPaymentOccurrence(occurrence, reason)`, `markPaymentManualOnly(occurrence)`,
`authorizeAllowanceReassociation(scope, {...})`. `FfiPaymentExecutionChecks {trustedTime, paymentEndpointIdentifier, actualAmount: FfiAccountingAmount(value, asset), endpointCurrent, localEnabled, recurrenceEligible}`.

Demo idea: "Let Alice charge me up to 10 USDT/day automatically" + Alice's
1-minute subscription request gets auto-paid by Bob's wallet. This is the most
impressive feature but also the most complex; treat as a late phase.

### 3.12 Things that do NOT exist

- No payer-initiated "send with note" message: Payment Requests are
  payee-initiated only. A plain "send to contact" has no Paykit message
  attached; attribution comes from the per-contact reserved address, and the
  payee can then issue a Receipt. (A memo can travel in request `metadata` or
  receipt `metadata`.)
- No generic chat / custom message API (raw custom kinds are retained but not
  sendable through the SDK).
- No inbound contact-request discovery; no push notifications; no settlement
  verification; no chain clients; no scheduler.
- No mixed public+private resolution or automatic fallback.

## 4. Payment adapter (wallet callback interface)

`FfiSdkPaymentAdapter` (`paykit-ffi/src/payment_adapter.rs`). All methods are
**synchronous** and must not call back into the same `FfiPaykitSdk`. Throw
`PaykitFfiError.*` to fail.

| Method | Called by | Input | Return |
| --- | --- | --- | --- |
| `currentPublicReceivingDetails()` | `syncPublicEndpoints` | — | `FfiPublicReceivingDetail[] {identifier, payload: FfiPaymentPayload}` |
| `currentPrivateReceivingDetails(counterparty: string)` | `enqueuePrivatePaymentList`, `syncContactPrivatePaymentLists*` when reservation callback says `UseCurrentReceivingDetails` | counterparty key | `FfiPrivateReceivingDetail[]` |
| `reservePrivateReceivingDetails(counterparty)` | same calls, first | counterparty key | `FfiPrivateReceivingDetailReservationResponse {kind: UseCurrentReceivingDetails \| Reservations, reservations: {reservationId, receivingDetail, expiresAt?, attribution: FfiReservationAttribution(Map)}[]}` |
| `cancelPrivateReceivingDetailReservation(cancellation)` | outbound processing / list replacement / app removal, when a persisted reservation is superseded | `{reservationId, counterparty, identifier, payloadHash, attribution}` | void; must be idempotent |
| `selectPublicPaymentEndpointIds(request)` | `resolvePublicContactPayment`, `resolvePublicPaymentRequest` | `{counterparty, amount?, candidates: {candidateId, counterparty, appId, identifier, payload}[]}` | candidate ids in preferred order (only ones we can pay) |
| `buildPublicPaymentTarget(endpoint)` | same, per selected id | candidate | `FfiPaymentTarget {payload: FfiPaymentPayload}` (e.g. normalized JSON with chain id + address) |
| `selectPrivatePaymentEndpointIds(request)` | private resolution calls | private candidates | ids |
| `buildPrivatePaymentTarget(endpoint)` | private resolution calls | private candidate | `FfiPaymentTarget` |

The no-op adapter (used by constructors without an adapter) throws
`PaymentAdapter` for everything except reservation, which returns
`UseCurrentReceivingDetails`.

Practical design for WDK (async APIs):

1. Keep an in-memory `ReceivingDetailsCache` refreshed by async WDK calls
   (addresses per chain; per-contact account/index map persisted in MMKV).
2. Callbacks read the cache only. `select*` filters by our supported
   identifiers in preference order. `build*Target` validates the payload JSON
   (address format, `chain_id` = Sepolia, etc.) and returns a normalized payload.
3. For publication, call the explicit-input variants
   (`syncPublicEndpointsWithReceivingDetails`,
   `syncPrivatePaymentListsWithReservationsAndProcessOutbound`) after the async
   WDK work, so no callback has to derive addresses.
4. Still implement `reservePrivateReceivingDetails` (return
   `UseCurrentReceivingDetails` or cached reservations) and an idempotent
   `cancelPrivateReceivingDetailReservation`, because sync helpers may call them.

## 5. Payment Endpoint Identifiers

- Validation (`paykit-lib/src/payment_endpoint.rs`): ASCII alphanumeric, `-`,
  `_`, `.`; max 64 chars; no traversal; `private` is reserved. Byte-for-byte
  comparison. Nothing is registered or enforced beyond that, so **custom ids for
  EVM/USDT, Solana, TRON, TON, Spark are all allowed**.
- Recommended convention (`specs/payment-endpoint-identifier.md`):
  `{asset}-{rail}-{endpoint_format}`, lowercase a-z0-9 segments. Examples in the
  spec: `btc-bitcoin-p2tr`, `btc-lightning-bolt11`, `btc-lightning-bolt12`,
  `usdt-ethereum-address`, `usdt-tron-address`, `usdc-solana-address`,
  `eur-sepa-iban`. Conversion features (`conversion` rates) **require** this
  three-segment convention and a lowercase alphanumeric request asset.
- Payload: opaque UTF-8, recommended JSON `{"value": "<address|invoice>", ...}`
  with optional `min`/`max` decimal strings and format-specific fields. Max
  64 KiB per public payload; public lists max 256 endpoints. **Private messages
  max 1000 bytes total** (whole Private Payment List JSON, whole request with
  `paymentEndpoints`, whole proof).
- The spec has **no testnet convention**. Recommendation (our app-local
  choice, flagged): put the test network in the rail so a mainnet wallet never
  matches, e.g. `btc-testnet4-p2wpkh` (or `btc-signet-p2wpkh`, whichever WDK
  supports) and `usdt-sepolia-address` (+ `eth-sepolia-address` if we offer
  native ETH). Keep request assets `btc` / `usdt` so conversion selectors
  (`btc`, `usdt`, `usdt-sepolia`) work. EVM payload:
  `{"value":"0x…","chain_id":"11155111","token":"0x<USDT test contract>"}`.
- One payload per identifier per list (the list is a map keyed by identifier).
- Receiver advertises multiple methods by including several identifiers in its
  public endpoints and/or private list. Sender: the SDK gathers candidates
  (per app), passes them to our `select*PaymentEndpointIds`, we return the
  payable ones in preference order, the SDK returns `payableEndpoints` in that
  order with targets, and **our UI lets the user pick the chain** (or picks the
  first). For Payment Requests, candidates are pre-filtered to
  `acceptedPaymentEndpointIdentifiers` (and `requiredAppId`).
- Proof formats are method-specific and unvalidated by Paykit. One profile is
  specified: `erc20-transfer-eip712` (`specs/erc20-payment-proofs.md`): payload
  `{type, chain_id, transaction_hash, receipt_log_index, signature}` with an
  EIP-712 signature by the token sender over the request binding. Whether WDK's
  EVM account exposes EIP-712 typed-data signing is **unverified** (WDK topic).
  For BTC there is no profile; use an app-local `{"type":"bitcoin-txid",...}`.

## 6. Becoming contacts and exchanging private endpoints (end to end)

Preconditions on **each** app (onboarding):

1. Mnemonic -> `pubkySecretKeyFromBip39Mnemonic`.
2. `bootstrap.signUp(secret, STAGING_HOMESERVER, inviteToken, paykitAuthorizerSessionCapabilities())`
   first time, `bootstrap.signIn(secret, paykitAuthorizerSessionCapabilities())` later.
3. `sdk = FfiPaykitSdk.withPaymentAdapterAndPubkyClientConfig(mmkvStore, sessionProvider(result.sessionAccess), adapter, defaultConfig(APP_ID), defaultPubkyClientConfig())`.
4. `await sdk.initialize()` -> expect `PrivateLinkCapable`.
5. `await sdk.publishPaykitNoiseKeyAuthorization()` (must exist before the peer can link to us).
6. `await sdk.publishPaykitApp("WDK Paykit Demo", {privatePayments:true, paymentRequests:true, receipts:true, outgoingPayments:true})`.
7. Optional: `publishPaykitProfile`, `syncPublicEndpointsWithReceivingDetails`.

Contact exchange (A on iOS, B on Android):

```text
A: show own pubky (text/QR/deep link)          B: show own pubky
A: paste B's key -> saveContact({publicKey:B})  B: paste A's key -> saveContact({publicKey:A})
A: ensureLinkWithPeer(B, 3) -> Linking          B: ensureLinkWithPeer(A, 3) -> Linking
        ... both sync loops keep calling ensureLinkWithPeer for Linking peers ...
A: -> Linked                                    B: -> Linked
A: syncPrivatePaymentListsWithReservationsAndProcessOutbound([{counterparty:B, reservations:[btc addr for B, usdt addr for B]}], false)
                                                B: (same, for A)
B: receivePrivateMessages(A) / sync loop        A: receivePrivateMessages(B) / sync loop
B: currentPrivatePaymentLists(A) -> A's addresses for B
B: prepareAndResolvePrivateContactPayment(A, {value, asset}, consumedVersion?, 3) -> Payable targets
```

- Role (initiator/responder) is deterministic (`deterministic_handshake_role`:
  lower key string initiates), so both sides just call `ensureLinkWithPeer`.
  The handshake needs several round trips; each side must keep advancing.
  The smoke test polls every 250 ms with a 30 s timeout; the step limit is 90 s.
- Without B calling `ensureLinkWithPeer(A)` (i.e. B has not added A), A stays
  `Linking` forever. If B never published its Noise key authorization, A's
  ensure call fails closed; retry later.
- Unsaved peers have a retention limit (4096 stream items, code
  `retention_limit_reached`); saving the contact lifts it.
- Contact-exchange UX on simulators: the iOS simulator has no camera; use the
  host clipboard (copy on one sim, paste on the other) and/or deep links
  (`xcrun simctl openurl booted 'wdkpaykit://contact/<pubky>'`,
  `adb shell am start -a android.intent.action.VIEW -d 'wdkpaykit://contact/<pubky>'`).
  Keep QR rendering for real devices.

Recommended foreground sync loop (per app, single-flight, never overlapping):

```text
every 3 s while foreground (1 s while a flow screen is open):
  snap = privateMessageSchedulingSnapshot()
  for peer in snap.linkedPeers where state in {Linking, RecoveryRequired}: ensureLinkWithPeer(peer, 3)
  receivePrivateMessagesFromLinkedPeers()
  processPendingPrivateMessages()
  then refresh UI from observeState() / list calls
after a user action toward peer X: processOutboundPrivateMessages(X) immediately
```

Back off on `SharedStateBusy`/`ConcurrentUpdate`/`Transport`. Delivery
Confirmations are sent automatically by the SDK, but only if both sides run
the outbound step.

## 7. Payment Request flow end to end

```text
Payee A                                          Payer B
proposePaymentRequest(B, terms) -> record(Proposed, id)
processOutboundPrivateMessages(B)
                                                 receivePrivateMessages(A) (sync loop)
                                                 actionableReceivedPaymentRequests() -> shows request
                                                 [user approves terms as displayed]
                                                 claimAndAcceptPaymentRequest(A, id, record.proposalStreamItemId)
                                                 processOutboundPrivateMessages(A)
receive -> paymentRequestsWith(B): Accepted
                                                 prepareAndResolvePrivatePaymentRequest(A, id, undefined, 3)
                                                   (or resolvePublicPaymentRequest if no link)
                                                 -> payableEndpoints[i].target  (user picks BTC or USDT)
                                                 WDK: build + sign + broadcast (amount from terms/conversion)
                                                 submitPaymentProof(A, id, {paymentAppId: endpoint.appId,
                                                    paymentEndpointIdentifier, proof: {...txid...}, billingPeriod?})
                                                 processOutboundPrivateMessages(A)
receive -> ProofSubmitted (payment_proofs[0])
WDK: verify tx to own address, amount, confirmations
issueReceipt(B, {receiptId: generateReceiptId(), paymentReference, paymentRequestId: id,
             paymentEndpointIdentifier, amount, metadata})
processOutboundPrivateMessages(B)
                                                 receive -> receiptAccessFrom(A): Pending
                                                 retrieveReceipt(A, receiptId) -> FfiReceiptRecord
```

Notes:

- Reject: `rejectPaymentRequest(A, id, "too expensive")` -> `Rejected`. Cancel:
  either side `cancelPaymentRequest` -> `Canceled`.
- `ProofSubmitted` is not settlement. The payee must verify with WDK before a
  receipt. Paykit never marks anything settled.
- Recurring: after acceptance the record is `ActiveRecurring`; the payer app
  computes due Billing Periods (`{startsAt, endsAt}` from `recurrence`), pays,
  and submits one proof per period with `billingPeriod`. Payee may issue one
  receipt per period (`billingPeriod` in the draft). Cancel to stop.
- Conversion: amounts in the request asset; the payer computes
  `amount × rate`, rounded up to the endpoint's smallest unit (sats; USDT 6
  decimals). With `PerPeriod`, the payee calls `quotePaymentRequest` per
  period and the proof carries `conversionQuoteId`.
- Proposal ids, Event ids are generated by the SDK; after an uncertain error,
  read records instead of re-proposing.

## 8. Storage and session callbacks

`FfiSdkStateBlobStore` (`paykit-ffi/src/storage.rs`), synchronous:

- `loadStateBlob(): FfiSdkStateBlobSnapshot | undefined` (`{blob: FfiSdkStateBlob, revision: string}`).
- `saveStateBlobAtomically(blob, expectedRevision?: string): string`.
  Must throw `PaykitFfiError.ConcurrentUpdate` and write nothing if the stored
  revision differs (including a stored blob when `expectedRevision` is
  undefined). Must return a **new, never-reused, non-empty** revision
  (e.g. `${installId}-${counter}` with the counter persisted, or a UUID).
- Called while the SDK holds a per-handle lock; never call the SDK from inside.
- Blob holds secrets (Noise snapshots, receipt keys). Use synchronous encrypted
  storage: `react-native-mmkv` with `encryptionKey` kept in Keychain/Keystore
  (exact MMKV version: WDK/RN research topic). AsyncStorage cannot implement it.
  Store `encodeSdkStateBlobSnapshot({blob, revision})` as one value for atomicity.
- An older blob restored by OS backup resumes stale Noise state undetectably;
  exclude it from iCloud/Android auto-backup.

`FfiSdkPubkySessionProvider` (`session.rs`), synchronous:

- `loadSessionAccess(): FfiPubkySessionAccess | undefined` — return the live
  `sessionAccess` from the bootstrap result (the SDK then reuses that session
  instead of restoring the grant).
- `publicStorageAvailable(): boolean` — `true`.
- `clearSessionAccess(): void` — drop it (called on sign-out).
- The local secret key inside the access is what makes the identity
  `PrivateLinkCapable` (Paykit key generation 1 is derived from it by default).

Alternative: `withPaymentAdapterAndPubkySharedState*` removes the blob store
(state lives encrypted at `/pub/paykit/v0/shared-state.bin`) but requires
Homeserver 0.16.2+ with GCS on every instance; not verified for staging.

## 9. What needs a background process or will not work sim-to-sim

| Item | Impact | Mitigation |
| --- | --- | --- |
| No push; everything is polling | Messages only move while the app runs its loop | Both sims foreground; 1–3 s loop; "Sync now" button. |
| Recurring payments need a scheduler | Missed periods while app is closed | Demo with `unit: "minute"` while both apps are open; catch up on launch. |
| Allowance auto-pay needs scheduler + accounting | Complex | Late phase; manual flow first. |
| Handshake needs both peers online and polling | Linking can take several cycles | Show "Linking..." state, keep `ensureLinkWithPeer` in loop. |
| Camera QR on iOS simulator | No camera | Paste via host clipboard; deep links via `simctl openurl` / `adb am start`. |
| Pubky Ring / external auth flows | Need another signer app | Not needed; we hold the key and use `signUp`/`signIn`. |
| Staging signup tokens are single-use | One per identity | Mint 2 tokens (A, B); later launches `signIn`. |
| Homeserver locks | Registry/profile/marker writes use WebDAV write locks (`paykit-lib/src/pubky_routing/locks.rs`) even in callback-storage mode | Verify staging works (run the package example's staging smoke) before building on it. |
| Android TLS | Needs `PaykitAndroid.initializeOrThrow` (done by the TurboModule) | Do not also add `com.synonym:paykit-android`. |
| iOS sim arch | arm64-only XCFramework | Exclude x86_64 in Podfile (Apple-silicon Mac is fine). |
| Settlement time | BTC testnet blocks ~10 min | Submit proof at broadcast; payee issues receipt on mempool/1-conf; Sepolia USDT confirms in seconds. |
| Local testnet instead of staging | Android needs `10.0.2.2` + `adb reverse tcp:6286` and `tcp:6287` | Only as fallback. |

## 10. Suggested demo feature list, in priority order

1. Onboarding: one mnemonic -> WDK wallets + pubky identity; staging signup; publish app + Noise key; profile (name/avatar).
2. Public endpoints toggle (BTC + USDT); "pay any pubky" via `resolvePublicContactPayment`.
3. Contacts: add by key / deep link; profile resolution; link status badge.
4. Private per-contact addresses (reservations) and "Pay contact" via `prepareAndResolvePrivateContactPayment`, chain picker.
5. Payment Requests: request, approve/decline, pay, proof, status ticks.
6. Receipts: payee issues after WDK verification; payer views.
7. Cross-asset request (USD priced, BTC or USDT accepted, fixed rates); invoice with fixed destination.
8. Subscriptions (1-minute recurrence), cancel.
9. Backup export/restore with `RequireRecovery` and relink.
10. Stretch: Allowances with auto-pay; ERC-20 EIP-712 proof; Pubky follows import; public contact markers; key rotation.
