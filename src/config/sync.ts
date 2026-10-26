// Timing for background work. Kept in one place so the demo can be tuned.
//
// Paykit has no push: messages only move while both apps poll. Two
// foregrounded simulators with a 3 s loop keep a demo responsive without
// hammering the staging homeserver.

/** Paykit foreground sync loop interval while the app is active. */
export const PAYKIT_SYNC_INTERVAL_MS = 3_000;

/** Upper bound for a single Paykit SDK call before the queue gives up on it. */
export const PAYKIT_CALL_TIMEOUT_MS = 60_000;

/** `maxAdvanceSteps` for each ensureLinkWithPeer call in the loop. */
export const PAYKIT_LINK_ADVANCE_STEPS = 3;

/** After a failed link attempt, wait this long (doubling up to the max) before retrying that peer. */
export const PAYKIT_LINK_RETRY_MIN_MS = 5_000;
export const PAYKIT_LINK_RETRY_MAX_MS = 60_000;

/** Wallet balance polling interval. */
export const BALANCE_POLL_MS = 15_000;
