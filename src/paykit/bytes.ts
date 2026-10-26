// Base64 <-> ArrayBuffer without Buffer (Hermes has no Buffer global).
//
// Paykit moves files as ArrayBuffer (avatars, pubky:// blobs) while React
// Native images and expo-image-manipulator speak base64. Pure, unit tested.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(triple >> 18) & 63];
    out += ALPHABET[(triple >> 12) & 63];
    out += b === undefined ? '=' : ALPHABET[(triple >> 6) & 63];
    out += c === undefined ? '=' : ALPHABET[triple & 63];
  }
  return out;
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let byteIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const values = [0, 1, 2, 3].map((k) => ALPHABET.indexOf(clean[i + k] ?? 'A'));
    const triple = ((values[0] ?? 0) << 18) | ((values[1] ?? 0) << 12) | ((values[2] ?? 0) << 6) | (values[3] ?? 0);
    const remaining = clean.length - i;
    if (byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 16) & 0xff;
    if (remaining > 2 && byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 8) & 0xff;
    if (remaining > 3 && byteIndex < bytes.length) bytes[byteIndex++] = triple & 0xff;
  }
  return bytes.buffer.slice(0, byteIndex);
}

/** Image types we show as avatars. */
export type AvatarImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

/**
 * The image type from the file's first bytes ("magic numbers"), or
 * undefined if it is none of the types we show. Avatars come from other
 * people's homeservers, so the app trusts the bytes, not the file name.
 */
export function sniffImageType(buffer: ArrayBuffer): AvatarImageType | undefined {
  const b = new Uint8Array(buffer.slice(0, 12));
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  return undefined;
}
