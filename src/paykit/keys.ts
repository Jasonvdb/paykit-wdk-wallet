// Pubky key text helpers with no native imports.
//
// Paykit returns keys as "pubky" + 52 z-base32 characters. Logs show only a
// short prefix; the full key is public, but short forms keep logs readable.
// Normalizing user input (QR, paste, deep link) uses the SDK's
// `normalizePubkyPublicKey`, see PaykitService.normalizeKey.

/** "pubky8pin…" for logs: the first 12 characters, like Bitkit's log redaction. */
export function shortKey(pubky: string): string {
  return pubky.length > 12 ? `${pubky.slice(0, 12)}…` : pubky;
}

/** Strip prefixes people paste: "pk:" (Pubky Ring) and surrounding whitespace. */
export function cleanKeyInput(text: string): string {
  const trimmed = text.trim();
  return trimmed.toLowerCase().startsWith('pk:') ? trimmed.slice(3) : trimmed;
}

/** Parse a paykitwdk://contact?pubky=<key> link or bare key text into key text (not yet normalized). */
export function keyFromContactLink(text: string): string | undefined {
  const trimmed = text.trim();
  const match = /^paykitwdk:\/\/contact\?pubky=([^&#\s]+)$/i.exec(trimmed);
  if (match) return decodeURIComponent(match[1] ?? '');
  return trimmed || undefined;
}

/** The deep link other people open to add this key as a contact. */
export function contactLinkFor(pubky: string): string {
  return `paykitwdk://contact?pubky=${encodeURIComponent(pubky)}`;
}

/** 52 z-base32 characters: a raw Pubky key. */
const RAW_KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/;

/**
 * The key in pasted, scanned or linked text, if it has the shape of a
 * pubky: a bare key (with the "pubky" or "pk:" prefix, or none) or a
 * paykitwdk://contact?pubky=<key> link. Undefined otherwise.
 *
 * A shape check only, cheap enough to run on every keystroke. Before the
 * key is used, PaykitService.normalizeKey (the SDK's
 * normalizePubkyPublicKey) validates it for real.
 */
export function pubkyFromText(text: string): string | undefined {
  const key = cleanKeyInput(keyFromContactLink(text) ?? '').toLowerCase();
  // Text starting with "pubky" must be the prefixed form. Otherwise a
  // half-typed "pubky…" key that happens to be 52 characters long would
  // pass as a raw key (z-base32 has the letters p, u, b, k and y).
  if (key.startsWith('pubky')) return RAW_KEY.test(key.slice(5)) ? key : undefined;
  return RAW_KEY.test(key) ? key : undefined;
}
