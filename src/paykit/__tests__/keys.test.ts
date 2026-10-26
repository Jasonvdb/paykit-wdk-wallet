import { contactLinkFor, keyFromContactLink, pubkyFromText, shortKey } from '../keys';

const BEN = 'pubky5fpe1iozempar1row5gyyn51y4i1sir7r7eu9krab1x3i5oen1gy';
const BARE = BEN.slice('pubky'.length);

describe('pubkyFromText', () => {
  it('accepts a key with or without a prefix, and contact links', () => {
    expect(pubkyFromText(BEN)).toBe(BEN);
    expect(pubkyFromText(`  ${BEN}\n`)).toBe(BEN);
    expect(pubkyFromText(BARE)).toBe(BARE);
    expect(pubkyFromText(`pk:${BARE}`)).toBe(BARE);
    expect(pubkyFromText(BEN.toUpperCase())).toBe(BEN);
    expect(pubkyFromText(contactLinkFor(BEN))).toBe(BEN);
  });

  it('refuses text that is not shaped like a pubky', () => {
    expect(pubkyFromText('')).toBeUndefined();
    expect(pubkyFromText(BEN.slice(0, -1))).toBeUndefined();
    expect(pubkyFromText(`${BEN}x`)).toBeUndefined();
    // "l" and "v" are not in the z-base32 alphabet.
    expect(pubkyFromText(`pubky${'l'.repeat(52)}`)).toBeUndefined();
    expect(pubkyFromText('tb1qx06yqnsvfwu36p0gz8ps7rfufeahnxl3m4c2v6')).toBeUndefined();
    expect(pubkyFromText(`paykitwdk://contact?pubky=${BEN}&extra=1`)).toBeUndefined();
    // Half-typed: 52 characters that start with "pubky" are not a raw key.
    expect(pubkyFromText(BEN.slice(0, 52))).toBeUndefined();
  });
});

describe('contact links', () => {
  it('round-trips a key', () => {
    expect(keyFromContactLink(contactLinkFor(BEN))).toBe(BEN);
  });

  it('shortens keys for logs', () => {
    expect(shortKey(BEN)).toBe('pubky5fpe1io…');
  });
});

describe('keyFromContactLink on hostile text', () => {
  it('never throws on broken percent-encoding', () => {
    expect(() => keyFromContactLink('paykitwdk://contact?pubky=%')).not.toThrow();
    expect(keyFromContactLink('paykitwdk://contact?pubky=%')).toBeUndefined();
    expect(pubkyFromText('paykitwdk://contact?pubky=%E0%A4%A')).toBeUndefined();
  });
});

describe('pubkyFromText on a shared pay-me message', () => {
  it('finds the one key in a message of several lines', () => {
    const message = `Ben in the test wallet. Paste this in Send to pay me, or open the link to add me:\n${contactLinkFor(BEN)}\n${BEN}`;
    expect(pubkyFromText(message)).toBe(BEN);
  });

  it('refuses a message with two different keys', () => {
    const other = `pubky${'y'.repeat(52)}`;
    expect(pubkyFromText(`${BEN}\n${other}`)).toBeUndefined();
    expect(pubkyFromText('hello\nworld')).toBeUndefined();
  });
});
