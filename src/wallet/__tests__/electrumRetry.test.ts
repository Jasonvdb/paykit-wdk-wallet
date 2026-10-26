import { ELECTRUM_CONNECTION_LOST_LOG, ELECTRUM_RETRY_DELAY_MS, isElectrumConnectionLost, retryIfElectrumDropped } from '../electrumRetry';
import { nextFailureStreak, NO_FAILURES, shouldReportFailure } from '../failureStreak';

const lost = () => new Error('Connection to server lost, please retry');

describe('isElectrumConnectionLost', () => {
  it('recognises the closed-socket error, and only that', () => {
    expect(isElectrumConnectionLost(lost())).toBe(true);
    expect(isElectrumConnectionLost('Connection to server lost, please retry')).toBe(true);
    expect(isElectrumConnectionLost(new Error('Insufficient balance'))).toBe(false);
    expect(isElectrumConnectionLost(undefined)).toBe(false);
  });

  it('matches the line WDK logs, so LogBox can ignore it', () => {
    const logged = '[AccountService] callAccountMethod:getTransfers failed: Connection to server lost, please retry';
    expect(ELECTRUM_CONNECTION_LOST_LOG.test(logged)).toBe(true);
    expect(ELECTRUM_CONNECTION_LOST_LOG.test('[AccountService] callAccountMethod:sendTransaction failed: Insufficient balance')).toBe(false);
  });
});

describe('retryIfElectrumDropped', () => {
  it('retries once after a dropped connection', async () => {
    const waits: number[] = [];
    const read = jest.fn<Promise<string>, []>().mockRejectedValueOnce(lost()).mockResolvedValueOnce('history');
    await expect(retryIfElectrumDropped(read, async (ms) => void waits.push(ms))).resolves.toBe('history');
    expect(read).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([ELECTRUM_RETRY_DELAY_MS]);
  });

  it('gives up after the second failure', async () => {
    const read = jest.fn<Promise<string>, []>().mockRejectedValue(lost());
    await expect(retryIfElectrumDropped(read, async () => undefined)).rejects.toThrow('Connection to server lost');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('never retries other errors', async () => {
    const read = jest.fn<Promise<string>, []>().mockRejectedValue(new Error('bad address'));
    await expect(retryIfElectrumDropped(read, async () => undefined)).rejects.toThrow('bad address');
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('failure streaks', () => {
  it('reports a run of failures, sooner when there is nothing to show', () => {
    let streak = NO_FAILURES;
    streak = nextFailureStreak(streak, false);
    expect(shouldReportFailure(streak, false)).toBe(false);
    streak = nextFailureStreak(streak, false);
    expect(shouldReportFailure(streak, false)).toBe(true);
    expect(shouldReportFailure(streak, true)).toBe(false);
    streak = nextFailureStreak(nextFailureStreak(streak, false), false);
    expect(shouldReportFailure(streak, true)).toBe(true);
  });

  it('resets on success', () => {
    const streak = nextFailureStreak(nextFailureStreak(nextFailureStreak(NO_FAILURES, false), false), true);
    expect(streak).toEqual(NO_FAILURES);
    expect(shouldReportFailure(streak, false)).toBe(false);
  });
});
