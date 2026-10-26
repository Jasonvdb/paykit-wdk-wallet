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

export type ImageSize = { width: number; height: number };

/**
 * The pixel size an image declares in its header, or undefined if the
 * header cannot be read. A file can be tiny and still declare a huge canvas
 * (a "decompression bomb": a 20000×20000 PNG decodes to 1.6 GB of pixels),
 * so avatars are checked by declared size before anything decodes them.
 *
 *   PNG   IHDR, right after the signature
 *   GIF   the logical screen descriptor
 *   WebP  VP8 (lossy), VP8L (lossless) or VP8X (extended) header
 *   JPEG  the first SOFn segment
 */
export function readImageSize(buffer: ArrayBuffer, type: AvatarImageType): ImageSize | undefined {
  const b = new Uint8Array(buffer);
  const u16be = (i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
  const u16le = (i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
  const u24le = (i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
  const u32be = (i: number) => (((b[i] ?? 0) << 24) >>> 0) + (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0));
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));

  switch (type) {
    case 'image/png':
      if (b.length < 24 || ascii(12, 16) !== 'IHDR') return undefined;
      return { width: u32be(16), height: u32be(20) };
    case 'image/gif':
      if (b.length < 10) return undefined;
      return { width: u16le(6), height: u16le(8) };
    case 'image/webp': {
      if (b.length < 30) return undefined; // the longest of the three headers below
      const chunk = ascii(12, 16);
      if (chunk === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = b.slice(21, 25);
        return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
      }
      if (chunk === 'VP8X') return { width: 1 + u24le(24), height: 1 + u24le(27) };
      return undefined;
    }
    case 'image/jpeg': {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return undefined;
        const marker = b[i + 1] ?? 0;
        if (marker === 0xff) {
          i += 1; // fill byte
          continue;
        }
        // Markers without a length: TEM, RST0-7, SOI, EOI.
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
          i += 2;
          continue;
        }
        const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isStartOfFrame) return { width: u16be(i + 7), height: u16be(i + 5) };
        i += 2 + u16be(i + 2);
      }
      return undefined;
    }
  }
}

/** Largest avatar we decode: our own are 400 px; this leaves room for other apps' without letting a header claim gigabytes. */
export const MAX_AVATAR_SIDE = 2048;
export const MAX_AVATAR_PIXELS = 2048 * 2048;

/** Whether an avatar's declared size is small enough to decode safely. Unreadable sizes are refused. */
export function isSafeAvatarSize(size: ImageSize | undefined): boolean {
  if (!size || size.width <= 0 || size.height <= 0) return false;
  return size.width <= MAX_AVATAR_SIDE && size.height <= MAX_AVATAR_SIDE && size.width * size.height <= MAX_AVATAR_PIXELS;
}
