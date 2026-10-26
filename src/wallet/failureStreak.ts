// When a polled read has failed long enough to tell the person.
//
// Balances and history are polled every 15 s from public testnet servers
// that drop a request now and then. One failed poll says nothing: the
// screen keeps what it showed last (stale data is fine for a few seconds)
// and the next poll usually works. Only a run of failures is worth a line
// on screen, and sooner when there is nothing to show at all.
//
// Pure, so the rule is unit tested (src/wallet/__tests__/failureStreak.test.ts).

/** Consecutive failed polls, reset by any success. */
export type FailureStreak = { failures: number };

export const NO_FAILURES: FailureStreak = { failures: 0 };

/** Failed polls before an error shows when the screen still has older data (about a minute at 15 s). */
export const FAILURES_BEFORE_REPORT_WITH_DATA = 4;

/** Failed polls before an error shows when there is nothing to show yet. */
export const FAILURES_BEFORE_REPORT_WITHOUT_DATA = 2;

export function nextFailureStreak(streak: FailureStreak, succeeded: boolean): FailureStreak {
  return succeeded ? NO_FAILURES : { failures: streak.failures + 1 };
}

/** Whether the screen should say the read is failing. */
export function shouldReportFailure(streak: FailureStreak, hasData: boolean): boolean {
  return streak.failures >= (hasData ? FAILURES_BEFORE_REPORT_WITH_DATA : FAILURES_BEFORE_REPORT_WITHOUT_DATA);
}
