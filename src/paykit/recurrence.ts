// Schedule math for recurring payment requests.
//
// Paykit only carries the schedule (`every`, `unit`, `starts_at`, `anchor`,
// `ends_at`) and says nothing about which billing periods are due: "Paykit
// does not run the scheduler" (specs/payment-requests.md, Recurrence). So
// both wallets compute the same periods from the immutable terms:
//
//   period k = [anchor + k·every·unit, anchor + (k+1)·every·unit)
//
// keeping the periods that start at or after `starts_at` and end at or
// before `ends_at`. The payer pays one proof per period that has started;
// the payee checks a proof's period is one of these. Months and years clamp
// to the last day of a short month and return to the anchor day after
// (the spec's recommendation). This app proposes minute schedules with a
// payment count, so `ends_at = starts_at + count·every·unit`.
//
// Timestamps are RFC 3339 UTC with a `Z` and whole seconds, the form the
// spec requires. Pure: no native imports, unit tested.

export type RecurrenceUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

export type Recurrence = {
  every: number;
  unit: string;
  startsAt: string;
  anchor: string;
  endsAt?: string;
};

export type BillingPeriod = { startsAt: string; endsAt: string };

/**
 * At most this many periods are listed. Lists only: whether a period is on
 * the schedule, and which ones have started, is worked out from its index
 * (periodIndexAtOrBefore), so period 500 of an endless schedule is as
 * payable and checkable as period 1.
 */
export const MAX_LISTED_PERIODS = 120;

const FIXED_MS: Partial<Record<RecurrenceUnit, number>> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
};

export function isRecurrenceUnit(unit: string): unit is RecurrenceUnit {
  return unit === 'minute' || unit === 'hour' || unit === 'day' || unit === 'week' || unit === 'month' || unit === 'year';
}

/** RFC 3339 UTC with whole seconds: 2026-10-26T12:00:00Z. */
export function toRfc3339(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

export function parseTime(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? undefined : ms;
}

/** anchor + n units, with month/year clamping to the anchor's day. */
function addUnits(anchorMs: number, unit: RecurrenceUnit, n: number): number {
  const fixed = FIXED_MS[unit];
  if (fixed !== undefined) return anchorMs + n * fixed;
  const anchor = new Date(anchorMs);
  const months = unit === 'year' ? n * 12 : n;
  const monthIndex = anchor.getUTCMonth() + months;
  const year = anchor.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(anchor.getUTCDate(), lastDay);
  return Date.UTC(year, month, day, anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds());
}

type Schedule = { every: number; unit: RecurrenceUnit; startsMs: number; anchorMs: number; endsMs?: number };

function scheduleOf(recurrence: Recurrence): Schedule | undefined {
  const startsMs = parseTime(recurrence.startsAt);
  const anchorMs = parseTime(recurrence.anchor);
  const endsMs = parseTime(recurrence.endsAt);
  if (!isRecurrenceUnit(recurrence.unit) || !Number.isInteger(recurrence.every) || recurrence.every < 1) return undefined;
  if (startsMs === undefined || anchorMs === undefined) return undefined;
  if (recurrence.endsAt && (endsMs === undefined || endsMs <= startsMs)) return undefined;
  return { every: recurrence.every, unit: recurrence.unit, startsMs, anchorMs, endsMs };
}

/** The first k whose period starts at or after starts_at. */
function firstIndex(schedule: Schedule): number {
  let k = 0;
  // Anchors before starts_at are allowed; step forward (bounded) to the first period that counts.
  if (schedule.anchorMs < schedule.startsMs) {
    const fixed = FIXED_MS[schedule.unit];
    if (fixed !== undefined) k = Math.ceil((schedule.startsMs - schedule.anchorMs) / (fixed * schedule.every));
    while (addUnits(schedule.anchorMs, schedule.unit, k * schedule.every) < schedule.startsMs) k += 1;
  }
  return k;
}

function periodAt(schedule: Schedule, k: number): { startMs: number; endMs: number } {
  return {
    startMs: addUnits(schedule.anchorMs, schedule.unit, k * schedule.every),
    endMs: addUnits(schedule.anchorMs, schedule.unit, (k + 1) * schedule.every),
  };
}

/**
 * The largest k whose period starts at or before `ms` (it may be below
 * firstIndex, or negative). Fixed units divide; months and years step from
 * an estimate, since they clamp to short months.
 */
function periodIndexAtOrBefore(schedule: Schedule, ms: number): number {
  const fixed = FIXED_MS[schedule.unit];
  if (fixed !== undefined) return Math.floor((ms - schedule.anchorMs) / (fixed * schedule.every));
  const anchor = new Date(schedule.anchorMs);
  const at = new Date(ms);
  const months = (at.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (at.getUTCMonth() - anchor.getUTCMonth());
  const monthsPerPeriod = (schedule.unit === 'year' ? 12 : 1) * schedule.every;
  let k = Math.floor(months / monthsPerPeriod) + 1;
  while (periodAt(schedule, k).startMs > ms) k -= 1;
  return k;
}

/** The last k whose period ends by ends_at, or undefined for an endless schedule. */
function lastIndex(schedule: Schedule): number | undefined {
  if (schedule.endsMs === undefined) return undefined;
  let k = periodIndexAtOrBefore(schedule, schedule.endsMs);
  while (periodAt(schedule, k).endMs > schedule.endsMs) k -= 1;
  return k;
}

function toPeriod(period: { startMs: number; endMs: number }): BillingPeriod {
  return { startsAt: toRfc3339(period.startMs), endsAt: toRfc3339(period.endMs) };
}

/**
 * The schedule's periods in order, up to `limit`. A schedule with no end
 * is cut at `limit`; one with an end stops at the last whole period.
 */
export function schedulePeriods(recurrence: Recurrence, limit = MAX_LISTED_PERIODS): BillingPeriod[] {
  const schedule = scheduleOf(recurrence);
  if (!schedule) return [];
  const periods: BillingPeriod[] = [];
  for (let k = firstIndex(schedule); periods.length < limit; k++) {
    const period = periodAt(schedule, k);
    if (schedule.endsMs !== undefined && period.endMs > schedule.endsMs) break;
    periods.push(toPeriod(period));
  }
  return periods;
}

/** How many payments the schedule has in total, or undefined when it has no end. */
export function paymentCount(recurrence: Recurrence): number | undefined {
  const schedule = scheduleOf(recurrence);
  if (!recurrence.endsAt || !schedule) return undefined;
  return Math.max(0, (lastIndex(schedule) ?? 0) - firstIndex(schedule) + 1);
}

/**
 * Periods that have started by `nowMs`, oldest first: the newest
 * MAX_LISTED_PERIODS of them, for an old, long schedule.
 */
export function startedPeriods(recurrence: Recurrence, nowMs: number): BillingPeriod[] {
  const schedule = scheduleOf(recurrence);
  if (!schedule) return [];
  const first = firstIndex(schedule);
  const last = Math.min(periodIndexAtOrBefore(schedule, nowMs), lastIndex(schedule) ?? Infinity);
  const periods: BillingPeriod[] = [];
  for (let k = Math.max(first, last - MAX_LISTED_PERIODS + 1); k <= last; k++) periods.push(toPeriod(periodAt(schedule, k)));
  return periods;
}

/** The next period that has not started yet, if the schedule has one. */
export function nextPeriodAfter(recurrence: Recurrence, nowMs: number): BillingPeriod | undefined {
  const schedule = scheduleOf(recurrence);
  if (!schedule) return undefined;
  const k = Math.max(firstIndex(schedule), periodIndexAtOrBefore(schedule, nowMs) + 1);
  const end = lastIndex(schedule);
  return end === undefined || k <= end ? toPeriod(periodAt(schedule, k)) : undefined;
}

/** Started periods without a payment, oldest first. `paid` holds period start times (see periodKey). */
export function unpaidPeriods(recurrence: Recurrence, paid: ReadonlySet<string>, nowMs: number): BillingPeriod[] {
  return startedPeriods(recurrence, nowMs).filter((period) => !paid.has(periodKey(period)));
}

/**
 * True when `period` is exactly one of the schedule's periods (compared as
 * instants), however far into the schedule it is.
 */
export function isScheduledPeriod(recurrence: Recurrence, period: BillingPeriod): boolean {
  const schedule = scheduleOf(recurrence);
  const start = parseTime(period.startsAt);
  const end = parseTime(period.endsAt);
  if (!schedule || start === undefined || end === undefined) return false;
  const k = periodIndexAtOrBefore(schedule, start);
  const expected = periodAt(schedule, k);
  const last = lastIndex(schedule);
  return k >= firstIndex(schedule) && (last === undefined || k <= last) && expected.startMs === start && expected.endMs === end;
}

/** A stable key for a period (its start instant), or '' for a one-time request. */
export function periodKey(period: BillingPeriod | undefined): string {
  if (!period) return '';
  const start = parseTime(period.startsAt);
  return start === undefined ? period.startsAt : toRfc3339(start);
}

/** The end of a schedule that makes exactly `count` payments. */
export function endsAtForCount(startsAt: string, unit: RecurrenceUnit, every: number, count: number): string {
  const startsMs = parseTime(startsAt) ?? 0;
  return toRfc3339(addUnits(startsMs, unit, every * count));
}

/** "every minute", "every 5 minutes", "every month"; "Every minute" with `sentence` (to start a sentence). */
export function intervalWords(recurrence: Pick<Recurrence, 'every' | 'unit'>, options: { sentence?: boolean } = {}): string {
  const unit = recurrence.unit;
  const every = options.sentence ? 'Every' : 'every';
  return recurrence.every === 1 ? `${every} ${unit}` : `${every} ${recurrence.every} ${unit}s`;
}

/** "Every 5 minutes, 3 payments", or "Every month" for a schedule with no end. */
export function scheduleWords(recurrence: Recurrence): string {
  const count = paymentCount(recurrence);
  const interval = intervalWords(recurrence, { sentence: true });
  return count !== undefined ? `${interval}, ${count} ${count === 1 ? 'payment' : 'payments'}` : interval;
}
