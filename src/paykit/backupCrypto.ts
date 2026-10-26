// Encrypting the contacts-and-requests backup, and the envelope inside it.
//
// Paykit's own backup (exportBackupString / exportBackupState) is NOT
// encrypted: it is the SDK state as hex, and that state holds secrets
// (Encrypted Link keys, receipt keys, every request and receipt). So the
// app seals it before it leaves the SDK:
//
//   key       HKDF-SHA256 over the Pubky identity secret, which Paykit
//             derives from the recovery phrase (pubkySecretKeyFromBip39Mnemonic):
//             salt "paykit-wdk-wallet backup", info "backup encryption key v1".
//             So the recovery phrase alone opens the backup, and the key is
//             separate from the identity key it comes from.
//   cipher    XChaCha20-Poly1305 (@noble/ciphers) with a random 24-byte
//             nonce: authenticated, so a damaged backup or the wrong phrase
//             fails instead of restoring garbage. The text prefix is the
//             associated data.
//   text      "pkwbackup1:" + hex(nonce || ciphertext). Nothing about the
//             identity is readable without the key.
//
// Inside is a JSON envelope: the SDK backup (hex) plus the app's own
// records that Paykit does not keep (each contact's Bitcoin account index,
// the request book, the public endpoint switches), and who and when it was
// made. The identity in the envelope must match the one restoring it.
//
// Not rolled by hand: HKDF and the AEAD come from audited libraries, and
// the tests check a fixed vector, a round trip, tampering and the wrong key.
// Pure, unit tested.
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

export const BACKUP_PREFIX = 'pkwbackup1:';
const NONCE_BYTES = 24;
const KEY_SALT = 'paykit-wdk-wallet backup';
const KEY_INFO = 'backup encryption key v1';
const ENVELOPE_FORMAT = 'paykit-wdk-wallet-backup';

/** Why a backup can't be opened. Screens turn it into words. */
export class BackupOpenError extends Error {
  constructor(readonly reason: 'not-a-backup' | 'wrong-phrase' | 'other-identity' | 'unreadable') {
    super(`backup: ${reason}`);
    this.name = 'BackupOpenError';
  }
}

/** The 32-byte backup key for an identity secret (32 bytes, from the recovery phrase). */
export function backupKeyFrom(identitySecret: Uint8Array): Uint8Array {
  if (identitySecret.length !== 32) throw new Error('The identity secret must be 32 bytes');
  return hkdf(sha256, identitySecret, utf8ToBytes(KEY_SALT), utf8ToBytes(KEY_INFO), 32);
}

/**
 * JSON text with every non-ASCII character escaped (\uXXXX), so the
 * sealed bytes are ASCII and decrypting needs no UTF-8 decoder (Hermes has
 * TextEncoder, but TextDecoder is not guaranteed).
 */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function asciiBytesToString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    const chunk = bytes.subarray(i, i + 8192);
    if (chunk.some((b) => b > 0x7f)) throw new BackupOpenError('unreadable');
    out += String.fromCharCode(...chunk);
  }
  return out;
}

/** Encrypt ASCII `plaintext` (see asciiJson) into backup text. `nonce` must be 24 fresh random bytes. */
export function sealBackup(plaintext: string, key: Uint8Array, nonce: Uint8Array): string {
  if (nonce.length !== NONCE_BYTES) throw new Error('The nonce must be 24 bytes');
  if (/[^\x00-\x7f]/.test(plaintext)) throw new Error('Backup plaintext must be ASCII');
  const sealed = xchacha20poly1305(key, nonce, utf8ToBytes(BACKUP_PREFIX)).encrypt(utf8ToBytes(plaintext));
  const out = new Uint8Array(NONCE_BYTES + sealed.length);
  out.set(nonce, 0);
  out.set(sealed, NONCE_BYTES);
  return BACKUP_PREFIX + bytesToHex(out);
}

/** Does this look like backup text (pasted, maybe with spaces or line breaks)? */
export function looksLikeBackup(text: string): boolean {
  return text.trim().startsWith(BACKUP_PREFIX);
}

/** Decrypt backup text. Throws BackupOpenError. */
export function openBackup(text: string, key: Uint8Array): string {
  const trimmed = text.replace(/\s+/g, '');
  if (!trimmed.startsWith(BACKUP_PREFIX)) throw new BackupOpenError('not-a-backup');
  const hex = trimmed.slice(BACKUP_PREFIX.length);
  let bytes: Uint8Array;
  try {
    bytes = hexToBytes(hex);
  } catch {
    throw new BackupOpenError('not-a-backup');
  }
  // Poly1305 adds a 16-byte tag.
  if (bytes.length < NONCE_BYTES + 16) throw new BackupOpenError('not-a-backup');
  let plain: Uint8Array;
  try {
    plain = xchacha20poly1305(key, bytes.slice(0, NONCE_BYTES), utf8ToBytes(BACKUP_PREFIX)).decrypt(bytes.slice(NONCE_BYTES));
  } catch {
    // Authentication failed: another phrase made it, or the text is damaged.
    throw new BackupOpenError('wrong-phrase');
  }
  return asciiBytesToString(plain);
}

/** What the backup carries, decrypted. */
export type BackupEnvelope = {
  format: typeof ENVELOPE_FORMAT;
  version: 1;
  /** RFC3339. */
  createdAt: string;
  /** The identity it belongs to. */
  publicKey: string;
  /** exportBackupString: the Paykit SDK state, hex. */
  paykit: string;
  /** App store entries Paykit does not keep (key -> stored string). */
  app: Record<string, string>;
};

export function buildEnvelope(input: { createdAtMs: number; publicKey: string; paykit: string; app: Record<string, string> }): BackupEnvelope {
  return {
    format: ENVELOPE_FORMAT,
    version: 1,
    createdAt: new Date(input.createdAtMs).toISOString(),
    publicKey: input.publicKey,
    paykit: input.paykit,
    app: { ...input.app },
  };
}

/**
 * Read a decrypted envelope and check it belongs to `publicKey`. Only the
 * app keys in `allowedAppKeys` are kept, so a crafted backup can't write
 * anything else into the app store.
 */
export function readEnvelope(json: string, publicKey: string, allowedAppKeys: readonly string[]): BackupEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new BackupOpenError('unreadable');
  }
  const v = value as Partial<BackupEnvelope> | null;
  if (!v || v.format !== ENVELOPE_FORMAT || v.version !== 1 || typeof v.paykit !== 'string' || !/^[0-9a-f]+$/i.test(v.paykit)) {
    throw new BackupOpenError('unreadable');
  }
  if (v.publicKey !== publicKey) throw new BackupOpenError('other-identity');
  const app: Record<string, string> = {};
  for (const key of allowedAppKeys) {
    const entry = v.app?.[key];
    if (typeof entry === 'string') app[key] = entry;
  }
  return {
    format: ENVELOPE_FORMAT,
    version: 1,
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
    publicKey,
    paykit: v.paykit,
    app,
  };
}

/** Words for a BackupOpenError (or anything else) on a screen. */
export function backupOpenMessage(error: unknown): string | undefined {
  if (!(error instanceof BackupOpenError)) return undefined;
  switch (error.reason) {
    case 'not-a-backup':
      return "That isn't a backup from this wallet. A backup starts with “pkwbackup1:”.";
    case 'wrong-phrase':
      return 'This backup was made with another recovery phrase, or it is damaged.';
    case 'other-identity':
      return 'This backup belongs to another identity.';
    case 'unreadable':
      return "This backup opened, but this version of the app can't read it.";
  }
}
