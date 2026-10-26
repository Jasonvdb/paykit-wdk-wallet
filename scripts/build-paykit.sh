#!/usr/bin/env bash
# Build the Paykit React Native package from the unmerged paykit-rs PR #204
# and pack it into vendor/synonymdev-react-native-paykit.tgz, which the app
# installs as a normal npm dependency.
#
# The package is not on npm yet, so we build it from a pinned upstream commit.
# This needs Rust (stable, with the iOS and Android targets), cargo-ndk, the
# Android NDK and Xcode. A cold build takes a while: the Rust SDK is compiled
# once per target.
#
# Usage:
#   scripts/build-paykit.sh            # iOS (device + Apple-silicon sim) + Android arm64-v8a
#   ANDROID_ABIS="arm64-v8a x86_64" scripts/build-paykit.sh
set -euo pipefail

# PR #204 head: "Add generated React Native bindings with CI and example app".
PAYKIT_REPO="https://github.com/pubky/paykit-rs.git"
PAYKIT_COMMIT="23c702c8f75c7bc211b2deaaaafbcac6f33f15d1"
ANDROID_ABIS="${ANDROID_ABIS:-arm64-v8a}"

# cargo-ndk needs a complete NDK (one with source.properties). If none is set,
# take the newest complete one under the Android SDK.
if [ -z "${ANDROID_NDK_HOME:-}" ]; then
  sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
  for ndk in $(ls -d "$sdk"/ndk/*/ 2>/dev/null | sort -rV); do
    if [ -f "$ndk/source.properties" ]; then
      export ANDROID_NDK_HOME="${ndk%/}"
      break
    fi
  done
fi
echo "==> Using NDK: ${ANDROID_NDK_HOME:?no complete Android NDK found; set ANDROID_NDK_HOME}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT/.paykit-build"
SRC="$BUILD_DIR/paykit-rs"
PKG="$SRC/paykit-react-native"
OUT="$ROOT/vendor/synonymdev-react-native-paykit.tgz"

echo "==> Fetching paykit-rs @ ${PAYKIT_COMMIT:0:8}"
if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$BUILD_DIR"
  git clone --filter=blob:none "$PAYKIT_REPO" "$SRC"
fi
git -C "$SRC" fetch --quiet origin "$PAYKIT_COMMIT" 2>/dev/null ||
  git -C "$SRC" fetch --quiet origin pull/204/head
git -C "$SRC" checkout --quiet --force "$PAYKIT_COMMIT"

cd "$PKG"
echo "==> Installing package build tools (ubrn, bob)"
npm ci --no-audit --no-fund

echo "==> Building iOS xcframework + bindings"
npm run build:ios

target_flags=()
for abi in $ANDROID_ABIS; do target_flags+=(--targets "$abi"); done
echo "==> Building Android libraries for: $ANDROID_ABIS"
npm run build:android -- "${target_flags[@]}"

echo "==> Packing"
tarball="$(npm pack --silent | tail -n 1)"
mkdir -p "$ROOT/vendor"
mv "$PKG/$tarball" "$OUT"
echo "==> Wrote $OUT ($(du -h "$OUT" | cut -f1))"
