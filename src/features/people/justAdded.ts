// "You just added this person": lets the Person page play the seal's
// closing animation when the link was already completed by the Add call.
//
// The second person to add the other usually finishes the handshake inside
// saveContactAndLink, so their Person page opens on a ring that is already
// Linked and would never see the linking -> linked change. Add person marks
// the key here; the Person page takes the mark once and starts its seal
// from the dashed ring. Memory only, and a mark expires after a minute.
const MARK_TTL_MS = 60_000;
const marks = new Map<string, number>();

export function markJustAdded(publicKey: string): void {
  marks.set(publicKey, Date.now());
}

/** True once, if `publicKey` was added within the last minute. */
export function takeJustAdded(publicKey: string): boolean {
  const at = marks.get(publicKey);
  marks.delete(publicKey);
  return at !== undefined && Date.now() - at < MARK_TTL_MS;
}
