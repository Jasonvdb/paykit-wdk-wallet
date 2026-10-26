import { decodeZBase32, sealKeyBytes, sealPattern } from '../sealPattern';

// Public keys of the two demo identities' format (any valid z-base32 key works).
const KEY_A = 'pubky8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo';
const KEY_B = 'pubkyufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy';

describe('decodeZBase32', () => {
  it('decodes 52 characters into 32 bytes', () => {
    const bytes = decodeZBase32(KEY_A.slice('pubky'.length));
    expect(bytes).toBeDefined();
    expect(bytes!.length).toBe(32);
  });

  it('decodes known values', () => {
    // "y" is 0 and "9" is 31 in the z-base32 alphabet.
    expect(Array.from(decodeZBase32('yyyyyyyy')!)).toEqual([0, 0, 0, 0, 0]);
    expect(Array.from(decodeZBase32('99999999')!)).toEqual([255, 255, 255, 255, 255]);
  });

  it('rejects characters outside the alphabet', () => {
    expect(decodeZBase32('0lv2')).toBeUndefined();
  });
});

describe('sealPattern', () => {
  it('has 16 tiles', () => {
    expect(sealPattern(KEY_A)).toHaveLength(16);
  });

  it('is deterministic for the same key', () => {
    expect(sealPattern(KEY_A)).toEqual(sealPattern(KEY_A));
    // Prefix and case do not matter: the same person gets the same seal.
    expect(sealPattern(KEY_A.slice('pubky'.length))).toEqual(sealPattern(KEY_A));
    expect(sealPattern(KEY_A.toUpperCase())).toEqual(sealPattern(KEY_A));
  });

  it('differs between keys', () => {
    expect(sealPattern(KEY_A)).not.toEqual(sealPattern(KEY_B));
  });

  it('uses the decoded key bytes for valid keys', () => {
    const bytes = sealKeyBytes(KEY_A);
    expect(bytes).toEqual(decodeZBase32(KEY_A.slice('pubky'.length)));
    const tiles = sealPattern(KEY_A);
    tiles.forEach((tile, i) => {
      expect(tile.corner).toBe((bytes[i] ?? 0) & 0b11);
      expect(tile.tone).toBe((bytes[i] ?? 0) & 0b100 ? 'deep' : 'light');
    });
  });

  it('falls back to a stable hash for text that is not a key', () => {
    expect(sealPattern('not a key')).toEqual(sealPattern('not a key'));
    expect(sealPattern('not a key')).not.toEqual(sealPattern('another text'));
  });
});
