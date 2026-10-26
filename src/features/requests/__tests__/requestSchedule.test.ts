// Which recurring payments are due, as the Requests screens show them.
import { scheduleStatus, whenWords } from '../requestSchedule';

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
