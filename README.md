# Paykit × WDK example wallet

A React Native example wallet that shows how [Tether WDK](https://wdk.tether.io/)
and [Pubky Paykit](https://github.com/pubky/paykit-rs) work together:

- **WDK** holds the keys and moves the money (testnet only).
- **Paykit** turns Pubky identities into payable contacts: public and private
  payment endpoints, payment requests and more.

> **Testnet only. Not production software.** This repository is a reference for
> developers. Keys are stored with simple demo-grade protection.

## Status

Phase 1 (foundation) is done: the app skeleton, design system, navigation
with a screen for every route, and the wallet and Paykit service layers.
Later phases fill in the feature screens. The plan is in
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

`.env.demo` (git-ignored, mode 600) can hold `IOS_MNEMONIC`, `ANDROID_MNEMONIC`,
one single-use staging signup code per platform, and the two public keys.
`node scripts/demo-env.mjs --generate-missing` creates missing mnemonics.

### Checks

```sh
npm run typecheck
npm run lint
npm test
```

Screenshots of the foundation running on both platforms are in
[`docs/screenshots/phase1/`](docs/screenshots/phase1/); the Phase 0 spike
screenshots are in [`docs/spike/`](docs/spike/).

## Paykit package

Paykit's React Native bindings come from the unmerged
[paykit-rs PR #204](https://github.com/pubky/paykit-rs/pull/204). They are not
on npm yet, so `scripts/build-paykit.sh` builds them from a pinned commit and
packs `vendor/synonymdev-react-native-paykit.tgz`.
