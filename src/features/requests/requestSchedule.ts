// Which payments of a recurring request are due, for the Requests screens.
//
// Paykit leaves scheduling to the wallets (src/paykit/recurrence.ts has the
// period math). Here a period counts as handled once anything happened to
// it: a proof is recorded, or our payment of it is under way. The payer
// sees the oldest unhandled period as "due"; the payee sees the same thing
// as "waiting for their payment". Pure and unit tested, so it imports the
// pure modules directly, not the ../../paykit barrel (the native SDK).
import { nextPeriodAfter, periodKey, unpaidPeriods, type BillingPeriod, type Recurrence } from '../../paykit/recurrence';
import type { RequestFacts } from '../../paykit/requestStatus';

export type ScheduleStatus = {
  /** Started periods with no payment yet, oldest first. */
  due: BillingPeriod[];
  /** The next period that has not started. */
  next?: BillingPeriod;
};

export function scheduleStatus(recurrence: Recurrence | undefined, facts: Pick<RequestFacts, 'payments'>, nowMs: number): ScheduleStatus | undefined {
  if (!recurrence) return undefined;
  const handled = new Set(facts.payments.filter((p) => p.proofRecorded || p.outgoing !== undefined).map((p) => periodKey(p.period)));
  return { due: unpaidPeriods(recurrence, handled, nowMs), next: nextPeriodAfter(recurrence, nowMs) };
}

/** "now", "in 40 s", "in 4 min", "in 2 h", "on Nov 3". */
export function whenWords(startMs: number, nowMs: number): string {
  const seconds = Math.round((startMs - nowMs) / 1000);
  if (seconds <= 0) return 'now';
  if (seconds < 60) return `in ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  return `on ${new Date(startMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
