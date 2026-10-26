# Paykit × WDK example wallet

A React Native example wallet that shows how [Tether WDK](https://wdk.tether.io/)
and [Pubky Paykit](https://github.com/pubky/paykit-rs) work together:

- **WDK** holds the keys and moves the money (testnet only).
- **Paykit** turns Pubky identities into payable contacts: public and private
  payment endpoints, payment requests and more.

> **Testnet only. Not production software.** This repository is a reference for
> developers. Keys are stored with simple demo-grade protection.

## Status

Phases 1 (foundation), 2 (wallet), 3 (identity and public payments),
4 (contacts and private payments) and 5 (payment requests and receipts)
are done, and Phase 6 has added the remaining Paykit features (see
"Phase 6" below): the app skeleton, design system, navigation, the wallet and
Paykit service layers, and the WDK side of the app: receive cards with QR
codes, sending to an address with a fee review, activity with a detail
screen, the recovery phrase, "Get test USD₮", collecting BTC from contact
accounts, and demo funding scripts. Phase 3 adds your profile (name and
photo, shown in every seal), the pay-me code (your pubky as a QR), public
payment endpoints you switch on or off per asset, paying anyone by pubky
through those endpoints, a QR scanner, and a developer "Network details"
section. Phase 4 adds contacts: a profile preview before adding someone,
your own label for them, a People list sorted by link state, a Person page
(what they accept publicly and privately, history, Bitcoin from them with
Collect, Remove), Private Payment Lists shared and read over each Encrypted
Link, paying a linked contact at the private Bitcoin address they shared
only with you (USD₮ goes to their one address for everyone), activity rows
that name the contact ("Ben paid you"), and the seal closing when a link
forms. Phase 5 adds payment requests: Request money
(once, or on a short demo schedule such as every minute for a number of
payments), a Requests tab with Incoming and Sent, a request page with a
Requested -> Accepted -> Paid -> Verified -> Receipt timeline, Accept and
pay through the Send review with the amount and address locked, Decline,
Cancel, Stop payments and Not now for a recurring payment, payment
proofs (a signed EIP-712 proof for USD₮), the payee's on-chain check
through WDK, encrypted receipts, and activity rows linked to their
request and receipt.

Phase 4 was checked on both simulators without money: the demo wallets
were empty, so private payments were resolved up to Review (iOS resolves
Ben's private Bitcoin address, his contact account for Ana, not his public
one, and the other way round) but not broadcast, and Collect was not run.

Phase 5 was checked on both simulators without money as well: requests
went both ways (one-time USD₮, recurring Bitcoin and USD₮), and decline,
accept, cancel by either side and putting a recurring payment off worked
end to end; paying stopped at "Not enough …" before the broadcast. The
payment, proof, on-chain check and receipt steps are covered by unit
tests only so far.

A review of Phases 4 and 5 hardened the payment side: a USD₮ transaction
WDK calls "dropped" is no longer taken as failed on one answer, a payment
that lost its hash mid-send is found in the wallet's history (or released
when it never left), Pay waits until the acceptance has left and refuses
to accept a request about to expire, a retry after a failed start works,
proofs for payments older than the request are rejected, recurring
periods past the 120th are payable, Activity names a person only on a
payment we sent or verified, and a USD₮ address is no longer called
private. See "Payment requests" in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the details and what
risk remains.

### Phase 6: automatic payments, block and forget, backup

- **Automatic payments** (Paykit Allowances). Person > Automatic payments
  offers a contact to pay their requests without a tap, within limits:
  up to an amount per payment, at most 10 payments and 4 payments' worth
  an hour, 10 payments' worth in all, ending after an hour, a day or a
  week. They accept or decline; either side can end it, and the page
  shows what has been used. Their covered requests are then accepted and
  paid by a sync round hook through the same payment ledger, WDK send
  and proof path as the Pay button; over a limit, a request waits for
  you with the reason on its page. Rows say "Paid automatically".
- **Block, unblock, forget.** Block ignores a contact's requests and
  messages and ends the private connection (they stay listed, under
  "Blocked", with the Graphite dashed ring); Unblock forms a fresh link;
  Forget deletes what a blocked person sent that you never answered (the
  SDK keeps any history you acted on, and the page says so).
- **Backup and restore of contacts and requests.** You > Contacts and
  requests backup seals Paykit's backup (which the SDK leaves
  unencrypted) and the app's own records with a key from the recovery
  phrase, then Copy or Share; "Check a copied backup" restores it into a
  throwaway in-memory SDK handle and says what it holds. A restored
  wallet can paste a backup on the sign-in step of onboarding. The
  phrase alone opens a backup, but you must keep the backup text.
- **Network details** shows each contact's Encrypted Link recovery
  markers and the backup revisions.

Checked on both simulators, still without money (the demo wallets are
empty): Ana offered Ben automatic payments and Ben accepted; Ben's
recurring USD₮ request to Ana was matched by the SDK
(`evaluateAllowanceCandidates`) and stopped at "Not enough USD₮", with
nothing accepted; Ana blocked Ben (Forget was refused, as it must be
with history), unblocked him, and the link was back in about 30 seconds
with the Allowance still accepted; both phones made and checked a backup
(1 contact, 4 and 5 requests). Not exercised: an automatic acceptance
and payment (needs funds), and the onboarding restore (needs wiping a
demo identity). Details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
"Automatic payments" and "Backup and restore".

Known gaps left for Phase 6 (polish): the recovery phrase screens do not
block screenshots yet (Android `FLAG_SECURE` needs a native module and a
rebuild), sign-up errors share one message instead of one per cause, and
Welcome has its Phase 2 copy. The plan is in
[`docs/PLAN.md`](docs/PLAN.md), the design in [`docs/DESIGN.md`](docs/DESIGN.md)
and the code structure in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Run it

You need Node 24, Xcode with an iOS 26 simulator, JDK 17 and the Android SDK
with an arm64 API 36 emulator image.

```sh
scripts/build-paykit.sh          # once: builds vendor/synonymdev-react-native-paykit.tgz
npm install                      # postinstall patches Paykit and builds the WDK worklet
node scripts/demo-env.mjs        # optional: dev prefill from the git-ignored .env.demo
npx expo start --dev-client      # one Metro server for both platforms
```

Native builds (only after native dependencies change). On a 16 GB Mac run
one build at a time: no Android emulator during the Xcode build, no iOS
simulator during the Gradle build.

```sh
# iOS
npx expo prebuild --platform ios --clean
npx expo run:ios --device "<simulator name or UDID>" --no-bundler

# Android (shut the iOS simulator down first)
npx expo prebuild --platform android --clean
(cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew assembleDebug && ./gradlew --stop)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
```

Open the dev client on `http://localhost:8081`. **Never reload with Cmd-R or
the dev menu once Paykit has loaded**: relaunch the app cold instead.

```sh
URL='exp+paykit-wdk-wallet://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081'
xcrun simctl terminate booted com.jasonvdb.paykitwdkwallet && xcrun simctl openurl booted "$URL"
adb shell am force-stop com.jasonvdb.paykitwdkwallet && \
  adb shell am start -a android.intent.action.VIEW -d "$URL" com.jasonvdb.paykitwdkwallet
```

After editing `wdk.config.js`, run `npm run wdk-bundle` and relaunch cold.
The bundle is JavaScript loaded through Metro, so no native rebuild is
needed.

### First launch

Onboarding: **Get started**, then **Restore** (dev builds restore the demo
phrase from `.env.demo` without showing it on screen), **Sign in**,
optionally a name and photo, then **Go to wallet**. Later launches import
the saved session and go straight to the tabs.

A restored wallet always signs in. Only a wallet created on the device (or
one you mark as "This phrase has no identity yet") signs up with an invite
code. The app never falls back from a failed sign-in to sign-up, because
the SDK reports every sign-in failure the same way and a code works only
once.

On iOS, Keychain items survive an uninstall: after a reinstall the WDK
seed, the Pubky session secret and the storage key are still there, and
onboarding offers to continue with that wallet.

Add the other phone as a contact from People > Add, or with a deep link:

```sh
xcrun simctl openurl booted "paykitwdk://contact?pubky=<their pubky>"
adb shell am start -a android.intent.action.VIEW -d "paykitwdk://contact?pubky=<their pubky>"
```

Add person shows who the key belongs to before saving. Both phones must
add each other; the seal ring closes when the private link is ready, and
each phone then shares a Private Payment List with the other (the Person
page shows both directions). Removing a contact withdraws your list and
ends the link; adding each other again forms a new one. You > Sync status
shows the sync loop and its event log, and You > Network details counts the
lists shared each way.

Simulators cannot scan each other's QR codes, so the wallet screens also
open from links:

```sh
xcrun simctl openurl booted "paykitwdk://receive?asset=usdt"
xcrun simctl openurl booted "paykitwdk://receive?code=pubky"           # your pay-me code
xcrun simctl openurl booted "paykitwdk://send?to=<address>&asset=btc"   # fills the form; nothing is sent
xcrun simctl openurl booted "paykitwdk://send?to=<pubky>&asset=usdt"    # pay a person by their public endpoints
xcrun simctl openurl booted "paykitwdk://profile"                      # edit your name and photo
xcrun simctl openurl booted "paykitwdk://scan"                         # scan a code (camera, photo or paste)
xcrun simctl openurl booted "paykitwdk://you"                          # also wallet, people, requests
xcrun simctl openurl booted "paykitwdk://request-money?pubky=<pubky>"  # ask a contact for money
xcrun simctl openurl booted "paykitwdk://request?counterparty=<pubky>&requestId=<id>"  # one request
xcrun simctl openurl booted "paykitwdk://person?pubky=<pubky>"         # a contact's Person page
xcrun simctl openurl booted "paykitwdk://automatic-payments?pubky=<pubky>"  # offer them automatic payments
```

To test the scanner on a simulator, put a screenshot of the other phone's
pay-me code into the photo library and use "Choose a photo of a code":

```sh
xcrun simctl addmedia booted pay-me-code.png
adb push pay-me-code.png /sdcard/Pictures/ && \
  adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/pay-me-code.png
```

Public endpoints (You > What you publish) let anyone pay you by your
pubky; switching an asset off removes its endpoint from your homeserver,
and payers are told you don't accept it. Contacts get private addresses
either way.

`.env.demo` (git-ignored, mode 600) can hold `IOS_MNEMONIC`, `ANDROID_MNEMONIC`,
one single-use staging signup code per platform, and the two public keys.
`node scripts/demo-env.mjs --generate-missing` creates missing mnemonics.

### Funding the demo

The demo wallets start empty. Everything below runs on the Mac, reads
`.env.demo`, and never prints a phrase or a token. The iOS demo wallet is
the treasury: its Ethereum account pays for the Sepolia scripts.

```sh
node scripts/fund-status.mjs                 # both wallets: BTC (Mutinynet), ETH and USD₮ (Sepolia)
node scripts/fund-status.mjs --contacts 3    # plus BTC contact accounts 1..3
node scripts/fund-eth.mjs android 0.001      # Sepolia ETH (gas) from the treasury to Android
node scripts/fund-usdt.mjs android 1000      # mint Aave test USD₮ (treasury pays gas)
node scripts/fund-btc.mjs --login            # once a day: GitHub device login for the Mutinynet faucet
node scripts/fund-btc.mjs ios 100000         # Mutinynet sats from the faucet API
```

One-time human steps:

1. **Sepolia ETH for the treasury.** Send about 0.05 Sepolia ETH to the iOS
   wallet's Ethereum address (`node scripts/fund-status.mjs` prints it) from
   a public faucet, such as Google Cloud's Web3 faucet or the pk910 PoW
   faucet. After that, `fund-eth` and `fund-usdt` (and the in-app "Get test
   USD₮" button) need no human.
2. **Mutinynet faucet token.** `node scripts/fund-btc.mjs --login` prints a
   GitHub device code: open <https://github.com/login/device>, enter it, and
   approve the Mutinynet faucet app. The script exchanges the GitHub token
   for the faucet's 24-hour token and saves it as `MUTINYNET_FAUCET_TOKEN`
   in `.env.demo`. The faucet gives at most 1,000,000 sats per GitHub user
   and IP per day. The `--login` flow has not been run end to end yet. If it
   fails, use the faucet's own CLI (`cargo install mutinynet-cli`,
   `mutinynet-cli login`) and put the token it stores in
   `~/.mutinynet/token` into `.env.demo` as `MUTINYNET_FAUCET_TOKEN=…`.
   Background: [`docs/research/04-testnet-funding.md`](docs/research/04-testnet-funding.md).

In the app, You > Test funds has "Get test USD₮" (disabled, with the reason,
while the wallet has no ETH for gas) and links to the faucets.

### Checks

```sh
npm run typecheck
npm run lint
npm test
```

Screenshots of each phase on both platforms are in
[`docs/screenshots/`](docs/screenshots/) (`phase1/` to `phase6/`); the Phase 0 spike
screenshots are in [`docs/spike/`](docs/spike/).

Before taking screenshots, hide the dev client's floating tools button so
it does not cover the Testnet chip (it is a dev-build setting, stored per
install; quit the app first, then relaunch it cold):

```sh
# iOS simulator
xcrun simctl spawn <udid> defaults write com.jasonvdb.paykitwdkwallet EXDevMenuShowFloatingActionButton -bool false
# Android emulator: add <boolean name="showFab" value="false" /> to
# shared_prefs/expo.modules.devmenu.sharedpreferences.xml (adb shell run-as com.jasonvdb.paykitwdkwallet)
```

Never capture a screen that shows the recovery phrase.

## Paykit package

Paykit's React Native bindings come from the unmerged
[paykit-rs PR #204](https://github.com/pubky/paykit-rs/pull/204). They are not
on npm yet, so `scripts/build-paykit.sh` builds them from a pinned commit and
packs `vendor/synonymdev-react-native-paykit.tgz`.
