import { arrayBufferToBase64, base64ToArrayBuffer, isSafeAvatarSize, readImageSize, sniffImageType } from '../bytes';

describe('base64 helpers', () => {
  it('round-trips base64', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'hello world!']) {
      const bytes = new TextEncoder().encode(text);
      const encoded = arrayBufferToBase64(bytes.buffer);
      expect(encoded).toBe(Buffer.from(text).toString('base64'));
      expect(new TextDecoder().decode(base64ToArrayBuffer(encoded))).toBe(text);
    }
  });
});

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v]))).buffer;

describe('sniffImageType', () => {
  it('recognizes the avatar formats by their first bytes', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x89, 'PNG', 0x0d, 0x0a))).toBe('image/png');
    expect(sniffImageType(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe('image/webp');
    expect(sniffImageType(bytes('GIF89a'))).toBe('image/gif');
  });

  it('refuses anything else, whatever the file is called', () => {
    expect(sniffImageType(bytes('<svg xmlns='))).toBeUndefined();
    expect(sniffImageType(bytes())).toBeUndefined();
    expect(sniffImageType(bytes('RIFF', 0, 0, 0, 0, 'WAVE'))).toBeUndefined();
  });
});

describe('readImageSize', () => {
  const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const u16le = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u24le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
  const png = (w: number, h: number) => bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 'IHDR', ...u32be(w), ...u32be(h), 8, 6, 0, 0, 0);

  it('reads PNG, GIF, WebP and JPEG headers', () => {
    expect(readImageSize(png(400, 300), 'image/png')).toEqual({ width: 400, height: 300 });
    expect(readImageSize(bytes('GIF89a', ...u16le(64), ...u16le(32), 0, 0, 0), 'image/gif')).toEqual({ width: 64, height: 32 });
    const webpHead = ['RIFF', 0, 0, 0, 0, 'WEBP'] as const;
    expect(readImageSize(bytes(...webpHead, 'VP8X', 10, 0, 0, 0, 0, 0, 0, 0, ...u24le(399), ...u24le(299), 0, 0), 'image/webp')).toEqual({
      width: 400,
      height: 300,
    });
    expect(
      readImageSize(bytes(...webpHead, 'VP8 ', 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(400), ...u16le(300)), 'image/webp'),
    ).toEqual({ width: 400, height: 300 });
    // VP8L: 14-bit width-1 and height-1 packed after the 0x2f signature byte.
    const w = 399;
    const h = 299;
    const bits = w | (h << 14);
    expect(readImageSize(bytes(...webpHead, 'VP8L', 0, 0, 0, 0, 0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff, 0, 0, 0, 0, 0), 'image/webp')).toEqual({
      width: 400,
      height: 300,
    });
    // JPEG: SOI, an APP0 segment to skip, then SOF0 (height before width).
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x01, 0x2c, 0x01, 0x90, 3, 0, 0, 0, 0);
    expect(readImageSize(jpeg, 'image/jpeg')).toEqual({ width: 400, height: 300 });
  });

  it('gives up on truncated or odd headers', () => {
    expect(readImageSize(bytes(0x89, 'PNG'), 'image/png')).toBeUndefined();
    expect(readImageSize(bytes(0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0), 'image/jpeg')).toBeUndefined();
  });

  it('refuses avatars that declare a huge canvas (decompression bombs)', () => {
    expect(isSafeAvatarSize(readImageSize(png(400, 400), 'image/png'))).toBe(true);
    expect(isSafeAvatarSize(readImageSize(png(20000, 20000), 'image/png'))).toBe(false);
    expect(isSafeAvatarSize(readImageSize(png(2048, 4000), 'image/png'))).toBe(false);
    expect(isSafeAvatarSize(readImageSize(png(0, 10), 'image/png'))).toBe(false);
    expect(isSafeAvatarSize(undefined)).toBe(false);
  });
});
