// Small, non-secret app settings in a plain (unencrypted) MMKV file.
//
// Only flags and preferences belong here. Secrets live in the Keychain
// (src/paykit/secureStorage.ts) or WDK's own encrypted storage; Paykit state
// lives in its encrypted MMKV file (src/paykit/stateStore.ts).
import { createMMKV, useMMKVBoolean } from 'react-native-mmkv';

export const appStorage = createMMKV({ id: 'app-settings' });

const ONBOARDING_COMPLETE = 'onboarding-complete-v1';

/**
 * Set once the user finishes onboarding (wallet + Paykit identity ready).
 * The navigator shows the tabs only after this, and Paykit connects
 * automatically on later launches.
 */
export function useOnboardingComplete(): [boolean, (complete: boolean) => void] {
  const [value, setValue] = useMMKVBoolean(ONBOARDING_COMPLETE, appStorage);
  return [value ?? false, (complete: boolean) => setValue(complete)];
}

export function isOnboardingComplete(): boolean {
  return appStorage.getBoolean(ONBOARDING_COMPLETE) ?? false;
}

const WALLET_ORIGIN = 'wallet-origin-v1';

/**
 * How the wallet on this device came to be. Onboarding uses it to decide
 * between signing in and signing up: only a wallet created here is known to
 * have a brand-new identity that needs an invite code. Unknown (e.g. an iOS
 * reinstall, where the Keychain kept the seed but this file is gone) is
 * treated as restored.
 */
export type WalletOrigin = 'created' | 'restored';

export function walletOrigin(): WalletOrigin | undefined {
  const value = appStorage.getString(WALLET_ORIGIN);
  return value === 'created' || value === 'restored' ? value : undefined;
}

export function setWalletOrigin(origin: WalletOrigin): void {
  appStorage.set(WALLET_ORIGIN, origin);
}
