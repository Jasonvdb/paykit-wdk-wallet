# Paykit × WDK example wallet

A React Native example wallet that shows how [Tether WDK](https://wdk.tether.io/)
and [Pubky Paykit](https://github.com/pubky/paykit-rs) work together:

- **WDK** holds the keys and moves the money (testnet only).
- **Paykit** turns Pubky identities into payable contacts: public and private
  payment endpoints, payment requests and more.

> **Testnet only. Not production software.** This repository is a reference for
> developers. Keys are stored with simple demo-grade protection.

## Status

Phases 1 (foundation), 2 (wallet) and 3 (identity and public payments)
are done: the app skeleton, design system, navigation, the wallet and
Paykit service layers, and the WDK side of the app: receive cards with QR
codes, sending to an address with a fee review, activity with a detail
screen, the recovery phrase, "Get test USD₮", collecting BTC from contact
accounts, and demo funding scripts. Phase 3 adds your profile (name and
photo, shown in every seal), the pay-me code (your pubky as a QR), public
payment endpoints you switch on or off per asset, paying anyone by pubky
through those endpoints, a QR scanner, and a developer "Network details"
section. Later phases add contacts with private payments and payment
requests. The plan is in
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

Both phones must add each other; the seal ring closes when the private link
is ready. You > Sync status shows the sync loop and its event log.

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
[`docs/screenshots/`](docs/screenshots/) (`phase1/`, `phase2/`, `phase3/`); the Phase 0 spike
screenshots are in [`docs/spike/`](docs/spike/).

## Paykit package

Paykit's React Native bindings come from the unmerged
[paykit-rs PR #204](https://github.com/pubky/paykit-rs/pull/204). They are not
on npm yet, so `scripts/build-paykit.sh` builds them from a pinned commit and
packs `vendor/synonymdev-react-native-paykit.tgz`.
