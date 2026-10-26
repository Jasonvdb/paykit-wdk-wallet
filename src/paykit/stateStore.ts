// Paykit SDK state, stored in encrypted MMKV.
//
// The SDK calls `loadStateBlob` and `saveStateBlobAtomically` synchronously
// on the JS thread while a Rust worker waits for the answer. That rules out
// AsyncStorage and any `await` here. MMKV reads and writes are synchronous.
//
// The blob holds Paykit secrets (Noise keys, link state), so the MMKV file is
// encrypted with a random AES-256 key kept in the Keychain/Keystore. Keychain
// access is async, so `openStateStore` loads the key before the SDK exists.
//
// Contract (paykit-ffi/src/storage.rs):
// - a save whose expected revision differs from the stored one throws
//   PaykitFfiError.ConcurrentUpdate and writes nothing;
// - each successful save returns a new revision that was never used before.
import * as Crypto from 'expo-crypto';
import * as Keychain from 'react-native-keychain';
import { createMMKV, type MMKV } from 'react-native-mmkv';
import {
  FfiSdkStateBlob,
  PaykitFfiError,
  type FfiSdkStateBlobInterface,
  type FfiSdkStateBlobSnapshot,
  type FfiSdkStateBlobStore,
} from '@synonymdev/react-native-paykit';

const KEYCHAIN_SERVICE = 'paykit-state-encryption-key';
const BLOB_KEY = 'blob';
const REVISION_KEY = 'revision';

/** 24 random bytes as base64 = 32 characters, the AES-256 key length MMKV takes. */
async function loadOrCreateEncryptionKey(): Promise<string> {
  const existing = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
  if (existing) return existing.password;
  const bytes = Crypto.getRandomBytes(24);
  const key = btoa(String.fromCharCode(...bytes));
  await Keychain.setGenericPassword('paykit', key, {
    service: KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

/** Open the state store for one Pubky identity. Call before building the SDK. */
export async function openStateStore(publicKey: string): Promise<MmkvStateBlobStore> {
  const encryptionKey = await loadOrCreateEncryptionKey();
  // One MMKV instance per identity, so a different mnemonic never loads
  // another identity's state. The pubky is public; it is fine in a file name.
  const storage = createMMKV({
    id: `paykit-state-${publicKey.replace(/^pubky/, '').slice(0, 16)}`,
    encryptionKey,
    encryptionType: 'AES-256',
  });
  return new MmkvStateBlobStore(storage);
}

export class MmkvStateBlobStore implements FfiSdkStateBlobStore {
  // Revisions are `<random store session>-<counter>`. They are identifiers,
  // not secrets; the random prefix keeps them unique across app launches.
  private readonly session = Crypto.randomUUID();
  private counter = 0;

  constructor(private readonly storage: MMKV) {}

  loadStateBlob(): FfiSdkStateBlobSnapshot | undefined {
    const revision = this.storage.getString(REVISION_KEY);
    const bytes = this.storage.getBuffer(BLOB_KEY);
    if (revision === undefined || bytes === undefined) return undefined;
    return { blob: new FfiSdkStateBlob(bytes.slice(0)), revision };
  }

  saveStateBlobAtomically(
    blob: FfiSdkStateBlobInterface,
    expectedRevision: string | undefined,
  ): string {
    try {
      if (this.storage.getString(REVISION_KEY) !== expectedRevision) {
        throw new PaykitFfiError.ConcurrentUpdate({
          code: 'state_revision_mismatch',
          context: 'stored SDK state revision changed',
        });
      }
      const revision = `${this.session}-${++this.counter}`;
      this.storage.set(BLOB_KEY, blob.exportBytes().slice(0));
      this.storage.set(REVISION_KEY, revision);
      return revision;
    } catch (error) {
      // Callbacks must throw PaykitFfiError only; anything else is an
      // unexpected callback error on the Rust side.
      if (PaykitFfiError.instanceOf(error)) throw error;
      throw new PaykitFfiError.Storage({ code: 'state_store_write_failed', context: 'mmkv' });
    }
  }

  /** Forget this identity's state (spike "reset" button). */
  clear(): void {
    this.storage.clearAll();
  }
}
