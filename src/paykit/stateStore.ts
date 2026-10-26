// Paykit SDK state, stored in encrypted MMKV.
//
// The SDK calls `loadStateBlob` and `saveStateBlobAtomically` synchronously
// on the JS thread while a Rust worker waits for the answer. That rules out
// AsyncStorage and any `await` here. MMKV reads and writes are synchronous.
//
// The blob holds Paykit secrets (Noise keys, link state, receipt keys), so the
// MMKV file is encrypted with a random AES-256 key from the Keychain/Keystore
// (src/paykit/secureStorage.ts), loaded before the SDK is built.
//
// Contract (paykit-ffi/src/storage.rs):
// - a save whose expected revision differs from the stored one throws
//   PaykitFfiError.ConcurrentUpdate and writes nothing (this includes "no
//   revision expected, but a blob exists");
// - each successful save returns a new, non-empty revision that was never
//   used before.
//
// Blob and revision are written as ONE value (`encodeSdkStateBlobSnapshot`),
// so a crash can never leave a new blob with an old revision.
import { createMMKV, type MMKV } from 'react-native-mmkv';
import * as Crypto from 'expo-crypto';
import {
  PaykitFfiError,
  decodeSdkStateBlobSnapshot,
  encodeSdkStateBlobSnapshot,
  type FfiSdkStateBlobInterface,
  type FfiSdkStateBlobSnapshot,
  type FfiSdkStateBlobStore,
} from '@synonymdev/react-native-paykit';

import { asCallbackError } from './errors';

const SNAPSHOT_KEY = 'snapshot-v1';

/** Short, filesystem-safe id for per-identity files. A pubky is public, so it may appear in a file name. */
export function identityFileId(publicKey: string): string {
  return publicKey.replace(/^pubky/, '').slice(0, 16);
}

/** Open the state store for one Pubky identity. Call before building the SDK. */
export function openStateStore(publicKey: string, encryptionKey: string): MmkvStateBlobStore {
  // One MMKV file per identity, so a different mnemonic never loads another
  // identity's state.
  const storage = createMMKV({
    id: `paykit-state-${identityFileId(publicKey)}`,
    encryptionKey,
    encryptionType: 'AES-256',
  });
  return new MmkvStateBlobStore(storage);
}

export class MmkvStateBlobStore implements FfiSdkStateBlobStore {
  // Revisions are `<random per-launch id>-<counter>`. They are identifiers,
  // not secrets; the random prefix keeps them unique across app launches, so
  // a revision is never reused (the SDK relies on that to detect ABA writes).
  private readonly launchId = Crypto.randomUUID();
  private counter = 0;

  constructor(private readonly storage: MMKV) {}

  private storedSnapshot(): FfiSdkStateBlobSnapshot | undefined {
    const bytes = this.storage.getBuffer(SNAPSHOT_KEY);
    return bytes === undefined ? undefined : decodeSdkStateBlobSnapshot(bytes.slice(0));
  }

  loadStateBlob(): FfiSdkStateBlobSnapshot | undefined {
    try {
      return this.storedSnapshot();
    } catch (error) {
      throw asCallbackError(error, 'state_store_read_failed', 'mmkv');
    }
  }

  saveStateBlobAtomically(blob: FfiSdkStateBlobInterface, expectedRevision: string | undefined): string {
    try {
      const stored = this.storedSnapshot();
      if (stored?.revision !== expectedRevision) {
        throw new PaykitFfiError.ConcurrentUpdate({
          code: 'state_revision_mismatch',
          context: 'stored SDK state revision changed',
        });
      }
      const revision = `${this.launchId}-${++this.counter}`;
      this.storage.set(SNAPSHOT_KEY, encodeSdkStateBlobSnapshot({ blob, revision }).slice(0));
      return revision;
    } catch (error) {
      // Callbacks must throw PaykitFfiError only; anything else is an
      // unexpected callback error on the Rust side.
      throw asCallbackError(error, 'state_store_write_failed', 'mmkv');
    }
  }
}

/**
 * Encrypted app-side store for small Paykit-related data that is not SDK
 * state: the contact -> BTC account map (src/paykit/addressCache.ts) and
 * what later phases need (consumed private list versions, receipt drafts).
 */
export function openPaykitAppStore(publicKey: string, encryptionKey: string): MMKV {
  return createMMKV({
    id: `paykit-app-${identityFileId(publicKey)}`,
    encryptionKey,
    encryptionType: 'AES-256',
  });
}
