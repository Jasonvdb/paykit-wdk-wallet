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
