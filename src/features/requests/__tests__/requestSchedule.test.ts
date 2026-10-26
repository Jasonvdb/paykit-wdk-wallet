// Which recurring payments are due, as the Requests screens show them.
import { requestRowSubtitle, scheduleStatus, whenWords } from '../requestSchedule';

const START = '2026-10-26T12:00:00Z';
const startMs = Date.parse(START);
const recurrence = { every: 1, unit: 'minute', startsAt: START, anchor: START, endsAt: '2026-10-26T12:03:00Z' };
const first = { startsAt: START, endsAt: '2026-10-26T12:01:00Z' };

it('lists started periods without a payment as due', () => {
  const status = scheduleStatus(recurrence, { payments: [] }, startMs + 70_000);
  expect(status?.due.map((p) => p.startsAt)).toEqual([START, '2026-10-26T12:01:00Z']);
  expect(status?.next?.startsAt).toBe('2026-10-26T12:02:00Z');
});

it('counts a period as handled once a proof or our payment exists', () => {
  const status = scheduleStatus(recurrence, { payments: [{ key: 'k', period: first, proofRecorded: false, outgoing: 'sending' }] }, startMs + 10_000);
  expect(status?.due).toEqual([]);
});

it('offers a period again when our payment of it never left', () => {
  const status = scheduleStatus(recurrence, { payments: [{ key: 'k', period: first, proofRecorded: false, outgoing: 'not-sent' }] }, startMs + 10_000);
  expect(status?.due.map((p) => p.startsAt)).toEqual([START]);
});

it('has no schedule for a one-time request', () => {
  expect(scheduleStatus(undefined, { payments: [] }, startMs)).toBeUndefined();
});

it('words when a payment is due', () => {
  expect(whenWords(startMs, startMs + 1)).toBe('now');
  expect(whenWords(startMs + 40_000, startMs)).toBe('in 40 s');
  expect(whenWords(startMs + 4 * 60_000, startMs)).toBe('in 4 min');
  expect(whenWords(startMs + 2 * 3_600_000, startMs)).toBe('in 2 h');
});

it('keeps a put-off period due, but not due now', () => {
  const status = scheduleStatus(recurrence, { payments: [] }, startMs + 10_000, (period) => period.startsAt === START);
  expect(status?.due.map((p) => p.startsAt)).toEqual([START]);
  expect(status?.dueNow).toEqual([]);
});

describe('requestRowSubtitle', () => {
  const base = { recurrence, payer: true, nowMs: startMs + 10_000 };
  it('writes sentences, with the note on its own line, and no middle dots', () => {
    const schedule = scheduleStatus(recurrence, { payments: [] }, base.nowMs);
    const text = requestRowSubtitle({ ...base, status: 'Waiting for you', schedule, note: 'Coffee' });
    expect(text).toBe('Waiting for you. Every minute, one payment due now.\n“Coffee”');
    expect(text).not.toContain('·');
  });
  it('says a put-off payment is put off, not due', () => {
    const schedule = scheduleStatus(recurrence, { payments: [] }, base.nowMs, () => true);
    expect(requestRowSubtitle({ ...base, status: 'Active: 0 of 3 paid', schedule })).toBe('Active: 0 of 3 paid. Every minute, put off for now.');
  });
  it('counts several due payments, and says when the next one is', () => {
    expect(requestRowSubtitle({ ...base, status: 'Active: 0 of 3 paid', schedule: scheduleStatus(recurrence, { payments: [] }, startMs + 70_000) })).toContain('2 payments due');
    const paid = { payments: [{ key: 'k', period: first, proofRecorded: true }] };
    expect(requestRowSubtitle({ ...base, status: 'Active: 1 of 3 paid', schedule: scheduleStatus(recurrence, paid, startMs + 10_000) })).toBe(
      'Active: 1 of 3 paid. Every minute, next one in 50 s.',
    );
  });
  it('keeps an ellipsis and words a one-time request in one sentence', () => {
    expect(requestRowSubtitle({ status: 'Waiting to reach them…', payer: false, nowMs: 0 })).toBe('Waiting to reach them…');
  });
});
