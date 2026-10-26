import { arrayBufferToBase64, base64ToArrayBuffer } from '../bytes';

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
