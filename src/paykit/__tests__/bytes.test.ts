import { arrayBufferToBase64, base64ToArrayBuffer, sniffImageType } from '../bytes';

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

describe('sniffImageType', () => {
  const bytes = (...values: (number | string)[]) =>
    new Uint8Array(values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v]))).buffer;

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
