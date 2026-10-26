// After a backup restore: what automatic payments must not trust.
//
// A backup is a snapshot. Anything this identity paid after it was made is
// missing from what comes back: the request's proof, the request book
// entry, and the payment ledger's attempt and Allowance usage. After a
// restore with RequireRecovery, the payee's events that this phone had
// already confirmed are not sent again either. So a restored request can
// look unpaid when it was paid, and a restored Allowance looks less used
// than it is. The SDK marks the ledger as needing reconciliation after
// every restore, and the Allowances spec says restored execution state
// must stay ineligible until the wallet has established that no later
// payment is missing ("Missing accounting MUST NOT be reconstructed as
// zero usage").
//
// This wallet can't rebuild the ledger's history itself (it would have to
// prove every payment made after the backup from chain history), so it
// lets the person decide, and keeps automatic payments out of it:
//
//   restored requests   every payer request that came back with the backup
//                       is never paid automatically: the person pays it by
//                       hand, after checking Activity (the request page
//                       says so)
//   paused              if the backup held Allowances we pay under, no
//                       automatic payment is made at all until the person
//                       resumes them in You > Contacts and requests backup,
//                       confirming they checked Activity. Their limits
//                       count only the payments in the backup.
//
// The record lives in the app store (RESTORE_REVIEW_KEY) and is written by
// PaykitService.connect right after the restore. It is not part of a
// backup: it describes this phone's restore.
import type { StringStore } from './addressCache';

export const RESTORE_REVIEW_KEY = 'restore-review-v1';

export type RestoreReview = {
  restoredAtMs: number;
  /** When the backup was made, if it says. */
  backupCreatedAtMs?: number;
  /** counterparty|requestId of every payer request the backup brought back. */
  requestKeys: string[];
  /** True until the person resumes automatic payments. */
  paused: boolean;
};

export function readRestoreReview(store: StringStore): RestoreReview | undefined {
  try {
    const value = JSON.parse(store.getString(RESTORE_REVIEW_KEY) ?? 'null') as Partial<RestoreReview> | null;
    if (!value || typeof value.restoredAtMs !== 'number' || !Array.isArray(value.requestKeys)) return undefined;
    return {
      restoredAtMs: value.restoredAtMs,
      backupCreatedAtMs: typeof value.backupCreatedAtMs === 'number' ? value.backupCreatedAtMs : undefined,
      requestKeys: value.requestKeys.filter((key): key is string => typeof key === 'string'),
      // Anything unreadable stays paused: the safe side.
      paused: value.paused !== false,
    };
  } catch {
    return undefined;
  }
}

const listeners = new Set<() => void>();

export function writeRestoreReview(store: StringStore, review: RestoreReview): void {
  store.set(RESTORE_REVIEW_KEY, JSON.stringify(review));
  for (const listener of listeners) listener();
}

/** For useRestoreReview: called whenever a review is written on this phone. */
export function subscribeRestoreReview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The person checked Activity and resumes automatic payments. Restored requests stay paid by hand. */
export function resumeAfterRestore(store: StringStore): void {
  const review = readRestoreReview(store);
  if (review?.paused) writeRestoreReview(store, { ...review, paused: false });
}
