# 05 - Pubky identity, staging homeserver, and Paykit UX references

Research date: 2026-10-26. Read-only research. Sources are cited inline with paths.

- Paykit source: paykit-rs PR #204, head `23c702c8f75c7bc211b2deaaaafbcac6f33f15d1`, clone at
  `/private/tmp/claude-501/-Users-jason-Documents-Repositories/008626ab-f4cf-47ae-baa1-9f7a347c4ea6/scratchpad/ref/paykit-rs`
  (written as `$PK` below).
- Pubky crates as pinned by that commit's `Cargo.lock`: `pubky 0.16.2`, `pkarr 8.1.0`.
- UX references: local clones of `bitkit-ios` (master `f234b92a`, 2026-10-23), `bitkit-android`
  (master `bb0c65ed6`, 2026-10-23), `polar-paykit` (master `29a11abe`), `pubky-ring` (main `fac51af`).
  `paykit-playground` is an **empty directory** on this machine, so it gave nothing.

"Unverified" marks claims I could not confirm from code or a read-only probe.

---

## TL;DR - decisions this report recommends

1. **No separate Pubky SDK in React Native.** The Paykit FFI already does key derivation, signup, sign-in,
   session import, profile, avatar and file reads. Do not add `@synonymdev/react-native-pubky` or
   `@synonymdev/pubky` (the latter is a WASM/JS SDK; Hermes has no WebAssembly).
2. **Self-custody demo key, no Pubky Ring.** Derive the Pubky key from the **same BIP39 mnemonic WDK
   uses** (Bitkit does exactly this). Pubky secret = first 32 bytes of the BIP39 seed with an empty
   passphrase (`$PK/paykit-sdk/src/identity.rs:149-185`). One recovery phrase restores both the wallet
   and the Paykit identity, and the same phrase imported into Pubky Ring gives the same pubky.
3. **Staging homeserver** `ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy`
   (`homeserver.staging.pubky.app`, `signup_mode = "token_required"`). Get signup codes either from the
   `pubky-staging-invite` skill (pasted into an "Invite code" field or passed as a launch argument), or
   automatically from **Homegate IP verification** (`POST https://homegate.staging.pubky.app/ip_verification`),
   which Bitkit uses in production code. Support both. Homegate per-IP limits are unknown for staging
   (unverified), and both simulators share the Mac's public IP.
4. **Persist** the mnemonic and the exported grant session secret in Keychain/Keystore. On restart,
   `importSession(...)` the saved secret. Fall back to `signIn(...)`. Do not sign in on every launch
   (staging rate-limits `POST /session` to 20/min per IP).
5. **Contacts = mutual add + `ensureLinkWithPeer`.** The SDK picks the handshake role from the two public
   keys, so there is no "link request" to accept. Both users add each other; a background loop calls
   `ensureLinkWithPeer` until `Linked`. Bitkit tells users: *"you and {name} must add each other as
   contacts to pay each other privately."*
6. **Sync loop.** Copy Bitkit's cadence: inbox every 10 s while foregrounded, maintenance at 30 s then
   every 60 s, link retries at 1/3/8/20/45/90 s after a contact is added. For a two-simulator demo you
   can shorten the inbox poll to 2-5 s (polar-paykit uses 2 s).
7. **Share a pubky** as the plain `pubky<52 z32 chars>` string in a QR code, plus a deep link
   `paykitwdk://contact?pubky=<key>` (Bitkit uses `bitkit://contact?pubky=<key>`). The deep link also lets
   scripts drive both simulators (`xcrun simctl openurl`, `adb shell am start -d`).

---

## Part A - Pubky identity and the staging homeserver

### A1. How the PR #204 example handles identity and sessions

Files: `$PK/paykit-react-native/example/src/{identities.ts,launchConfig.ts,mocks/sessionProvider.ts,smoke.ts}`.

- `identities.ts` uses two **public BIP39 test vectors** as fixed identities A and B, so a staging run
  can sign in again after the single-use signup codes are spent. `EXAMPLE_APP_ID = 'paykit-rn-example'`
  (Paykit App ID) and `EXAMPLE_CLIENT_ID = 'com.synonym.paykit.rnexample'` (Pubky grant client ID). These
  are two different identifiers with two different roles.
- `launchConfig.ts`: `STAGING_HOMESERVER = 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy'`,
  `LOCAL_HOMESERVER = '8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo'` (pubky-testnet
  StaticTestnet). Launch options reach JS as initial props: iOS `-paykitMode local` launch arguments
  through NSUserDefaults, Android `--es paykitMode local` intent extras (copied in
  `AppDelegate.swift` / `MainActivity.kt`). Keys: `paykitMode`, `paykitAutorun`, `paykitHomeserver`,
  `paykitLocalHost`, `paykitSignupTokenA`, `paykitSignupTokenB`. This launch-prop pattern is worth copying
  to inject a signup code and a demo-identity label into each simulator.
- `sessionProvider.ts` `signUpOrSignIn()`:

  ```ts
  const bootstrap = FfiPubkySessionBootstrap.withPubkyClientConfig(EXAMPLE_CLIENT_ID, options.pubkyClient);
  const secret = pubkySecretKeyFromBip39Mnemonic(identity.mnemonic);
  const capabilities = paykitAuthorizerSessionCapabilities();
  const result = options.signUp
    ? await bootstrap.signUp(secret, options.homeserver, options.signupToken, capabilities)
    : await bootstrap.signIn(secret, capabilities);
  // result.sessionAccess, result.publicKey ("pubky..."), result.capability
  ```

  `LiveSessionProvider` implements `FfiSdkPubkySessionProvider` with three **synchronous** callbacks:
  `loadSessionAccess()`, `publicStorageAvailable()` (returns `true`), `clearSessionAccess()`. It keeps
  the access only in memory. A real app must persist it.
- `smoke.ts` `stepSignUp()` shows the post-signup sequence:
  `FfiPaykitSdk.withPaymentAdapterAndPubkyClientConfig(store, provider, wallet, defaultConfig(APP_ID), pubkyClient)`
  → `sdk.initialize()` (expects `FfiPubkyIdentityCapability.PrivateLinkCapable`)
  → `sdk.publishPaykitNoiseKeyAuthorization()`
  → `sdk.publishPaykitApp('Paykit React Native example', { privatePayments, paymentRequests, receipts, outgoingPayments })`.
  Its `pollUntil` helper polls every 250 ms with a 30 s deadline, and each step has a 90 s timeout. Those
  numbers reflect real staging latency for a full round trip.

### A2. Does Paykit's FFI do signup itself? Yes.

`$PK/paykit-ffi/src/session.rs` exports everything the app needs:

| Need | FFI API (TS names keep the `Ffi` prefix) |
| --- | --- |
| Key from mnemonic | `pubkySecretKeyFromBip39Mnemonic(phrase)` → `FfiPubkyLocalSecretKey` (opaque handle) |
| Key from 64-byte seed | `pubkySecretKeyFromBip39Seed(seed)` |
| Public key | `pubkyPublicKeyFromSecret(key)` → `"pubky<z32>"` |
| Normalize input | `normalizePubkyPublicKey(text)` (raw z32 or `pubky…` → `pubky…`), `rawPubkyPublicKey`, `redactedPubkyPublicKey` |
| Sign up | `FfiPubkySessionBootstrap.withPubkyClientConfig(clientId, cfg).signUp(secret, homeserverPk, signupCode?, caps)` |
| Sign in | `.signIn(secret, caps)` |
| Restore saved grant | `.importSession(sessionSecret, localSecretKey?, caps)` |
| Keep pkarr record alive | `.republishIdentity(publicKey)` → `bool` |
| Session material | `FfiPubkySessionAccess.new(clientId, sessionSecret, localSecretKey?, paykitIdentitySecretKey?)`, `.exportSessionSecret()`, `.exportLocalSecretKey()` |
| Capabilities | `paykitAuthorizerSessionCapabilities()` = `"/pub/paykit/:rw,/pub/paykit-authority/v0/current-key.json:rw"`; `requiredSessionCapabilities()` = `"/pub/paykit/:rw"` |
| External signer (Ring) | `startSignInAuth`, `startSignUpAuth`, `resumeAuth`, `approveAuth`, `parsePubkyAuthUrl` (not needed) |
| Resources | `parsePubkyResource("pubky://<pk>/<path>")`, `resolvePubkyUrl(uri)` |

Gaps and notes:

- **No random key or mnemonic generator is exported.** The app must generate the BIP39 mnemonic itself.
  WDK's mnemonic generation (or `@scure/bip39` / `bip39`) works. Recommendation: generate once, use it
  for WDK, and derive the Pubky key with `pubkySecretKeyFromBip39Mnemonic`.
- **Our app is the identity "authorizer".** It holds the root Pubky secret, so it must request
  `paykitAuthorizerSessionCapabilities()` and call `publishPaykitNoiseKeyAuthorization()` once after the
  first `initialize()`. Without that, peers cannot open Encrypted Links (smoke test comment, and
  `skills/paykit/references/identity-state.md`).
- **The grant cannot write `/pub/pubky.app/**`.** Capabilities cover only `/pub/paykit/` and the
  authority file. Profiles must use the Paykit Profile (see A6), not `pubky.app/profile.json`.
- `@synonymdev/react-native-paykit` is **not on npm** (`npm view` returns E404, checked 2026-10-26). It has
  to be built from the PR commit (see `$PK/paykit-react-native/README.md` "Build from source"). That is
  another research topic. I only flag it here because it decides how the identity code gets its native
  library.
- `@synonymdev/react-native-pubky@0.15.0` exists on npm (Pubky Ring uses it). Do **not** add it next to
  Paykit. It is not needed. Two Rust native libraries in one app may also clash on bundled
  dependencies (unverified). The Paykit README already warns against adding `com.synonym:paykit-android`
  next to the RN package because of duplicate `libpaykit.so`.

**Key-derivation note (security, for the docs):** Pubky's secret is the raw first 32 bytes of the
64-byte BIP39 seed. WDK derives chain keys from the full seed via BIP32/BIP44 (HMAC-SHA512 of all
64 bytes). Leaking the Pubky secret does not reveal the second half of the seed or any BIP32 key. It is
still not a hardened, domain-separated derivation. Pubky Ring and Bitkit both use this scheme, so it is
the ecosystem convention, not something we invented. Say this in the README, and recommend a separate
mnemonic for anything beyond testnet.

### A3. Staging homeserver facts

Read-only probes on 2026-10-26, plus `pubky/pubky-stack` `.github/workflows/pubky-homeserver-cicd.yml`
(read with `gh api`, submodule pin `f60e502f`):

| Fact | Value |
| --- | --- |
| Homeserver public key | `ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy` (same in paykit example, Pubky Ring `src/utils/constants.ts` `STAGING_HOMESERVER`, staging-invite skill) |
| pkarr record (from `https://pkarr.pubky.app/<pk>`, 225 bytes) | HTTPS RR prio 1, target `.`, port **6287**, ipv4hint `34.65.231.81`; HTTPS RR prio 10 → `homeserver.staging.pubky.app`; A `34.65.231.81`; TTL 3600 |
| ICANN endpoint | `https://homeserver.staging.pubky.app` (HTTP 200), listen `0.0.0.0:6286` behind it |
| Pubky TLS endpoint | `34.65.231.81:6287` (raw-public-key TLS, checked against the homeserver key) |
| Signup | `signup_mode = "token_required"` |
| Storage | `google_bucket` (GCS), `default_quota_mb = 1024`. This meets Paykit shared-state's "0.16.2+ with GCS" requirement. |
| Rate limits | `POST /session` 20 r/min burst 50 **per IP**; `GET /session` 5 r/s per user; `DELETE /pub/**` 5 r/s burst 50 per user; writes 1 MB/s burst 20 |
| Production (do not use) | `8um71us3fyw6h8wbcxb5ar3rwusy1a6u49956ikzojg3gcwd1dty` |
| Web client | `https://staging.pubky.app` (401 without auth) |

#### Getting a signup code

1. **`pubky-staging-invite` skill** (`/Users/jason/.claude/plugins/marketplaces/synonym-skills/skills/pubky-staging-invite/SKILL.md`).
   `scripts/generate.sh` mints one single-use code with the admin password from Keychain. The code is
   valid only for `ufibw…`. Admin `GET /generate_signup_token` mints the default quota, which has
   unrestricted write paths (per `pubky-marketplace/docs/spec-feedback/pubky-core-team-brief.md` §6).
   Mint only when the user asks for codes.
2. **Homegate IP verification** (self-serve, no admin password). Bitkit iOS
   `Bitkit/Managers/PubkyProfileManager.swift:408-428, 547-558` and Android
   `app/src/main/java/to/bitkit/repositories/PubkyRepo.kt:715, 883`:
   `POST {homegateUrl}/ip_verification` with an empty body returns JSON `{ "signupCode": "...", "homeserverPubky": "..." }`.
   Staging `homegateUrl = https://homegate.staging.pubky.app` (`Bitkit/Constants/Env.swift:395-406`).
   The root URL answered 200. I did **not** call `/ip_verification`, because that would mint a code.
   Caveats:
   - Homegate config has `[ip_verification] max_verifications_per_week / per_year`. The staging values are
     unknown (the local docker config sets them to 99999999). Two simulators on one Mac share one public
     IP, so the second request may be refused (unverified).
   - IP-verified signups may carry an `allowed_write_paths` quota that allows only `/pub/paykit/**`.
     That was observed live as `403 Write to this path is not allowed` on `/pub/pubky.app/**` (same
     brief, §6; marked "UNPROVEN mechanism"). It is harmless for us, because we only write under
     `/pub/paykit/`.
   - Homegate returns `homeserverPubky`. Use it rather than hard-coding, and assert it equals `ufibw…`.

Recommendation: the onboarding screen offers **"Get a staging invite automatically"** (Homegate) and
**"I have an invite code"** (text field, `secureTextEntry`, never logged). A dev launch argument
pre-fills the code. Single-use semantics: a failed signup attempt may already have consumed the code
(skill doc). Map these errors, taken from Pubky Ring `src/utils/signupErrors.ts`:
`Token already used`, `Token required`, `Invalid token`.

#### Sign-up / sign-in decision (copy Bitkit)

`PubkyProfileManager.createIdentity` (Bitkit iOS) runs `signUp`, and on failure (usually "already
registered") falls back to `signIn`. The FFI doc for `sign_up` says: "Signing up an identity that
already has an account on that homeserver publishes its homeserver record again." Restoring a wallet
from its mnemonic is then just `signIn(secret, caps)`, with no code needed.

### A4. Session persistence and restart

The FFI's restore paths (`$PK/paykit-ffi/src/session.rs:316-470, 584-606`):

- After signup or sign-in, persist **`result.sessionAccess.exportSessionSecret()`** (grant + proof-of-possession
  secret) and the mnemonic (or `exportLocalSecretKey().exportBytes()`) in secure storage.
- On restart, either:
  - (a) Bitkit's way: `bootstrap.importSession(savedSecret, localSecretKey, caps)` → live `sessionAccess`.
    The session provider returns it. If import fails (revoked or expired grant), call `signIn(secret, caps)`
    and persist the new secret (Bitkit `PubkyService.swift:~505-521`, `resolveSessionInitialization`).
  - (b) Lazy: the provider's `loadSessionAccess()` returns
    `new FfiPubkySessionAccess(CLIENT_ID, savedSecret, localSecretKey, undefined)`. The SDK adapter
    restores the grant itself (`pubky.restore_session`), caches it, and checks the grant's client ID.
- Rules:
  - The client ID must be stable across launches. The grant records it, and a mismatch is rejected.
  - "Independently restoring the same grant replaces its previous bearer." Keep **one long-lived
    `FfiPaykitSdk` handle per identity**. Do not build a second handle that restores the same grant.
  - Provider callbacks are synchronous and run on the JS thread while a Rust worker waits. They must not
    return Promises and must not call back into the same SDK handle (`$PK/paykit-react-native/README.md`
    "Callbacks and threads"). Keep the access object in memory, loaded at startup from Keychain.
  - Do not log `FfiPubkySessionAccess`, the session secret, the mnemonic, or any type listed in
    `paykit-ffi/redacted_binding_types.txt`. TS records are not redacted.
  - `sdk.signOut()` revokes the grant. `sdk.forgetSessionAccess()` only clears it locally. For a demo
    "Reset identity" button, use `signOut()`, then wipe Keychain.
- Secure storage libraries used by a Synonym RN app (Pubky Ring `package.json`): `react-native-keychain ^10.0.0`,
  `react-native-mmkv 4.3.1`.

**SDK state storage choice** (this affects identity code):

| Option | Constructor | Pros | Cons |
| --- | --- | --- | --- |
| Callback blob store | `FfiPaykitSdk.withPaymentAdapterAndPubkyClientConfig(store, provider, adapter, config, client)` | Fast local reads. Proven by the smoke test, including restart. Works on the local testnet. | `FfiSdkStateBlobStore` must be **synchronous and encrypted**: MMKV with an encryption key from the Keychain. Blob bytes enter the JS heap. Revision contract (`saveStateBlobAtomically(blob, expectedRevision)`). |
| Pubky shared state | `FfiPaykitSdk.withPaymentAdapterAndPubkySharedStateAndClientConfig(provider, adapter, config, client)` | No local store. State lives encrypted at `/pub/paykit/v0/shared-state.bin`. Bitkit uses this (`PubkyService.swift:1494`). Staging (GCS) meets the requirement. | Every state op takes a remote WebDAV lock and does a load/publish. A teammate (Ben Kaufman) reported it as too slow on staging (from Jason's notes). The local testnet's storage is outside the stated guarantee (unverified whether it works). |

Recommendation for a responsive demo: the callback blob store with encrypted MMKV. Shared state is
simpler to code but adds latency to every tap. This is an open decision for the plan.

### A5. Network endpoints the app will hit

| What | Where | Notes |
| --- | --- | --- |
| pkarr relays (resolve and publish identity and homeserver records) | `https://pkarr.pubky.app`, `https://pkarr.pubky.org` | `pkarr 8.1.0` `DEFAULT_RELAYS`. Both answered 200 for the staging record. |
| Mainline DHT | UDP, public bootstrap | Native builds also use the DHT (`pubky-0.16.2/src/client/core.rs`). Relays alone are enough if UDP is blocked. |
| Homeserver | `34.65.231.81:6287` (Pubky TLS) or `https://homeserver.staging.pubky.app` | Port 6287 must be reachable outbound. A restrictive network that allows only 443 might break the Pubky-TLS path (unverified whether the client falls back to the ICANN record automatically). |
| Homegate | `https://homegate.staging.pubky.app/ip_verification` | Only if we use self-serve codes. |
| HTTP auth relay | `https://httprelay.pubky.app/link` (default) / `/inbox/` | Only for Ring/pubkyauth flows. Unused. |
| Peers' homeservers | Whatever their pkarr record says | For a two-simulator demo, both peers are on staging. |

TLS: all of this is Rust (reqwest + rustls). iOS ATS and the Android network security config do not
apply. On Android, the RN TurboModule calls `com.synonym.paykit.PaykitAndroid.initializeOrThrow(appContext)`
for `rustls-platform-verifier` automatically. The smoke step `android_https` exists to prove relay HTTPS
works on the emulator in staging mode.

Keep the identity record alive: Bitkit calls `republishIdentityIfNeeded` (FFI
`FfiPubkySessionBootstrap.republishIdentity(pk)`) when the app comes to the foreground and before inbox
polling, with a 5 s cap and without blocking the UI (`Bitkit/Services/PubkyService.swift:524-560`,
`AppScene.swift:1515`).

### A6. Displaying and sharing a pubky, and profiles

Formats:
- The FFI returns **app-key form `pubky` + 52 z-base32 chars** (`to_app_key`). z32 alphabet:
  `ybndrfg8ejkmcpqxot1uwisza345h769` (Bitkit `Models/PubkyPublicKeyFormat.swift`).
- Input: accept raw z32 or `pubky…` through `normalizePubkyPublicKey`. Legacy Ring keys use `pk:<z32>`
  (`pubky-ring/src/components/PubkyBox.tsx:97`). Strip `pk:` before normalizing. I did not confirm whether
  `PubkyPublicKey::from_raw_or_app_key` accepts `pk:`.
- Truncation: Bitkit shows `abcd...wxyz` (4+4 of the raw key, `displayTruncated`) and redacts logs to the
  first 12 characters. Ring shows 5+5 (`utils/pubky.ts:957-969`). FFI `redactedPubkyPublicKey` is for logs.
- QR: Bitkit's profile QR content is the **plain public key string** (`Views/Profile/ProfileView.swift:205`,
  `QR(content: profile.publicKey)`). Its scanner routes a scanned pubky to Contact Detail / Add Contact
  (`Managers/ScannerManager.swift:140`).
- Deep link: Bitkit `bitkit://contact?pubky=<key>` (`Models/PubkyContactLink.swift`). It is strict:
  exactly one query item, no path, normalized key. Journeys use it to drive simulators:
  `xcrun simctl openurl booted "bitkit://contact?pubky=<key>"`.
- `pubky://<z32>/<path>` URIs are resource addresses, for example `pubky://<pk>/pub/paykit/profile.json`
  and avatar blobs. They are not "contact" links. `pubkyauth://` is auth only.
- RN libraries with Synonym precedent (Pubky Ring): `react-native-qrcode-svg ^6.3.21`,
  `react-native-camera-kit 18.0.0`.

Profiles (`$PK/paykit-ffi/src/profiles.rs`, `$PK/paykit-sdk/src/domain/contacts/profiles.rs`,
`runtime/profiles.rs`):
- Paykit Profile at `/pub/paykit/profile.json`: `FfiPaykitProfile { displayName?, imageUri?, extraJson? }`.
  Limits: display name ≤128 chars, image URI ≤2048, extra JSON ≤16 KiB, whole profile ≤256 KiB.
  `publishPaykitProfile(profile, expectedRevision)`: pass `undefined` the first time, then the
  `revision` from the last fetch or publish (optimistic concurrency).
- Avatar: `uploadProfileAvatar(bytes, contentType)` accepts `image/jpeg|jpg|png|webp|gif`. It writes
  `/pub/paykit/blobs/avatar-<sha8>.<ext>` and returns a blob record with a `pubky://` URI to put in
  `imageUri`. Bitkit resizes to at most 400 px and JPEG quality 0.8 before upload. polar-paykit caps
  uploads at 256 KiB and 1024×1024.
- Reading: `resolveProfile(pk, allowPubkyProfileFallback=true)` tries the Paykit Profile, then
  `/pub/pubky.app/profile.json`. It returns `{ source, displayName, imageUri, … }`. Fetch avatar bytes with
  `fetchPubkyFileBounded(uri, maxBytes ≤ 5 MiB)` and render them as a base64 data URI.
- `fetchPubkyFollows(pk, maxEntries)` reads pubky.app follows. Bitkit uses it for "Import contacts".
  This is a nice extra if a user has a pubky.app account, but our fresh demo identities have no follows.
- Contacts: `saveContact({ publicKey, label })`, `contactRecords()`, `removeContact`,
  `removeContactsAndBlockPeers`, `saveContactsAndUnblockPeers`, `refreshContactPaykitProfile`,
  `publishPublicContact` / `removePublicContact` (only when `publicContactSharing = Enabled`). Bitkit sets
  `publicContactSharing = .privateOnly`.

### A7. Is Pubky Ring auth needed? No.

Ring is optional (`skills/paykit/references/identity-state.md`: "Ring is optional"). The app holds the
root key, so it is its own authorizer. Ring would only add value as an alternative sign-in, which is
out of scope. Bitkit's Ring integration (shared keychain group, adoption) is a large amount of code. Do
not copy it.

### A8. Staging compared with a local pubky-testnet

| | Staging | Local `pubky-testnet` (example `scripts/local-stack.mjs`) |
| --- | --- | --- |
| Homeserver key | `ufibw…` | `8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo` |
| Signup | Code required | Open (no code) |
| Client config | `defaultPubkyClientConfig()` (`localTestnetHost: undefined`) | `localTestnetHost: '<host>'`. The client switches to DHT `<host>:6881`, pkarr relay `http://<host>:15411`, auth relay `http://<host>:15412/inbox/`. |
| Ports | Internet: 443, 6287 | Fixed: 6881/udp, 6286, 6287, 6288 (admin), 15411, 15412. All must be free. |
| iOS simulator | Internet | `127.0.0.1` (shares host loopback) |
| Android emulator | Internet | `10.0.2.2`, **plus** `adb reverse tcp:6286 tcp:6286` and `adb reverse tcp:6287 tcp:6287`, because the homeserver publishes a `127.0.0.1` address |
| HTTPS | Real (Android verifier exercised) | Plain HTTP. The smoke test skips `android_https`. |
| Data persistence | Survives; identities reusable | Throwaway |
| Prereqs | Signup codes | `cargo install` of pubky-testnet (about 2 min first run), Postgres via Docker or `TEST_PUBKY_CONNECTION_STRING` (this Mac has Homebrew Postgres: `postgres://jason@localhost:5432/postgres`) |
| Cross-device demo | Works anywhere | Only on this Mac |

Recommendation: target **staging** for the demo, which is what the user asked for. Keep a "local" mode
switch, copied from the example's `launchConfig.ts`, as a fallback for offline development.

---

## Part B - Paykit wallet UX references

### B1. paykit-playground

`/Users/jason/Documents/Repositories/paykit-playground` is an empty directory. Nothing to learn here.

### B2. polar-paykit (desktop workbench)

Sources: `polar-paykit/README.md`, `docs/paykit-workspace.md`, `paykit/src/workspace.rs`,
`paykit/src/receiver_ipc.rs`. Pinned to an older paykit-rs (`5ef8caf8`) that still had "receiver paths";
PR #204 has no receiver-path argument.

Feature map (its "ten feature areas"), useful as a checklist for our demo:
1. participants and receivers; 2. encrypted links plus pause/resume/sync of private delivery;
3. public profiles, avatars, private contacts, explicit public sharing; 4. on-chain and BOLT11 methods,
public lists, private reservations; 5. payment requests; 6. real payments with durable execution and
reconciliation; 7. proof submission and independent settlement verification; 8. encrypted receipts;
9. recurring requests, period endpoints, manual pay, autopay, "receiver time"; 10. encrypted backup and
restore and relinking.

UX patterns worth copying:
- **Separate statuses**, never merged: request lifecycle, execution, proof delivery, settlement
  verification, receipt issuance. "A submitted proof is not a settlement confirmation." "Acceptance of a
  command alone is not proof of delivery."
- **Guides with checkpoints** that open the real panel without acting for you. That fits a reference app
  well, for example a "Demo tour" screen.
- Background loop every **2 s** (`receiver_ipc.rs:72`): advance `Linking` handshakes, then
  `processPendingPrivateMessages()`, then `receivePrivateMessagesFromLinkedPeers()`
  (`workspace.rs:1209-1250`). The UI refreshes public state every 1 s.
- Every failed operation keeps its public error code and a recovery hint visible. Retry an uncertain
  command with the **same** command ID, so a retry never makes a second payment.
- Avatar validation before upload: PNG/JPEG ≤256 KiB, ≤1024×1024, must decode.
- Gotcha: recurring period offers use compact SHA-256 endpoint commitments "so BOLT11 invoices fit the
  SDK's encrypted message limit". Keep payloads small.

### B3. Bitkit iOS and Android (the production Paykit wallet)

About 120 Swift files touch Paykit/Pubky. Android mirrors iOS (54 Kotlin files), and journeys are
shared. Key files: `Bitkit/Services/PubkyService.swift` (2370 lines, `PaykitSdkService`),
`Bitkit/Managers/PubkyProfileManager.swift`, `Bitkit/Managers/ContactsManager.swift`,
`Bitkit/Services/PrivatePaykitService+*.swift`, `Bitkit/Services/PaykitPaymentRequestService.swift`,
`Bitkit/AppScene.swift`, `Docs/USDT.md`, `journeys/{contacts,payment-requests,profile,pubky-profile}/`.

Configuration:
- Paykit App ID `"bitkit"`. Pubky client ID `"staging.bitkit.to"` on non-mainnet (`PubkyService.swift:1848-1858`).
- `publicContactSharing = .privateOnly`. Uses Pubky **shared state**
  (`PaykitSdk.withPaymentAdapterAndPubkySharedStateAndClientConfig`).
- Requests `paykitAuthorizerSessionCapabilities()`.
- Keychain entries `pubky_secret_key`, `paykit_session`. The session provider rebuilds
  `PubkySessionAccess(clientId:sessionSecret:localSecretKey:paykitIdentitySecretKey:)` from them
  (`PubkyService.swift:2219-2272`). Bitkit's provider has an extra `canDeferStaleSession` callback, so it
  runs a newer Paykit than #204 (unverified which release).

Identity onboarding ("Profile" flow):
- Intro "Portable profile": *"With your portable profile your contacts can reach you and pay you anywhere."*
- Choice: "Create profile" (new pubky derived from the wallet mnemonic: `deriveLocalSecretKeyFromWalletSeed`
  → `Paykit.pubkySecretKeyFromBip39Mnemonic`) or "Use an existing pubky from Pubky Ring".
- Create form: name, avatar, bio, links, with a disclaimer that everything is public. The QR card shows
  "Scan to add {name}". "Deriving your keys…" progress copy.
- Profile is published as a Paykit Profile, not `pubky.app` (marketplace brief §6).

Contacts:
- Add by **Scan QR** or **Paste a pubky**. Errors: already in contacts, invalid key, cannot add yourself.
  Disclaimer: *"Please note that you and {name} must add each other as contacts to pay each other
  privately. Otherwise, the payment will be visible publicly."*
- Saving a contact triggers background `ensureLinkWithPeer(pk, maxAdvanceSteps: 1)` with retry delays
  **1 s, 3 s, 8 s, 20 s, 45 s, 90 s** ("keep draining long enough for staggered mutual adds",
  `PrivatePaykitService.swift:67-75`). `PaykitError.NotFound` means the peer has not published its Paykit
  authorization yet. Bitkit then waits **5 min** before retrying (`PrivatePaykitService+Contacts.swift:758-785`).
  For a demo, use a shorter backoff.
- The contact profile cache is fresh for 10 min (`ContactsManager.swift:148`).
- Contact Detail → **Pay** opens a **"Request or Pay"** sheet. Pay shows a spinner on the sheet while
  payment details resolve, then opens the amount screen (journey target: within 3 s). Request opens the
  Payment Request amount screen.
- Requests can go only to a saved contact with a private connection: *"Payment requests can only be sent
  to a saved contact with a private connection."*
- Import contacts from pubky.app follows (`fetchPubkyFollows`), with select all/none. Excludes yourself.
- Journey `contacts/link-contact-after-resume.xml`: add a contact, background the app, reopen, and Request
  or Pay becomes available. It records time-to-link with "no fixed latency assertion", so linking time
  varies and the UI must show a "connecting" state.

Payment requests (`wallet__payment_request_*` strings, `PaykitPaymentRequestService.swift`, `AppScene.swift`):
- Create: amount, accepted methods ("Accept payment in"), expiry presets (1 hour, 1 day, 1 week, 1 month),
  note ("For"). Sent screen: "Payment Requested", "Waiting for {name} to pay". If the link is not ready:
  "Your payment request is queued and will send automatically."
- Inbox: Home shows a "{count} pending" card, "Review each request, then pay or dismiss", "Not Now",
  "See All".
- Statuses: Pending, Accepted, Rejected, Canceled, Expired, Proof submitted, Paid, Action required,
  Unavailable, "Payment verified", "Received · Underpaid", "Received · After expiry".
- **Automatic presentation**: an incoming request opens the confirmation sheet when the app is in the
  foreground, but waits if another sheet is open. It never reopens a request the user already reviewed.
  The pay control stays disabled with progress until fresh validation finishes. On insufficient
  balance, a toast appears once (`journeys/payment-requests/automatic-presentation.xml`).
- Mismatch safety copy: *"The payment details did not match the request. Payment cancelled."*

Polling cadence (`journeys/payment-requests/README.md`, `AppScene.swift:301-326, 1509-1545`):
- Inbox and shared request state **every 10 s** while foregrounded and online.
- Maintenance (outbound retries, endpoint publication, target discovery) on startup, after **30 s**, then
  **every 60 s**. Serialized, with no catch-up bursts. "Incoming messages wait for the next poll plus
  synchronization time."
- Identity republish before polling starts.
- Android does the same through `AppViewModel.startPaykitPaymentRequestPolling()`, started and stopped
  with lifecycle in `ContentView.kt:320-340`.

Subscriptions and allowances (extras if time allows): "Propose Subscription", periods daily to yearly,
"each installment requires payer approval", allowances ("Requests up to {perPayment} will be paid
automatically, up to {monthly} a month").

**USDT + Paykit** (`Docs/USDT.md`), directly relevant to WDK:
- Bitkit pays USDT on **Arbitrum One** with Paykit endpoint identifier **`usdt-arbitrum-address`**. The
  payload binds address, chain 42161 and the pinned token. Proof type `erc20-transfer-eip712` (see
  `$PK/specs/erc20-payment-proofs.md`).
- "Proof submitted" describes Paykit proof delivery, not payment verification. Attribution of an
  incoming payment to a contact needs the request-bound proof plus a verified on-chain transfer, not
  the address alone.
- For test identifiers, Bitkit's regtest fixtures use `btc-regtest-p2wpkh` with payload
  `{"value":"bcrt1q…"}` (`journeys/payment-requests/README.md`). That is a precedent for testnet rail names
  such as `btc-testnet-p2wpkh` or similar. Endpoint-ID choice belongs to the WDK/chain research.

### B4. Pubky Ring (identity presentation)

`pubky-ring` (RN 0.86.0, `@synonymdev/react-native-pubky 0.15.0`):
- Home is a list of `PubkyCard`s: avatar (`ProfileAvatar`), name, key truncated 5…5. `PubkyBox` and
  `PubkyDetail` show the full key with copy.
- Profiles are read from `pubky://<pk>/pub/<app>/profile.json` (`utils/pubky.ts:348-380`). Images come
  inline as `base64:` data.
- Signup error mapping in `utils/signupErrors.ts`. Staging is selected with `IS_STAGING = __DEV__`.
- No QR for the pubky itself (QR only for migration and auth scanning).

### B5. UX patterns to copy (summary)

1. **Identity card**: avatar, name, truncated `pubky…` with a copy button, QR of the full key,
   "Scan to add {name}".
2. **Add contact**: scan or paste. Validate with `normalizePubkyPublicKey`. Reject self and duplicates.
   Show the profile preview ("Retrieving contact info…") before saving.
3. **Mutual-add explainer** and a per-contact **connection badge**: Not linked → Connecting
   (`Linking`) → Private link (`Linked`) / Recovery required / Blocked. These map to
   `FfiLinkedPeerState`.
4. **"Request or Pay"** from the contact screen. Requests only for linked contacts.
5. **Payment request inbox** with a pending count, automatic presentation of new requests, and clear
   separate statuses (request vs payment vs proof vs verified).
6. **Queued is OK** copy: "will send automatically" when the link or network is not ready.
7. **Activity attribution**: label transactions with the contact once proof plus on-chain evidence
   match.
8. **Public vs private** visibility: show when a payment resolves through public endpoints
   (`resolvePublicContactPayment`) or the private list (`prepareAndResolvePrivateContactPayment`).
   That difference is a core Paykit demo point.

### B6. Gotchas these apps hit

- **Linking latency is real and variable.** Both sides must have published their Noise key
  authorization and have added each other. Expect tens of seconds on staging. Show progress and retry
  with backoff. Never block the UI on it.
- **`NotFound` during linking** usually means the peer has not finished onboarding
  (`publishPaykitNoiseKeyAuthorization` / `publishPaykitApp`). Bitkit backs off 5 min. Use about 15-30 s
  for the demo.
- **Shared state is slow on staging** (reported by Ben Kaufman, per Jason's notes). Bitkit pays that
  cost. We can avoid it with the blob store.
- **`SharedStateBusy` / `state_transaction_in_progress`**: back off and retry. Never treat it as empty
  state (skill `identity-state.md`). Also thrown by `stateRevision()` while another call runs.
- **Serialize SDK calls.** Bitkit wraps everything in a priority operation lock
  (`PaykitSdkOperationLock`, interactive vs background). Do the same in JS: one queue, with UI-initiated
  calls ahead of the poll loop.
- **Callbacks re-entering the SDK deadlock.** The smoke test uses timeouts so a deadlock fails a step
  instead of hanging.
- **Single-use signup codes** get consumed by failed attempts. Always try sign-in first on restore.
- **Staging `POST /session` limit is 20/min per IP**, shared by both simulators. Do not sign in in a
  loop.
- **Sync, not async, storage** for `FfiSdkStateBlobStore`. AsyncStorage cannot implement it.
- **JS records are not redacted.** No `console.log` of Paykit records.
- **iOS simulator is arm64 only** (no x86_64 slice). **RN 0.78 + Xcode 26 needs `fmt` built as C++17.**
  Both are in the PR README Podfile snippets.
- **Android**: do not add `com.synonym:paykit-android`. The RN package's TurboModule initializes TLS.
- **Message size**: keep endpoint payloads compact. polar-paykit had to hash BOLT11s to fit the
  encrypted message limit.

---

## Concrete proposal for our app's identity layer

```
src/identity/
  mnemonic.ts        // generate or restore BIP39 (shared with WDK), store in Keychain
  pubkyKey.ts        // pubkySecretKeyFromBip39Mnemonic, pubkyPublicKeyFromSecret
  signupCode.ts      // Homegate POST /ip_verification, or a user-entered invite code
  session.ts         // bootstrap: importSession → signIn → signUp(code); persists exportSessionSecret
  sessionProvider.ts // FfiSdkPubkySessionProvider (sync), in-memory access loaded at boot
  stateStore.ts      // FfiSdkStateBlobStore on encrypted MMKV (or switch to the shared-state constructor)
  paykit.ts          // single FfiPaykitSdk handle + serialized call queue
```

Onboarding sequence (first launch):
1. Create or import the mnemonic, then start WDK.
2. Derive the Pubky key and show the user's pubky.
3. Get a signup code (Homegate or paste), then `signUp(secret, STAGING_HS, code, paykitAuthorizerSessionCapabilities())`.
   If the account already exists, `signIn`.
4. Persist `exportSessionSecret()`.
5. Build the SDK, then `initialize()` → `publishPaykitNoiseKeyAuthorization()` → `publishPaykitApp(...)`
   → `publishPaykitProfile({displayName, imageUri})` (avatar optional) → `syncPublicEndpoints()` with WDK
   receive addresses.
6. Start the sync loop: identity republish, ensure links for saved contacts, process outbound, receive
   inbound, refresh requests.

Restart: load the mnemonic and session secret → `importSession` (fall back to `signIn`) → build SDK →
`initialize()` → sync loop. No signup code needed.

Two-simulator demo script idea: launch iOS with `-demoName Alice` and Android with `--es demoName Bob`.
Each shows its QR and pubky. Add each other by deep link:
`xcrun simctl openurl booted "paykitwdk://contact?pubky=<bob>"` and
`adb shell am start -a android.intent.action.VIEW -d "paykitwdk://contact?pubky=<alice>"`.
Wait for "Private link", then Request or Pay.

---

## Open questions

- Does staging Homegate IP verification allow two codes from one public IP in a short window? What are
  the staging `max_verifications_per_week/year` values? (Not tested, because calling it mints a code.)
- Blob store (fast, more code) or shared state (simpler, slower on staging)?
- Which Paykit App ID and Pubky client ID do we use? For example `wdk-wallet` and
  `com.jasonvdb.paykitwdkwallet`. The client ID must stay stable forever for existing grants.
- Share the WDK mnemonic with Pubky (recommended, the Bitkit precedent) or use a separate one?
- Which endpoint identifiers to use for testnet assets, given there is no testnet convention in the spec
  (Bitkit used `btc-regtest-p2wpkh`)? This is for the WDK/chain research to settle.
- Does `normalizePubkyPublicKey` accept a `pk:` prefix? (Unverified. Strip it defensively.)
- Does the Pubky client fall back from port 6287 (Pubky TLS) to the ICANN 443 endpoint on networks that
  block 6287? (Unverified.)
