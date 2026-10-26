# 01 - Consuming `@synonymdev/react-native-paykit` (paykit-rs PR #204) in a new React Native app

Source of truth: `pubky/paykit-rs` PR #204, branch `feat/react-native-bindings`, pinned head
`23c702c8f75c7bc211b2deaaaafbcac6f33f15d1` (PR is OPEN, not draft, mergeable, no human review yet;
two Codex rounds, final one "no major issues"). Paths below are relative to the repo root of that commit
unless absolute. Reference clone (read-only):
`/private/tmp/claude-501/-Users-jason-Documents-Repositories/008626ab-f4cf-47ae-baa1-9f7a347c4ea6/scratchpad/ref/paykit-rs`.

Everything marked **(unverified)** was inferred, not observed.

---

## 0. TL;DR for the planner

- The package is **not on npm** (`npm view @synonymdev/react-native-paykit` -> 404). We must build it
  from source at the pinned commit and install the result as an `npm pack` tarball, exactly as the
  example app does (`"@synonymdev/react-native-paykit": "file:tarballs/synonymdev-react-native-paykit.tgz"`).
- Build = Rust cross-compile through **uniffi-bindgen-react-native (ubrn) `0.29.3-1`** (an npm package that
  ships the CLI as Rust source and compiles it with cargo on first use).
- For our two simulators on this Apple-silicon Mac, build **only** iOS simulator + Android `arm64-v8a`:
  `npm run build:ios -- --sim-only` and `npm run build:android -- --targets arm64-v8a`.
  The README's `--targets x86_64` hint is for the x86_64 CI emulator; this Mac's emulator images are
  `arm64-v8a` only (`system-images/android-{28,36}/google_apis/arm64-v8a`).
- Consumer app must be **RN New Architecture + Hermes**. Safest: copy the example's versions exactly:
  **react-native 0.78.2, react 19.0.0**, `@react-native-community/cli` 15.0.1, Gradle 8.12, Kotlin 2.0.21,
  compileSdk/targetSdk 35, minSdk 24, NDK `28.2.13676358`, iOS 15.1.
- Mandatory consumer tweaks: Podfile `fmt` C++17 fix (RN 0.78 + Xcode 26), Podfile `EXCLUDED_ARCHS[sdk=iphonesimulator*]=x86_64`,
  Android `reactNativeArchitectures=arm64-v8a` (the library's Gradle `preBuild` check fails if any listed ABI lacks `libpaykit.so`),
  `newArchEnabled=true`, `hermesEnabled=true`. Android TLS init is automatic (TurboModule constructor).
- The three callback interfaces (`FfiSdkStateBlobStore`, `FfiSdkPubkySessionProvider`, `FfiSdkPaymentAdapter`) are
  **synchronous**, run **on the JS thread** while a Rust worker blocks waiting. You cannot `await` WDK inside them.
  Pre-fetch WDK receive addresses into a JS cache and return them synchronously.
- Alternative that removes the sync encrypted store requirement: `FfiPaykitSdk.withPaymentAdapterAndPubkySharedStateAndClientConfig(...)`
  keeps SDK state encrypted on the Pubky homeserver (slower; homeserver write locks + "shared-state cooldown").
- Staging homeserver pubkey: `ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy` (behind `staging.pubky.app`).
  First run per identity: `FfiPubkySessionBootstrap.signUp(secret, homeserver, signupToken, paykitAuthorizerSessionCapabilities())`;
  later runs: `signIn(secret, caps)`.
- Android API 36 known issue: only HTTPS to the **public pkarr relays** (`https://pkarr.pubky.app`, `https://pkarr.pubky.org`)
  fails (OCSP-less Let's Encrypt certs). Homeserver traffic is unaffected (pkarr raw-public-key TLS). In the PR author's
  API 36 + staging run, 7/8 smoke steps passed; only the dedicated `android_https` step failed.

---

## 1. Building the native artifacts and the npm tarball from a fresh clone

### 1.1 What gets built

From `paykit-react-native/README.md` and `ubrn.config.yaml`:

| Artifact | Source | Notes |
|---|---|---|
| `SynonymdevReactNativePaykitFramework.xcframework` | `ubrn build ios` | static `libpaykit.a`; slices `ios-arm64` + `ios-arm64-simulator`. **No x86_64 sim slice.** |
| `android/src/main/jniLibs/<abi>/libpaykit.so` | `ubrn build android` (cargo-ndk) | ABIs from config: `arm64-v8a, armeabi-v7a, x86_64, x86`; 16 KB page aligned (`.cargo/config.toml` rustflags) |
| `android/libs/rustls-platform-verifier.jar` | `scripts/android-elf.mjs` (`postbuild:android`) | extracted from vendored AAR `vendor/rustls-platform-verifier-android/maven/...` via `cargo metadata` |
| `src/generated/paykit.ts`, `cpp/generated/paykit.{cpp,hpp}` | `--and-generate` | not committed; generated each build |
| `lib/module/*`, `lib/typescript/*` | `bob build` (`prepack`) | react-native-builder-bob 0.43.2 |

`ubrn.config.yaml` (key parts):
```yaml
rust:     { directory: ../paykit-ffi, manifestPath: Cargo.toml }
bindings: { ts: src/generated, cpp: cpp/generated }
ios:      { targets: [aarch64-apple-ios, aarch64-apple-ios-sim], cargoExtras: [--locked] }
android:  { targets: [arm64-v8a, armeabi-v7a, x86_64, x86], apiLevel: 21, cargoExtras: [--locked], useSharedLibrary: true }
noOverwrite:
  - android/build.gradle
  - android/src/main/java/com/synonymdev/reactnativepaykit/ReactNativePaykitModule.kt
```

npm scripts (`paykit-react-native/package.json`):
```
build:ios             = npm run build:ios:xcframework -- --and-generate
build:ios:xcframework = IPHONEOS_DEPLOYMENT_TARGET=13.4 ubrn build ios --config ubrn.config.yaml --release
build:android         = ubrn build android --config ubrn.config.yaml --and-generate --release
postbuild:android     = node scripts/android-elf.mjs        # writes verifier jar, llvm-strip, 16KB + JNI symbol checks
prepack               = bob build
pack:check / ios:check / android:assemble / example:refresh  (verification + example install)
```

### 1.2 Toolchain prerequisites (and what this Mac already has)

| Need (README / CI) | This Mac |
|---|---|
| Node from `.nvmrc` = **24.15.0**, npm | node v24.22.1, npm 11.19.1 (fine; `.nvmrc` is not enforced) |
| Rust stable (crate MSRV `rust-version = "1.91.1"`; no `rust-toolchain` file) | rustup stable |
| `rustup target add aarch64-apple-ios aarch64-apple-ios-sim` | installed |
| `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android` | installed |
| `cargo install cargo-ndk --version 3.5.4 --locked` | cargo-ndk 3.5.4 installed |
| JDK 17 (CI `temurin 17`) | default `java` = openjdk 21 (`/opt/homebrew/opt/openjdk@21`); **openjdk@17 also installed** at `/opt/homebrew/opt/openjdk@17` |
| Android SDK platform 35, NDK r28c `28.2.13676358` | `$ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`, platforms 31/34/35/36, NDK 27.1.12297006 + 28.2.13676358, build-tools 34/35/36 |
| Xcode + CLT, CocoaPods | Xcode 26.6, CocoaPods 1.17.0 |
| `llvm-strip`/`llvm-readelf` | found via `ANDROID_NDK_HOME` by `android-elf.mjs` |

ubrn: `uniffi-bindgen-react-native@0.29.3-1` (npm dependency of the package; pod dependency `uniffi-bindgen-react-native (= 0.29.3-1)`).
It has no postinstall script (`npm view ... scripts` -> only `test`), so pnpm 10's script blocking is irrelevant to it.
Its `ubrn` bin (`bin/cli.cjs`) compiles the Rust CLI on first use (CI caches `paykit-react-native/node_modules/uniffi-bindgen-react-native -> target`).
Latest ubrn on npm is `0.31.0-6`; do **not** upgrade - it pins UniFFI and the PR is built for `0.29.3-1`
(workspace `Cargo.lock` has `uniffi 0.29.5`; PR body says ubrn pins `=0.29.3` and "generates fine against our 0.29.x metadata").

Other lockfile versions worth knowing: `pubky 0.16.2`, `pkarr 8.1.0`, `pubky-noise 0.1.0`, `reqwest 0.13.2`,
`rustls-platform-verifier 0.6.2` (Android verifier AAR vendored + patched under `vendor/`, `[patch.crates-io]` in root `Cargo.toml`).

### 1.3 Exact commands (fresh clone, our reduced target set)

Policy note: per our "no local checkouts as build deps" rule, clone **upstream at the pinned SHA** into a
gitignored build dir inside our repo (or scratch), never reuse `~/Documents/Repositories/paykit-rs`.

```sh
# 0. env
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358
export ANDROID_NDK_ROOT=$ANDROID_NDK_HOME
export JAVA_HOME=/opt/homebrew/opt/openjdk@17      # match CI; 21 likely also works (unverified)

# 1. clone the pinned commit
git clone --filter=blob:none https://github.com/pubky/paykit-rs.git .paykit-build/paykit-rs
git -C .paykit-build/paykit-rs checkout --detach 23c702c8f75c7bc211b2deaaaafbcac6f33f15d1

# 2. JS deps of the package (installs ubrn 0.29.3-1, bob, RN 0.78.2 dev deps)
cd .paykit-build/paykit-rs/paykit-react-native
npm ci

# 3. native builds - only what our sims need
npm run build:ios -- --sim-only                  # -> ubrn build ios ... --release --and-generate --sim-only
npm run build:android -- --targets arm64-v8a     # -> ubrn build android ... --and-generate --release --targets arm64-v8a
#    postbuild:android then runs scripts/android-elf.mjs automatically (jar + strip + ELF checks)

# 4. pack (prepack runs `bob build`)
npm pack --pack-destination ../../../vendor/paykit      # -> synonymdev-react-native-paykit-0.1.0.tgz
#    (example-refresh.mjs does the same via: npx bob build && npm pack --json --ignore-scripts)
```

Notes on reduced targets:
- `--sim-only` and `-t/--targets` are documented ubrn 0.29.3-1 flags (`docs/src/reference/commandline.md` at tag `0.29.3-1`).
  `--sim-only` builds only triples containing `sim` -> XCFramework with only `ios-arm64-simulator`. Fine for simulators;
  a device build would fail to link. `npm run ios:check` and `npm run pack:check` would **fail** on a reduced build (they
  require both iOS slices / all four ABIs) - skip them, or build full.
- `--targets arm64-v8a` is the README's own pattern (`npm run build:android -- --targets x86_64`). `example-refresh.mjs`
  already accepts any single ABI (fixed in 83617a5 after Codex P1).
- If you also want physical-device iOS later, drop `--sim-only` (~doubles iOS compile).

### 1.4 Time and disk (estimates)

From CI run [39568430637](https://github.com/pubky/paykit-rs/actions/runs/39568430637) (this commit's ancestor, cached ubrn CLI, no cached cross target dir):
- `build:ios` both slices on `macos-15` runner: **~9.5 min** (17 min when sharing the runner with the pubky-testnet build).
- `build:android` 4 ABIs on `ubuntu-latest`: **~14 min**; x86_64 only: **~7.5 min**.
- Example app builds: iOS Release `xcodebuild` ~10 min; Android `assembleRelease` single ABI ~5 min; `pod install` ~45 s.
- Local estimate on this Mac (first build also compiles the ubrn CLI): iOS sim-only ~5-10 min, Android arm64 ~5-8 min (**unverified**).

Disk: tarball ~**80 MB** (228 MB unpacked) for the full target set per PR body, "mostly the iOS xcframework"; a sim-only + arm64
tarball should be roughly half (**unverified**). Cargo `target/` for 2-3 cross targets with aws-lc in release: expect
**~5-10 GB** (**unverified**). Mac has ~67 GiB free.

Do not commit an 80 MB tarball (GitHub warns >50 MB, rejects >100 MB). Options: build script that produces it on demand
(gitignored `vendor/paykit/*.tgz`), or attach it to a GitHub Release on the personal repo and download in a setup script.

Memory caveat (host note): this 17 GB Mac has panicked when emulator + simulator + Xcode + Gradle ran together.
Run the Rust builds and app builds **serially**, and stop the emulator during heavy builds.

---

## 2. How the example consumes it, and every special config a consumer needs

### 2.1 Install method
`example/package.json`: `"@synonymdev/react-native-paykit": "file:tarballs/synonymdev-react-native-paykit.tgz"` (tarball gitignored).
`scripts/example-refresh.mjs` (worth copying the idea):
1. `npx bob build` then `npm pack --json --ignore-scripts --pack-destination example/tarballs`, renamed to a **fixed name** so `package.json` never changes;
2. deletes `example/node_modules/@synonymdev` (npm keeps an installed `file:` tarball when the lock entry matches);
3. **drops the `integrity` field** for that entry in `package-lock.json` before and after `npm install` - otherwise npm/pacote installs the *cached old tarball* after a native rebuild;
4. asserts `package.json` + one native lib in `node_modules` are byte-identical to the tarball.

Gotcha to carry over: after every native rebuild, re-run this refresh, then `pod install`, and clean Android `.cxx`/build.

Package manager: the example uses **npm**. With pnpm 10 you would need `node-linker=hoisted` (RN autolinking, CocoaPods, and the
library's `CMakeLists.txt` which runs `node -p "require.resolve('uniffi-bindgen-react-native/package.json')"`) - use npm to stay on the proven path (**pnpm unverified**).

### 2.2 Exact versions the example uses (`example/package.json`, `Podfile.lock`, Gradle files)

| Item | Version |
|---|---|
| react-native | **0.78.2** |
| react | **19.0.0** |
| @react-native-community/cli (+ platform-android/ios) | 15.0.1 |
| @react-native/babel-preset, metro-config, typescript-config | 0.78.2 |
| @babel/core / preset-env / runtime | 7.29.7 / 7.29.7 / 7.29.10 |
| typescript | 5.8.3 |
| @types/react | 19.3.0 |
| hermes-engine pod | 0.78.2 |
| Gradle wrapper | 8.12 (`gradle-8.12-all.zip`) |
| AGP | from RN Gradle plugin (no explicit version in root `build.gradle`) |
| Kotlin | 2.0.21 |
| buildToolsVersion / compileSdk / targetSdk / minSdk | 35.0.0 / 35 / 35 / 24 |
| ndkVersion | `findProperty("ndkVersion") ?: "28.2.13676358"` |
| iOS deployment target | 15.1 (`min_ios_version_supported`) ; Rust lib built for 13.4 |
| Package peerDeps | `react: *`, `react-native: *` |

Newer RN (0.79+) is **unverified** with this ubrn version. Notably the generated Kotlin package extends
`com.facebook.react.TurboReactPackage` (deprecated in newer RN) and the CMake file sniffs `ReactAndroid_VERSION_MINOR >= 76`
for the merged `reactnative` .so. If WDK's RN integration needs a newer RN, budget time for this risk. Prefer 0.78.2.

### 2.3 Required runtime architecture
- New Architecture only (TurboModule + JSI); `newArchEnabled=true` (`example/android/gradle.properties`). iOS New Arch is
  default in RN 0.78 templates (AppDelegate subclasses `RCTAppDelegate`, `RCTAppDependencyProvider`).
- **Hermes** (`hermesEnabled=true`). README: "Hermes." required. Expo Go cannot load it; Expo dev build only.
- JS init: importing the package runs `installer.installRustCrate()` then `paykit.default.initialize()` once (`src/index.tsx`).
  `uniffiInitAsync()` is a no-op on native.
- Metro: default config, nothing special (`example/metro.config.js` = `mergeConfig(getDefaultConfig(__dirname), {})`).
  Because the package is installed from a tarball (not a symlink/workspace), no `watchFolders` are needed.
  Package `exports` has only `types` and `default` (-> `lib/module/index.js`).
- Babel: `presets: ['module:@react-native/babel-preset']`.
- TS: `extends @react-native/typescript-config/tsconfig.json`. uniffi `u64` fields are `bigint` in TS (e.g.
  `FfiPubkyClientConfig.requestTimeoutSecs`) - spread `defaultPubkyClientConfig()` rather than writing literals. Amounts are decimal **strings**.

### 2.4 iOS / Podfile tweaks (copy from `example/ios/Podfile`)
```ruby
post_install do |installer|
  react_native_post_install(installer, config[:reactNativePath], :mac_catalyst_enabled => false)
  # RN 0.78 pins fmt 11.0.2 which does not compile as C++20 with Xcode 26 clang.
  installer.pods_project.targets.each do |target|
    next unless target.name == 'fmt'
    target.build_configurations.each { |bc| bc.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17' }
  end
  # XCFramework has arm64 simulator slice only -> never build x86_64 for the simulator.
  excluded_archs = 'EXCLUDED_ARCHS[sdk=iphonesimulator*]'
  installer.pods_project.build_configurations.each { |bc| bc.build_settings[excluded_archs] = 'x86_64' }
  installer.aggregate_targets.map(&:user_project).uniq.each do |project|
    project.native_targets.each do |t|
      t.build_configurations.each { |bc| bc.build_settings[excluded_archs] = 'x86_64' }
    end
    project.save
  end
end
```
- Symptom without the arch fix: `ld: library 'paykit' not found` (Release, or any `ONLY_ACTIVE_ARCH=NO`). CI alternative: pass `ARCHS=arm64` to `xcodebuild`.
- The example's `project.pbxproj` also hard-sets `"EXCLUDED_ARCHS[sdk=iphonesimulator*]" = x86_64` for the app target.
- `Info.plist`: `NSAllowsArbitraryLoads=false`, `NSAllowsLocalNetworking=true` (only needed for the local stack), `UIRequiredDeviceCapabilities=[arm64]`.
- `.xcode.env`: `export NODE_BINARY=$(command -v node)`.
- Podspec: `ReactNativePaykit`, `vendored_frameworks = "SynonymdevReactNativePaykitFramework.xcframework"`, uses `install_modules_dependencies(s)`.
- `AppDelegate.swift` sets `RCTSetLogThreshold(.info)` so Release builds still print `console.log` (only needed for log-scraping).
- Do not `use_frameworks!` unless needed (example honors `USE_FRAMEWORKS` env but default is static) - **dynamic frameworks unverified**.

### 2.5 Android tweaks
- `android/gradle.properties` (app): `newArchEnabled=true`, `hermesEnabled=true`, `android.useAndroidX=true`,
  **`reactNativeArchitectures=arm64-v8a`** for our build. The library's `android/build.gradle` registers
  `checkPaykitNativeArtifacts` on `preBuild`: it fails with *"Missing Paykit native artifacts ... Run npm run build:native"*
  if `src/main/jniLibs/<abi>/libpaykit.so` is missing for **any** ABI in `reactNativeArchitectures` (default list is all four). CLI alternative: `-PreactNativeArchitectures=arm64-v8a`.
- Root `build.gradle` ext: `ndkVersion = "28.2.13676358"` (app's value overrides the lib's `ReactNativePaykit_ndkVersion`;
  override with `-PndkVersion=` in the example, `-PReactNativePaykit_ndkVersion=` for the standalone lib).
  NDK 27.1 would also be possible (`android-assemble` comment shows it) but CI and the example use 28.2.
- minSdk 24 (lib default `ReactNativePaykit_minSdkVersion=24`), compileSdk 35, targetSdk 34 (lib) / 35 (app). Java 17 source/target in the lib.
- **16 KB pages**: `libpaykit.so` linked with `-z max-page-size=16384,-z common-page-size=16384` (workspace `.cargo/config.toml`),
  and the TurboModule `.so` gets the same flags via CMake args in the lib's `build.gradle`. `android-elf.mjs` verifies every LOAD segment alignment >= 16384 and that `Java_com_synonym_paykit_PaykitAndroid_nativeInitialize` is exported. Nothing to do in the app.
- **aws-lc allocator hook fix** (also `.cargo/config.toml`): `--defsym=sdallocx=0,...OPENSSL_memory_*=0` - because RN's `libreactnative.so` exports a data symbol `sdallocx` and the first TLS handshake jumped into `.bss`. Built in; just never rebuild `libpaykit.so` with other flags.
- Packaging: lib excludes `libc++_shared.so`, `libfbjni.so`, `libjsi.so`, `libreactnative.so` from its AAR (app gets them from `react-android`).
- **TLS init hook**: `ReactNativePaykitModule.init { PaykitAndroid.initializeOrThrow(reactContext) }` - runs when RN creates the TurboModule, before JS can reach the bindings. `PaykitAndroid` (`com.synonym.paykit`) does `System.loadLibrary("paykit")` and calls JNI `nativeInitialize(applicationContext)` -> `rustls_platform_verifier::android::init_with_env`. Throws `IllegalStateException` on failure. **Apps do nothing**.
- **Never also add** the Kotlin artifact `com.synonym:paykit-android` - duplicate `com.synonym.paykit.PaykitAndroid` + `libpaykit.so`.
- R8: lib ships consumer rules (`-keep class org.rustls.platformverifier.** { *; }` and keep `PaykitAndroid` natives). Example keeps `enableProguardInReleaseBuilds = false`.
- Manifest: `INTERNET` permission; debug manifest has `usesCleartextTraffic=true` (local stack only).
- `MainApplication.kt` is stock RN 0.78 (`SoLoader.init(this, OpenSourceMergedSoMapping)`, `load()` when new arch). Autolinking via `settings.gradle` `autolinkLibrariesFromCommand()` and `app/build.gradle` `autolinkLibrariesWithApp()`.
- Gradle JVM args: `-Xmx2048m -XX:MaxMetaspaceSize=512m`.

---

## 3. Version summary (repeat of 2.2 for quick reference)
RN **0.78.2**, React **19.0.0**, Hermes 0.78.2, CLI 15.0.1, TypeScript 5.8.3, Gradle 8.12, Kotlin 2.0.21, SDK 35/35/24, NDK 28.2.13676358,
iOS 15.1, ubrn **0.29.3-1**, package `@synonymdev/react-native-paykit@0.1.0` (paykit-ffi crate `0.1.1-rc1`).

---

## 4. The JS callbacks: how the example implements them

Generated TS keeps Rust names with the `Ffi` prefix (`FfiPaykitSdk`, not `PaykitSdk`); ubrn 0.29 has no rename.
The generated `src/generated/paykit.ts` is **not committed**, so the interfaces below are reconstructed from the Rust
`#[uniffi::export(with_foreign)]` traits plus ubrn's naming rules (camelCase, `Option<T>` -> `T | undefined`, `Result` error -> thrown
`PaykitFfiError`). They match how the example's classes `implements` them (**exact generated text unverified**; regenerate to confirm).

### 4.1 `FfiSdkStateBlobStore` (`paykit-ffi/src/storage.rs:38`)
```ts
interface FfiSdkStateBlobStore {
  /** Current blob + revision, or undefined. */
  loadStateBlob(): FfiSdkStateBlobSnapshot | undefined;
  /** Throw PaykitFfiError.ConcurrentUpdate (write nothing) if stored revision != expectedRevision
   *  (incl. expectedRevision undefined while a blob exists). Return a NEW, never-reused, non-empty revision. */
  saveStateBlobAtomically(blob: FfiSdkStateBlobInterface, expectedRevision: string | undefined): string;
}
type FfiSdkStateBlobSnapshot = { blob: FfiSdkStateBlobInterface; revision: string };
// FfiSdkStateBlob: object; new FfiSdkStateBlob(bytes: ArrayBuffer); blob.exportBytes(): ArrayBuffer
```
Example: `example/src/mocks/stateBlobStore.ts` `InMemoryStateBlobStore`:
- revision = `${storeId}-${++counter}` where `storeId = Date.now().toString(36) + Math.random()...` (identifiers, not secrets);
- mode `'memory'` keeps the Rust blob object (bytes never enter JS); mode `'persisted'` stores `blob.exportBytes().slice(0)` and
  rebuilds with `new FfiSdkStateBlob(bytes.slice(0))` on load (simulates disk; used for A to prove restart);
- mismatch -> `throw new PaykitFfiError.ConcurrentUpdate({ code: 'state_revision_mismatch', context: '...' })`;
- counts `loads` to prove the restart path hit the store.
Rust contract docs: the SDK calls these **while holding the per-handle storage lock**; never call back into the same handle from them;
"Independent handles for one identity must use the same atomic backing store".

For our app (persist across launches) the README requires **synchronous encrypted** storage: e.g. `react-native-mmkv` with an
encryption key held in Keychain/Keystore, or `expo-secure-store` sync API. AsyncStorage cannot implement this interface.
Blob bytes in the JS heap cannot be zeroized; never log/inspect them. Alternative: Pubky shared-state constructors (section 4.4).

### 4.2 `FfiSdkPubkySessionProvider` (`paykit-ffi/src/session.rs:320`)
```ts
interface FfiSdkPubkySessionProvider {
  loadSessionAccess(): FfiPubkySessionAccessInterface | undefined;
  publicStorageAvailable(): boolean;
  clearSessionAccess(): void;   // SDK signOut revokes the grant before calling this
}
```
Example `example/src/mocks/sessionProvider.ts` `LiveSessionProvider` just holds the `FfiPubkySessionAccess` from bootstrap in memory;
`publicStorageAvailable()` returns `true`; `clearSessionAccess()` sets it undefined.

How the session is obtained (`signUpOrSignIn`):
```ts
const bootstrap = FfiPubkySessionBootstrap.withPubkyClientConfig(EXAMPLE_CLIENT_ID /* 'com.synonym.paykit.rnexample' */, pubkyClient);
const secret = pubkySecretKeyFromBip39Mnemonic(identity.mnemonic);      // FfiPubkyLocalSecretKey (sync)
const capabilities = paykitAuthorizerSessionCapabilities();             // authorizer caps needed for Noise key authorization
const result = signUp
  ? await bootstrap.signUp(secret, homeserverPubkey, signupToken /* string|undefined */, capabilities)
  : await bootstrap.signIn(secret, capabilities);
// result: { sessionAccess: FfiPubkySessionAccess, publicKey: 'pubky...', capability: FfiPubkyIdentityCapability }
new LiveSessionProvider(result.sessionAccess);
```
- `signUp` is used when a token is given or in local mode (local testnet accepts tokenless signup); otherwise `signIn` to the existing account.
  Rust doc: "Signing up an identity that already has an account on that homeserver publishes its homeserver record again."
- Keys: **keypair from a BIP39 mnemonic**. `PubkyLocalSecretKey::from_bip39_mnemonic` = BIP39 seed with **empty passphrase**, secret = **first 32 bytes of the 64-byte seed** (`paykit-sdk/src/identity.rs:153-184`). Also `pubkySecretKeyFromBip39Seed(seed)` and `new FfiPubkyLocalSecretKey(bytes)` / `.exportBytes()`.
  If we derive Pubky from the same mnemonic WDK uses, the Pubky secret is half of the wallet's BIP39 seed. Not a direct key leak (BIP32 master = HMAC-SHA512 over the full seed), but it is key-material reuse; acceptable for a testnet demo, call it out in docs. A separate random Pubky key stored in Keychain is cleaner.
- Example identities are public Trezor test vectors (`identities.ts`): A = `letter advice cage absurd amount doctor acoustic avoid letter advice cage above`, B = `zoo ... wrong`. **Do not reuse for our app** (anyone can derive them, and their staging accounts already exist).
- Homeservers (`example/src/launchConfig.ts`): `STAGING_HOMESERVER = 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy'` ("staging homeserver behind staging.pubky.app"); `LOCAL_HOMESERVER = '8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo'`.
- Pubky client config: `{ ...defaultPubkyClientConfig(), localTestnetHost: mode === 'local' ? host : undefined }`. For staging just use `defaultPubkyClientConfig()` (public mainline DHT + default relays). `FfiPubkyClientConfig = { requestTimeoutSecs: bigint; localTestnetHost?: string; authRelayUrl?: string }`. No way to set pkarr relays from JS.
- Signup tokens: single-use per new account on staging (`/synonym-skills:pubky-staging-invite`). Example takes them via on-screen `secureTextEntry` fields or launch args `-paykitSignupTokenA`; never commit/log.
- Persisting a session across app restarts (not done by the example): either `signIn(secret, caps)` again each launch (simplest, needs network),
  or store `sessionAccess.exportSessionSecret()` + secret bytes in Keychain and call `bootstrap.importSession(sessionSecret, localSecretKey, caps)`.
  Docs: importing/restoring a grant **replaces its previous bearer session** - don't run two independently restored handles on one grant.
- Other bootstrap API (for later "Sign in with Pubky Ring" demos): `startSignInAuth`, `startSignUpAuth`, `resumeAuth`, `approveAuth`, `approveAuthWithCompanionClaim`, `republishIdentity`.

### 4.3 `FfiSdkPaymentAdapter` (`paykit-ffi/src/payment_adapter.rs:290`)
```ts
interface FfiSdkPaymentAdapter {
  currentPublicReceivingDetails(): Array<FfiPublicReceivingDetail>;
  currentPrivateReceivingDetails(counterparty: string): Array<FfiPrivateReceivingDetail>;
  reservePrivateReceivingDetails(counterparty: string): FfiPrivateReceivingDetailReservationResponse;
  cancelPrivateReceivingDetailReservation(c: FfiPrivatePaymentEndpointReservationCancellation): void;
  selectPublicPaymentEndpointIds(req: FfiPublicPaymentEndpointSelectionRequest): Array<string>;   // candidateIds, preferred order
  buildPublicPaymentTarget(ep: FfiPublicPaymentEndpointCandidate): FfiPaymentTarget;
  selectPrivatePaymentEndpointIds(req: FfiPrivatePaymentEndpointSelectionRequest): Array<string>;
  buildPrivatePaymentTarget(ep: FfiPrivatePaymentEndpointCandidate): FfiPaymentTarget;
}
type FfiPublicReceivingDetail  = { identifier: string; payload: FfiPaymentPayload };   // same shape for Private
type FfiPaymentTarget          = { payload: FfiPaymentPayload };                        // new FfiPaymentPayload(text); payload.exportText()
type FfiPrivateReceivingDetailReservationResponse = {
  kind: FfiPrivateReceivingDetailReservationResponseKind;  // UseCurrentReceivingDetails | Reservations | Unknown
  reservations: Array<{ reservationId: string; receivingDetail: FfiPrivateReceivingDetail;
                        expiresAt: string | undefined /* RFC3339 */; attribution: FfiReservationAttribution }> };
type FfiPrivatePaymentEndpointReservationCancellation = { reservationId; counterparty; identifier; payloadHash; attribution };
type FfiPublicPaymentEndpointSelectionRequest  = { counterparty: string; amount?: { value: string; asset: string }; candidates: FfiPublicPaymentEndpointCandidate[] };
type FfiPublicPaymentEndpointCandidate         = { candidateId: string; counterparty: string; appId: string; identifier: string; payload: FfiPaymentPayload };
// Private* variants have identical shapes.
// new FfiReservationAttribution(new Map([['wallet', 'x']]))
```
Example `example/src/mocks/mockWallet.ts` `MockWallet`:
- identifiers `['btc-lightning-bolt11', 'btc-bitcoin-p2tr']` with fake payloads (`lntest-paykit-rn-example-fake-invoice-A`, `tbtest-...-fake-address-A`);
- same details publicly and privately for every counterparty (it omits the `counterparty` arg - JS allows fewer params);
- `reservePrivateReceivingDetails` returns `kind: Reservations` with one reservation per detail, ids `mock-reservation-<label>-<n>`, `expiresAt: undefined`;
- cancel is idempotent; selection = filter candidates to supported identifiers in preference order, return their `candidateId`s;
- build target = echo `endpoint.payload.exportText()` into a new `FfiPaymentPayload`. **No funds move.**

Identifier strings are free-form but validated (ASCII alnum, `-`, `_`, `.`; max 64; not `.`/`..`/`private`). Spec/examples use
`btc-bitcoin-p2wpkh`, `btc-bitcoin-p2tr`, `btc-lightning-bolt11`, `usdt-ethereum-address`, `usdt-polygon-address`, `usdt-arbitrum-address`, `usdt-tron-address`.
For testnet we should pick explicit testnet identifiers (e.g. `btc-testnet-p2wpkh`, `eth-sepolia-address` / `usdt-sepolia-address`) - naming is our choice (**no registry found; unverified convention**).

### 4.4 SDK construction
```ts
const sdk = FfiPaykitSdk.withPaymentAdapterAndPubkyClientConfig(store, provider, wallet, defaultConfig(APP_ID), pubkyClient);
```
All 8 constructors (`paykit-ffi/src/sdk.rs:113-247`): `new(store, provider, config)`, `withPubkyClientConfig`, `withPaymentAdapter`,
`withPaymentAdapterAndPubkyClientConfig`, and the shared-state family that needs **no state store callback**:
`withPubkySharedState(provider, config)`, `withPubkySharedStateAndClientConfig`, `withPaymentAdapterAndPubkySharedState`,
`withPaymentAdapterAndPubkySharedStateAndClientConfig(provider, adapter, config, pubkyClient)` - "requires active session access with current
Paykit identity key material and `requiredSessionCapabilities()`; homeserver write locks serialize shared-state transactions; uncertain writes can make the next operation wait through the shared-state cooldown". Trade-off: no JS blob store / no state bytes in JS heap, but every op does homeserver round-trips (slower; there is ongoing perf work on shared state).

`defaultConfig(appId)` -> `FfiPaykitSdkConfig { appId, endpointManagementScope, publicContactSharing }`. Example App ID `paykit-rn-example`.

---

## 5. The smoke flow, step by step (`example/src/smoke.ts`)

Runner: each step wrapped in `withTimeout(step, 90_000)` (restart: 30 s); a failing step does not stop the run; logs `SMOKE_STEP <name> pass|fail|skip <reason>` and `SMOKE_RESULT pass|fail`. `pollUntil(read, done, 30 s, every 250 ms)`.
Setup: `pubkyClient = { ...defaultPubkyClientConfig(), localTestnetHost }`, `sdkConfig = defaultConfig('paykit-rn-example')`. Both A and B live **in the same app** with separate handles/stores/wallets.

1. **offline** - `defaultConfig`, `defaultPubkyClientConfig().localTestnetHost === undefined`, `requiredSessionCapabilities().includes('/pub/paykit/')`, `pubkyPublicKeyFromSecret(pubkySecretKeyFromBip39Mnemonic(m))` for A and B (keys start with `pubky`, differ).
2. **sign_up** (per identity) - `signUpOrSignIn` (4.2) -> `new MockWallet(label)` -> `FfiPaykitSdk.withPaymentAdapterAndPubkyClientConfig(...)` ->
   `await sdk.initialize()` (check `status.capability === FfiPubkyIdentityCapability.PrivateLinkCapable`) ->
   `await sdk.publishPaykitNoiseKeyAuthorization()` -> `await sdk.publishPaykitApp('Paykit React Native example', { privatePayments: true, paymentRequests: true, receipts: true, outgoingPayments: true })`.
   A uses a `'persisted'` store, B a `'memory'` store.
3. **public_endpoint** - A `syncPublicEndpoints()` (report `{published, removed, failed}`) -> B `resolvePublicContactPayment(a.publicKey, undefined)` -> `status === FfiPublicPaymentResolutionStatus.Payable`, `payableEndpoints[].identifier/target.payload.exportText()` matches A's bolt11 -> A `syncPublicEndpointsWithReceivingDetails([])` (removes) -> B polls until `NoEndpoint`.
4. **private_payment_list** - A `initiateLinkWithPeer(b)`; B `acceptLinkWithPeer(a)`; loop both `advanceLinkHandshake(peer)` until both `.state === FfiLinkedPeerState.Linked` -> A `enqueuePrivatePaymentList(b)` -> `deliver(A,B)` = A `processOutboundPrivateMessages(b)` (`{sent, failed}`) then B polls `receivePrivateMessages(a)` until `streamItemIds.length > 0` -> B `currentPrivatePaymentLists(a)` finds the list with `appId === 'paykit-rn-example'` containing bolt11.
5. **payment_request** - A (payee) `proposePaymentRequest(b, { amount: { value: '0.00001', asset: 'btc' }, paymentReference: new FfiPaymentReference('paykit-rn-example-smoke'), proposalExpiresAt: undefined, recurrence: undefined, acceptedPaymentEndpointIdentifiers: ['btc-lightning-bolt11'], paymentEndpoints: undefined, requiredAppId: undefined, conversion: undefined, paymentDeadline: undefined, metadata: new FfiPrivateJsonObject('{}') })` -> `deliver(A,B)` -> B `receivedPaymentRequestsFrom(a)` find `proposalStreamItemId` -> B `claimAndAcceptPaymentRequest(a, id, proposalStreamItemId)` -> `deliver(B,A)` -> A polls `paymentRequestsWith(b)` until `state === FfiPaymentRequestLifecycleState.Accepted` -> B `resolvePrivatePaymentRequest(a, id, undefined)` (`status === FfiPrivatePaymentResolutionStatus.Payable`) -> (mock "pay") -> B `submitPaymentProof(a, id, { billingPeriod: undefined, paymentAppId, paymentEndpointIdentifier: 'btc-lightning-bolt11', allowanceId: undefined, conversionQuoteId: undefined, proof: new FfiPrivateJsonObject('{"test_evidence":"..."}') })` -> `deliver(B,A)` -> A polls until `ProofSubmitted`.
6. **restart** - new handle for A on the **same store object** (`buildSdk(state, a)`), `initialize()` (same publicKey), `linkedPeers()` contains B `Linked`, `paymentRequestsWith(b)` contains the request, and `store.loads` increased (blob loaded through the sync callback from a Rust worker thread). 30 s timeout turns a deadlock into a failure.
7. **typed_error** - offline handle `new FfiPaykitSdk(new InMemoryStateBlobStore(), new LiveSessionProvider(undefined), sdkConfig)`; `setDefaultPaykitAppForEndpoint('../private', undefined)` must throw `PaykitFfiError` with `error.tag === PaykitFfiError_Tags.Protocol && error.inner.code === 'validation'`. Error handling pattern: `PaykitFfiError.instanceOf(e)`, `e.tag`, `e.inner.code`. Variants: `ConcurrentUpdate, Storage, Identity, Transport, NotFound, Protocol, Policy, PaymentAdapter, RecoveryRequired, SharedStateBusy`.
8. **android_https** - Android + staging only: fresh handle with an empty store -> `paykitAppRegistry(a.publicKey)` must resolve (forces resolution over public pkarr relays via HTTPS, needs the TLS verifier init).

Gaps the example does **not** demo (all exported on `FfiPaykitSdk`, useful for our app): contacts (`saveContact`, `contactRecords`, `removeContact`, `importContacts`, `resolveProfile`, `fetchPubkyProfile`, `publishPaykitProfile`), `ensureLinkWithPeer`, `receivePrivateMessagesFromLinkedPeers`, `processPendingPrivateMessages`, `syncContactPrivatePaymentListsAndProcessOutbound`, `resolvePrivateContactPayment` / `prepareAndResolvePrivateContactPayment`, `rejectPaymentRequest` / `cancelPaymentRequest`, receipts (`prepareReceiptIssuance`, `issueReceipt`, `receipts`, `retrieveReceipt`), allowances (`proposeAllowance`, `acceptAllowance`, ...), `observeState`, backup (`exportBackupString` / `restoreBackupString`), `publishPublicContact`, `blockPeer`, `signOut`.

---

## 6. Android API 36 HTTPS / OCSP known issue

From PR #204 body ("Known issue (pre-existing, not changed here)"):
> On Android API 36, HTTPS to the public pkarr relays fails. The validator rejects Let's Encrypt certificates with no OCSP URL with
> "Certificate does not specify OCSP responder". The vendored revocation soft-fail patch (f31faff1, 185a1ed7) does not match that
> message, so the check fails closed. This affects the Kotlin binding as well.

Mechanics (traced in code):
- Which HTTP clients use the Android platform verifier? Only reqwest clients built with reqwest's default rustls verifier.
  - **pkarr relay client** (`pkarr 8.1.0`, `reqwest/rustls`) -> `rustls-platform-verifier` -> Android `PKIXRevocationChecker`. Default relays: `https://pkarr.pubky.app`, `https://pkarr.pubky.org` (`pkarr-8.1.0/src/lib.rs:27`). **Affected.**
  - **Homeserver traffic** (`pubky 0.16.2` `http` client) uses pkarr-derived raw-public-key TLS. **Not affected.** (smoke.ts comment: "Pubky's own TLS checks homeservers against their public keys. Only the public pkarr relays use the platform certificate verifier.")
  - **ICANN HTTPS** (`pubky` `icann_http`) uses webpki-roots with revocation disabled (`icann_tls_config_without_revocation_check`, `pubky-0.16.2/src/client/core.rs:428`). **Not affected.**
- The vendored Android verifier patch (`vendor/rustls-platform-verifier-android/android-revocation-soft-fail.patch`) soft-fails only `UNDETERMINED_REVOCATION_STATUS` and `UNSPECIFIED` with message starting `No CRLs found for issuer `; everything else (incl. API 36's "Certificate does not specify OCSP responder") returns `UnknownCert` -> fail closed.
- Which calls fail: any operation that needs a **network pkarr lookup or publish through the relays**. Pkarr also uses the mainline DHT (UDP), which still works, so most operations succeed. Observed by the PR author on **API 36 arm64 emulator + staging**: `offline, sign_up, public_endpoint, private_payment_list, payment_request, restart, typed_error` **passed**; `android_https` (fresh handle, `paykitAppRegistry(a.publicKey)`) **failed**. Why that particular call fails while B resolving A in `public_endpoint` succeeds is not explained in the PR (likely DHT vs relay timing/caching) - **unverified**.
- Impact on our demo: staging on Android API 36 should mostly work, but cross-device resolution (Android resolving the iOS user's homeserver for the first time) may be slower or flaky if the DHT path is slow from the emulator. Treat as a risk; test early.
- API 34/35/28: CI's local-mode smoke runs on **API 34 x86_64** but skips `android_https` (local stack has no HTTPS), so there is **no evidence** for API 34/35 on staging. The vendored README says "No CRLs found for issuer" is the message "observed on current Android releases" (so some releases soft-fail correctly). Whether **API 28** (the other image on this Mac; Android 9 still has `PKIXRevocationChecker`) avoids it is **unverified**. Cheapest check: build the example-equivalent and run our own `paykitAppRegistry(peer)` on a fresh handle on `bitkit_api28` / an API 28 AVD vs API 36. Note: this Mac only has API 28 and 36 images (`arm64-v8a`); an API 34/35 image would need `sdkmanager "system-images;android-35;google_apis;arm64-v8a"`.
- We cannot fix it in our app (relays are not configurable from `FfiPubkyClientConfig`; the verifier lives in the pinned `libpaykit.so`/jar). Upstream fix needs a TLS revocation policy decision.

---

## 7. `stateRevision` / `SharedStateBusy` and threading/deadlock rules

How ubrn runs callbacks (PR "Phase 0 findings"): sync foreign-trait callbacks invoked from tokio worker threads are marshalled onto the
**JS thread** and the Rust thread **blocks** for the return value (`invokeBlocking`). Async SDK methods return Promises and run on tokio.

Rules for our app:
1. **Every callback must be synchronous.** Never return a Promise from `loadStateBlob`, `saveStateBlobAtomically`, `loadSessionAccess`,
   or any `FfiSdkPaymentAdapter` method. Consequence for WDK: WDK on RN runs wallet ops asynchronously (worklet/IPC; see the WDK research doc),
   so **pre-compute receive addresses (per chain, per counterparty if desired) and cache them in plain JS state**; the adapter reads the cache.
   Refresh the cache, then call `syncPublicEndpoints()` / `syncContactPrivatePaymentListsAndProcessOutbound()` to republish.
2. **Never call back into the same `FfiPaykitSdk` handle from a callback** (storage lock / session-operation gate is held -> deadlock). Rust docs on all three traits say this.
3. **Never block the JS thread waiting for an SDK Promise** (no busy-waits, no sync bridges). While the JS thread is busy (heavy render, big JSON, sync crypto), every SDK call that hits a callback stalls. Keep callbacks tiny.
4. **`sdk.stateRevision()` is a sync JS->Rust call.** With callback storage it now uses `try_lock` (`paykit-ffi/src/storage.rs:173`): if another call on the same handle is inside a state transaction it throws `PaykitFfiError.SharedStateBusy` with `inner.code === 'state_transaction_in_progress'` instead of blocking (blocking caused a real deadlock: JS thread held the lock wait while the in-flight transaction waited for the JS thread to run `loadStateBlob`; fixed in 23c9144f). Treat it as retryable: catch, wait for the in-flight Promise, retry. Prefer not to poll it at all. (PR "Decision needed": maintainers may switch to a cached-revision design instead; API could change before merge.)
   `observedBackupStateRevision()` (sync) returns `undefined` for callback storage. `config()` is sync and safe.
5. **Callbacks must throw only `PaykitFfiError` instances** (e.g. `new PaykitFfiError.Storage({code, context})`, `.PaymentAdapter({...})`, `.ConcurrentUpdate({...})`). `PaykitFfiError` has no `#[uniffi(handle_unknown_callback_error)]`, so a plain `Error` thrown from JS is an "unexpected callback error", which in UniFFI typically panics the Rust side (**unverified for ubrn**). Wrap every callback body in try/catch.
6. **Serialize work per handle in JS** (a simple promise queue) for predictable UX; the SDK serializes internally anyway, and parallel calls just wait or hit `SharedStateBusy` on `stateRevision`.
7. One identity -> one atomic store. Multiple handles for the same identity must share the same store object (example's restart step does). Revisions must be globally unique and never reused (ABA protection).
8. No redaction in JS: TS records are plain objects; never `console.log`/report the ~70 sensitive record types listed in the package README (from `paykit-ffi/redacted_binding_types.txt`). Secret key types stay opaque handles; `FfiSdkStateBlob.exportBytes()` / `FfiPubkySessionAccess.exportSessionSecret()` put secrets in the JS heap.
9. Dev reload: `installRustCrate` / `initialize` are guarded by module-level booleans; a Metro full reload re-runs the module in a new JS runtime. Old `FfiPaykitSdk` handles from the previous runtime are gone; re-create handles on reload (**hot-reload behaviour with live Rust handles unverified**).
10. Delivery is **pull-based**: nothing pushes messages. Both devices must periodically run `processOutboundPrivateMessages(peer)` / `receivePrivateMessages(peer)` (or `processPendingPrivateMessages`, `receivePrivateMessagesFromLinkedPeers`) and `advanceLinkHandshake` until `Linked`. Plan a foreground poll loop (e.g. every 3-5 s) per app.

---

## 8. Recommended consumption recipe for our repo (proposal)

1. `scripts/build-paykit.sh`: env from 1.3 -> clone `pubky/paykit-rs@23c702c8...` into gitignored `.paykit-build/` -> `npm ci` -> `npm run build:ios -- --sim-only` -> `npm run build:android -- --targets arm64-v8a` -> `npm pack` -> copy to `vendor/paykit/synonymdev-react-native-paykit.tgz` (gitignored, fixed name). Optional `--full` flag for all slices/ABIs.
2. App `package.json`: `"@synonymdev/react-native-paykit": "file:vendor/paykit/synonymdev-react-native-paykit.tgz"`, RN 0.78.2 / React 19.0.0 (unless WDK forces otherwise). Copy `example-refresh.mjs`'s "drop lockfile integrity + reinstall" trick into a `scripts/refresh-paykit.mjs`.
3. Copy Podfile post_install (fmt C++17 + x86_64 exclusion), `gradle.properties` (`reactNativeArchitectures=arm64-v8a`, new arch, Hermes), root `build.gradle` ext (SDK 35/24, NDK 28.2.13676358, Kotlin 2.0.21).
4. JS layer: `PaykitService` owning one `FfiPaykitSdk` per app identity, an MMKV-encrypted `FfiSdkStateBlobStore` (or shared-state constructor), a `SessionProvider` that signs up with a staging token once then signs in, and a `WdkPaymentAdapter` reading a synchronous address cache filled from WDK.
5. Run iOS sim (Alice) and Android emulator (Bob) on staging; test the Android relay issue on API 36 first, fall back to API 28 if it is better.

---

## 9. Open questions / unverified items
- Exact generated TS (`src/generated/paykit.ts`) - reconstructed here; confirm after first build.
- Local build time and target-dir size on this Mac.
- Whether JDK 21 works for the library/app Gradle builds (CI uses 17; 17 is installed).
- Whether RN > 0.78.2 works with ubrn 0.29.3-1 output (TurboReactPackage, CMake merged-so sniffing).
- Whether Android API 28 (or 34/35) avoids the pkarr-relay OCSP failure; why only `android_https` failed on API 36.
- Behaviour when a JS callback throws a non-`PaykitFfiError`.
- Whether `signUp` with an already-registered key needs a fresh token on staging.
- The PR's open "Decision needed" may change `stateRevision()` semantics before merge (we pin the commit, so we are insulated).
