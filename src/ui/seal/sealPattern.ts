// The seal pattern: a deterministic 4×4 grid of quarter-circle tiles derived
// from a Pubky public key, so the same person gets the same seal on every
// phone (docs/DESIGN.md, "The seal").
//
// A pubky is "pubky" + 52 z-base32 characters encoding a 32-byte Ed25519 key.
// We decode those characters back to bytes and use one byte per tile:
// bits 0-1 pick the corner the quarter circle grows from, bit 2 picks one of
// two tones. Ed25519 public keys look random, so seals vary well. Anything
// that is not a valid z-base32 key (a typo, a test string) falls back to a
// simple non-cryptographic hash of the text: the seal is a visual aid for
// recognizing people, never a security check.

/** z-base32 alphabet used by Pubky (and pkarr). */
const Z_BASE32 = 'ybndrfg8ejkmcpqxot1uwisza345h769';

export type SealCorner = 0 | 1 | 2 | 3; // top-left, top-right, bottom-right, bottom-left
export type SealTone = 'deep' | 'light';
export type SealTile = { corner: SealCorner; tone: SealTone };

export const SEAL_GRID = 4;

/** Decode z-base32 text (lowercase) into bytes. Returns undefined on any invalid character. */
export function decodeZBase32(text: string): Uint8Array | undefined {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    const value = Z_BASE32.indexOf(char);
    if (value < 0) return undefined;
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
    buffer &= (1 << bits) - 1;
  }
  return Uint8Array.from(bytes);
}

/** Strip the "pubky" or "pk:" prefix a key may carry. */
function rawKeyText(pubky: string): string {
  const trimmed = pubky.trim().toLowerCase();
  if (trimmed.startsWith('pubky')) return trimmed.slice('pubky'.length);
  if (trimmed.startsWith('pk:')) return trimmed.slice('pk:'.length);
  return trimmed;
}

/** FNV-1a over the text, stretched to `length` bytes. Only for the fallback path. */
function hashBytes(text: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let hash = 0x811c9dc5;
  for (let i = 0; i < length; i++) {
    for (const char of `${i}:${text}`) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    out[i] = hash & 0xff;
  }
  return out;
}

/** The bytes a seal is drawn from: the decoded key, or a hash of the text. */
export function sealKeyBytes(pubky: string): Uint8Array {
  const raw = rawKeyText(pubky);
  const decoded = raw.length === 52 ? decodeZBase32(raw) : undefined;
  return decoded && decoded.length >= SEAL_GRID * SEAL_GRID ? decoded : hashBytes(raw, SEAL_GRID * SEAL_GRID);
}

/** The 16 tiles of a seal, row by row. */
export function sealPattern(pubky: string): SealTile[] {
  const bytes = sealKeyBytes(pubky);
  const tiles: SealTile[] = [];
  for (let i = 0; i < SEAL_GRID * SEAL_GRID; i++) {
    const byte = bytes[i] ?? 0;
    tiles.push({
      corner: (byte & 0b11) as SealCorner,
      tone: byte & 0b100 ? 'deep' : 'light',
    });
  }
  return tiles;
}
