// Schedule math for recurring requests: both wallets must derive the same
// billing periods from the immutable terms.
import {
  endsAtForCount,
  intervalWords,
  isScheduledPeriod,
  nextPeriodAfter,
  paymentCount,
  periodKey,
  schedulePeriods,
  startedPeriods,
  toRfc3339,
  unpaidPeriods,
  type Recurrence,
} from '../recurrence';

const START = '2026-10-26T12:00:00Z';
const startMs = Date.parse(START);
const everyMinute = (count: number): Recurrence => ({ every: 1, unit: 'minute', startsAt: START, anchor: START, endsAt: endsAtForCount(START, 'minute', 1, count) });

describe('toRfc3339', () => {
  it('drops milliseconds and keeps Z', () => {
    expect(toRfc3339(startMs + 999)).toBe(START);
  });
});

describe('schedulePeriods', () => {
  it('lists every period of a counted minute schedule', () => {
    expect(schedulePeriods(everyMinute(3))).toEqual([
      { startsAt: '2026-10-26T12:00:00Z', endsAt: '2026-10-26T12:01:00Z' },
      { startsAt: '2026-10-26T12:01:00Z', endsAt: '2026-10-26T12:02:00Z' },
      { startsAt: '2026-10-26T12:02:00Z', endsAt: '2026-10-26T12:03:00Z' },
    ]);
    expect(paymentCount(everyMinute(3))).toBe(3);
  });

  it('spaces periods by `every`', () => {
    const rec: Recurrence = { every: 5, unit: 'minute', startsAt: START, anchor: START, endsAt: endsAtForCount(START, 'minute', 5, 2) };
    expect(schedulePeriods(rec).map((p) => p.startsAt)).toEqual(['2026-10-26T12:00:00Z', '2026-10-26T12:05:00Z']);
  });

  it('starts at the first anchored period at or after starts_at', () => {
    const rec: Recurrence = { every: 1, unit: 'hour', startsAt: '2026-10-26T12:30:00Z', anchor: '2026-10-26T10:00:00Z', endsAt: '2026-10-26T16:00:00Z' };
    expect(schedulePeriods(rec).map((p) => p.startsAt)).toEqual(['2026-10-26T13:00:00Z', '2026-10-26T14:00:00Z', '2026-10-26T15:00:00Z']);
  });

  it('clamps monthly periods to the end of a short month and returns to the anchor day', () => {
    const rec: Recurrence = { every: 1, unit: 'month', startsAt: '2026-01-31T00:00:00Z', anchor: '2026-01-31T00:00:00Z', endsAt: '2026-04-30T00:00:00Z' };
    expect(schedulePeriods(rec).map((p) => p.startsAt)).toEqual(['2026-01-31T00:00:00Z', '2026-02-28T00:00:00Z', '2026-03-31T00:00:00Z']);
  });

  it('caps an endless schedule and refuses a broken one', () => {
    expect(schedulePeriods({ every: 1, unit: 'day', startsAt: START, anchor: START }, 4)).toHaveLength(4);
    expect(paymentCount({ every: 1, unit: 'day', startsAt: START, anchor: START })).toBeUndefined();
    expect(schedulePeriods({ every: 0, unit: 'minute', startsAt: START, anchor: START })).toEqual([]);
    expect(schedulePeriods({ every: 1, unit: 'fortnight', startsAt: START, anchor: START })).toEqual([]);
    expect(schedulePeriods({ every: 1, unit: 'minute', startsAt: START, anchor: START, endsAt: START })).toEqual([]);
  });
});

describe('due periods', () => {
  const rec = everyMinute(3);

  it('counts a period as started at its start instant', () => {
    expect(startedPeriods(rec, startMs - 1)).toHaveLength(0);
    expect(startedPeriods(rec, startMs)).toHaveLength(1);
    expect(startedPeriods(rec, startMs + 90_000)).toHaveLength(2);
  });

  it('leaves out paid periods', () => {
    const paid = new Set([periodKey({ startsAt: START, endsAt: '2026-10-26T12:01:00Z' })]);
    expect(unpaidPeriods(rec, paid, startMs + 90_000).map((p) => p.startsAt)).toEqual(['2026-10-26T12:01:00Z']);
  });

  it('knows the next period and when there is none', () => {
    expect(nextPeriodAfter(rec, startMs + 10_000)?.startsAt).toBe('2026-10-26T12:01:00Z');
    expect(nextPeriodAfter(rec, startMs + 150_000)).toBeUndefined();
  });
});

describe('isScheduledPeriod', () => {
  const rec = everyMinute(3);
  it('accepts exactly a scheduled period, written any RFC 3339 way', () => {
    expect(isScheduledPeriod(rec, { startsAt: '2026-10-26T12:01:00Z', endsAt: '2026-10-26T12:02:00Z' })).toBe(true);
    expect(isScheduledPeriod(rec, { startsAt: '2026-10-26T12:01:00.000Z', endsAt: '2026-10-26T12:02:00+00:00' })).toBe(true);
  });
  it('refuses shifted, stretched and out-of-range periods', () => {
    expect(isScheduledPeriod(rec, { startsAt: '2026-10-26T12:01:30Z', endsAt: '2026-10-26T12:02:30Z' })).toBe(false);
    expect(isScheduledPeriod(rec, { startsAt: '2026-10-26T12:00:00Z', endsAt: '2026-10-26T12:02:00Z' })).toBe(false);
    expect(isScheduledPeriod(rec, { startsAt: '2026-10-26T12:03:00Z', endsAt: '2026-10-26T12:04:00Z' })).toBe(false);
    expect(isScheduledPeriod(rec, { startsAt: 'yesterday', endsAt: 'today' })).toBe(false);
  });
});

it('words the interval', () => {
  expect(intervalWords({ every: 1, unit: 'minute' })).toBe('every minute');
  expect(intervalWords({ every: 5, unit: 'minute' })).toBe('every 5 minutes');
});

it('keys a one-time payment with an empty string', () => {
  expect(periodKey(undefined)).toBe('');
});
