// Versions of the two SDKs, shown in You > Network details so a developer
// comparing two phones (or a bug report) knows exactly what is running.
//
// Kept by hand because the app bundle does not ship package.json; a unit
// test (src/config/__tests__/versions.test.ts) fails when these drift from
// package.json, the installed Paykit package or scripts/build-paykit.sh.

/** Paykit's React Native bindings, built from an unmerged paykit-rs PR (see README). */
export const PAYKIT_PACKAGE = {
  name: '@synonymdev/react-native-paykit',
  version: '0.1.0',
  source: 'paykit-rs PR #204',
  commit: '23c702c8',
} as const;

/** WDK packages, pinned exactly in package.json. */
export const WDK_PACKAGES = [
  { name: '@tetherto/wdk', version: '1.0.0-beta.19' },
  { name: '@tetherto/wdk-react-native-core', version: '1.0.0-beta.21' },
  { name: '@tetherto/wdk-wallet-btc', version: '1.0.0-beta.17' },
  { name: '@tetherto/wdk-wallet-evm', version: '1.0.0-beta.21' },
  { name: 'react-native-bare-kit', version: '0.14.5' },
] as const;
