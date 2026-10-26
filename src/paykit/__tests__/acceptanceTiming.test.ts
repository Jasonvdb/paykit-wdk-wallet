import { nextAcceptanceTiming } from '../acceptanceTiming';

const EXPIRES = Date.parse('2026-10-27T12:00:00Z');
const BEFORE = EXPIRES - 60_000;
const AFTER = EXPIRES + 1;

describe('nextAcceptanceTiming', () => {
  it('is in time when seen sent before the expiry', () => {
    expect(nextAcceptanceTiming(undefined, true, EXPIRES, BEFORE)).toBe('in-time');
    expect(nextAcceptanceTiming('waiting', true, EXPIRES, BEFORE)).toBe('in-time');
  });

  it('waits while unsent before the expiry', () => {
    expect(nextAcceptanceTiming(undefined, false, EXPIRES, BEFORE)).toBe('waiting');
  });

  it('is too late when still unsent at the expiry, even if it leaves afterwards', () => {
    const atExpiry = nextAcceptanceTiming('waiting', false, EXPIRES, EXPIRES);
    expect(atExpiry).toBe('too-late');
    expect(nextAcceptanceTiming(atExpiry, true, EXPIRES, AFTER)).toBe('too-late');
  });

  it('counts an acceptance first seen sent after the expiry as too late', () => {
    expect(nextAcceptanceTiming(undefined, true, EXPIRES, AFTER)).toBe('too-late');
  });

  it('keeps in-time once seen, whatever the clock says later', () => {
    expect(nextAcceptanceTiming('in-time', true, EXPIRES, AFTER)).toBe('in-time');
  });

  it('never expires a request without an expiry', () => {
    expect(nextAcceptanceTiming(undefined, false, undefined, AFTER)).toBe('waiting');
    expect(nextAcceptanceTiming(undefined, true, undefined, AFTER)).toBe('in-time');
  });
});
