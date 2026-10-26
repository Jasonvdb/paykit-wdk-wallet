# Paykit × WDK example wallet

A React Native example wallet that shows how [Tether WDK](https://wdk.tether.io/)
and [Pubky Paykit](https://github.com/pubky/paykit-rs) work together:

- **WDK** holds the keys and moves the money (testnet only).
- **Paykit** turns Pubky identities into payable contacts: public and private
  payment endpoints, payment requests and more.

> **Testnet only. Not production software.** This repository is a reference for
> developers. Keys are stored with simple demo-grade protection.

## Status

Work in progress. The plan and research notes live in [`docs/`](docs/).

## Run it

Phase 0 is a spike: one screen (`src/spike/`) that drives WDK and Paykit end
to end. You need Node 24, Xcode with an iOS 26 simulator, JDK 17 and the
Android SDK with an arm64 API 36 emulator image.

```sh
scripts/build-paykit.sh          # once: builds vendor/synonymdev-react-native-paykit.tgz
npm install                      # postinstall patches Paykit and builds the WDK worklet
node scripts/demo-env.mjs        # optional: dev prefill from the git-ignored .env.demo
npx expo start --dev-client      # one Metro server for both platforms

# iOS (in another terminal)
npx expo prebuild --platform ios --clean
npx expo run:ios --device "<simulator name or UDID>" --no-bundler

# Android (stop the iOS simulator first on a 16 GB Mac)
npx expo prebuild --platform android --clean
(cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew assembleDebug && ./gradlew --stop)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
```

Open the dev client on `http://localhost:8081`. On the spike screen, tap the
buttons from top to bottom: init wallet, balances, Paykit sign-in, publish
endpoints, then resolve and link the other simulator's pubky.

`.env.demo` (git-ignored, mode 600) can hold `IOS_MNEMONIC`, `ANDROID_MNEMONIC`,
one single-use staging signup code per platform, and the two public keys.
`node scripts/demo-env.mjs --generate-missing` creates missing mnemonics.

## Paykit package

Paykit's React Native bindings come from the unmerged
[paykit-rs PR #204](https://github.com/pubky/paykit-rs/pull/204). They are not
on npm yet, so `scripts/build-paykit.sh` builds them from a pinned commit and
packs `vendor/synonymdev-react-native-paykit.tgz`.
