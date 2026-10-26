// Did our acceptance of a request leave before the request expired?
//
// The payee's SDK judges an acceptance by when it *fetches* it: one that
// arrives after the proposal's expiry makes the request invalid on its
// side, and a proof for it is then ignored, so the money is sent but never
// checked or receipted. The Pay button refuses in that case
// (./requests.ts, waitForOurAcceptance). The automatic payment hook needs
// the same rule, but it only sees the acceptance's status each round, and
// the SDK records no time for when it was sent. So the hook watches every
// round and remembers what it saw (the final answers are kept in the app
// store, so a restart after the expiry doesn't turn "in time" into "too
// late" for a recurring request):
//
//   in-time    seen sent before the expiry (or the request never expires):
//              it may be paid
//   too-late   still unsent at the expiry, or first seen sent only after
//              it: never paid automatically (the person can ask again)
//   waiting    not sent yet, and the request hasn't expired
//
// Conservative on purpose: an acceptance that left in time while the app
// was closed, and is first seen after the expiry, also counts as too late.
// Pure, unit tested (./__tests__/acceptanceTiming.test.ts).

export type AcceptanceTiming = 'in-time' | 'too-late' | 'waiting';

/**
 * The next observation. `sent` is whether our acceptance has left the
 * outbound queue; `previous` is what an earlier round saw (in-time and
 * too-late never change).
 */
export function nextAcceptanceTiming(previous: AcceptanceTiming | undefined, sent: boolean, expiresAtMs: number | undefined, nowMs: number): AcceptanceTiming {
  if (previous === 'in-time' || previous === 'too-late') return previous;
  const expired = expiresAtMs !== undefined && nowMs >= expiresAtMs;
  if (sent) return expired ? 'too-late' : 'in-time';
  return expired ? 'too-late' : 'waiting';
}
