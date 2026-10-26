// Secrets the Paykit layer keeps in the Keychain (iOS) / Keystore (Android).
//
// - The key for the encrypted (AES-256) MMKV files: Paykit state and the
//   contact account map. MMKV needs it synchronously later, so it is read
//   once at startup, before the SDK exists.
// - The Pubky session secret (`exportSessionSecret()`), so a relaunch can
//   `importSession` instead of signing in again. Staging limits sign-ins to
//   20 per minute per IP, and both simulators share one IP.
//
// The mnemonic is NOT stored here: WDK already keeps the encrypted seed in
// the Keychain and the Pubky key is derived from it on demand.
// Items use WHEN_UNLOCKED_THIS_DEVICE_ONLY: never synced, never restored to
// another device. They do survive an app uninstall on iOS (see
// docs/ARCHITECTURE.md, "Storage and secrets"). Demo-grade: no biometric
// gate.
import * as Crypto from 'expo-crypto';
import * as Keychain from 'react-native-keychain';

const ENCRYPTION_KEY_SERVICE = 'paykit-state-encryption-key';
const SESSION_SERVICE = 'paykit-session';

const ACCESSIBLE = Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY;

/**
 * MMKV takes the key as a string and uses its bytes, up to 32 for AES-256.
 * 24 random bytes as base64 make exactly 32 printable characters: a full
 * length AES-256 key that carries 192 bits of randomness (plenty, but not
 * 256). Changing the format would orphan existing encrypted files.
 */
export async function loadOrCreateStorageKey(): Promise<string> {
  const existing = await Keychain.getGenericPassword({ service: ENCRYPTION_KEY_SERVICE });
  if (existing) return existing.password;
  const bytes = Crypto.getRandomBytes(24);
  const key = btoa(String.fromCharCode(...bytes));
  await Keychain.setGenericPassword('paykit', key, { service: ENCRYPTION_KEY_SERVICE, accessible: ACCESSIBLE });
  return key;
}

/** The saved session secret for this identity, if any. */
export async function loadSessionSecret(publicKey: string): Promise<string | undefined> {
  const saved = await Keychain.getGenericPassword({ service: SESSION_SERVICE });
  // One identity per install; ignore a secret saved for a different key.
  if (!saved || saved.username !== publicKey) return undefined;
  return saved.password;
}

export async function saveSessionSecret(publicKey: string, sessionSecret: string): Promise<void> {
  await Keychain.setGenericPassword(publicKey, sessionSecret, { service: SESSION_SERVICE, accessible: ACCESSIBLE });
}

/** Delete the saved session secret. Onboarding calls this when it replaces the wallet. */
export async function clearSessionSecret(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SESSION_SERVICE });
}
