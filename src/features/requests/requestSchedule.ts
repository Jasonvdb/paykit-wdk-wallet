// Which payments of a recurring request are due, for the Requests screens,
// and the request row's subtitle.
//
// Paykit leaves scheduling to the wallets (src/paykit/recurrence.ts has the
// period math). Here a period counts as handled once anything happened to
// it (isPaymentHandled): a proof is recorded, or our payment of it is under
// way. The payer sees the oldest unhandled period as "due"; the payee sees
// the same thing as "waiting for their payment". A period the payer put
// off (deferPaymentOccurrence) is still due, but not "due now". Pure and
// unit tested, so it imports the pure modules directly, not the
// ../../paykit barrel (the native SDK).
import { intervalWords, nextPeriodAfter, periodKey, unpaidPeriods, type BillingPeriod, type Recurrence } from '../../paykit/recurrence';
import { isPaymentHandled, type RequestFacts } from '../../paykit/requestStatus';

export type ScheduleStatus = {
  /** Started periods with no payment yet, oldest first (put-off ones included: they can still be paid). */
  due: BillingPeriod[];
  /** `due` without the periods the payer put off. */
  dueNow: BillingPeriod[];
  /** The next period that has not started. */
  next?: BillingPeriod;
};

export function scheduleStatus(
  recurrence: Recurrence | undefined,
  facts: Pick<RequestFacts, 'payments'>,
  nowMs: number,
  isDeferred: (period: BillingPeriod) => boolean = () => false,
): ScheduleStatus | undefined {
  if (!recurrence) return undefined;
  const handled = new Set(facts.payments.filter(isPaymentHandled).map((p) => periodKey(p.period)));
  const due = unpaidPeriods(recurrence, handled, nowMs);
  return { due, dueNow: due.filter((period) => !isDeferred(period)), next: nextPeriodAfter(recurrence, nowMs) };
}

/**
 * A request row's subtitle: the status as a sentence, the schedule as
 * another ("Every minute, one payment due now."), and the note on its own
 * line. Sentences, not a middle-dot list (docs/DESIGN.md, Writing).
 */
export function requestRowSubtitle(input: { status: string; recurrence?: Recurrence; schedule?: ScheduleStatus; payer: boolean; note?: string; nowMs: number }): string {
  const { status, recurrence, schedule, payer, note, nowMs } = input;
  const sentences = [/[.…]$/.test(status) ? status : `${status}.`];
  if (recurrence) {
    let line = intervalWords(recurrence, { sentence: true });
    if (schedule && payer) {
      if (schedule.dueNow.length > 1) line += `, ${schedule.dueNow.length} payments due`;
      else if (schedule.dueNow.length === 1) line += ', one payment due now';
      else if (schedule.due.length > 0) line += ', put off for now';
      else if (schedule.next) line += `, next one ${whenWords(Date.parse(schedule.next.startsAt), nowMs)}`;
    }
    sentences.push(`${line}.`);
  }
  const text = sentences.join(' ');
  return note ? `${text}\n“${note}”` : text;
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
