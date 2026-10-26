import { CallTimeoutError, SerialCallQueue } from '../callQueue';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class BusyError extends Error {}

function makeQueue(overrides: Partial<ConstructorParameters<typeof SerialCallQueue>[0]> = {}) {
  return new SerialCallQueue({
    timeoutMs: 1_000,
    isRetryable: (error) => error instanceof BusyError,
    retryDelayMs: () => 1,
    abortGraceMs: 20,
    ...overrides,
  });
}

describe('SerialCallQueue', () => {
  it('runs one job at a time', async () => {
    const queue = makeQueue();
    let running = 0;
    let maxRunning = 0;
    const job = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await sleep(5);
      running--;
    };
    await Promise.all([queue.run('a', job), queue.run('b', job), queue.run('c', job, 'background')]);
    expect(maxRunning).toBe(1);
  });

  it('runs queued user jobs before queued background jobs', async () => {
    const queue = makeQueue();
    const order: string[] = [];
    const job = (name: string) => async () => {
      order.push(name);
      await sleep(2);
    };
    const first = queue.run('first', job('first'), 'background');
    const rest = [
      queue.run('bg1', job('bg1'), 'background'),
      queue.run('bg2', job('bg2'), 'background'),
      queue.run('user', job('user'), 'user'),
    ];
    await Promise.all([first, ...rest]);
    // "first" was already running; the user job then jumps the background queue.
    expect(order).toEqual(['first', 'user', 'bg1', 'bg2']);
  });

  it('returns results and propagates errors', async () => {
    const queue = makeQueue();
    await expect(queue.run('ok', async () => 42)).resolves.toBe(42);
    await expect(queue.run('fail', async () => Promise.reject(new Error('nope')))).rejects.toThrow('nope');
    // The queue keeps working after a failure.
    await expect(queue.run('again', async () => 'yes')).resolves.toBe('yes');
  });

  it('retries retryable errors, then gives up', async () => {
    const events: string[] = [];
    const queue = makeQueue({ maxRetries: 2, onEvent: (e) => events.push(e.type) });
    let attempts = 0;
    await expect(
      queue.run('flaky', async () => {
        attempts++;
        if (attempts < 3) throw new BusyError('busy');
        return 'done';
      }),
    ).resolves.toBe('done');
    expect(attempts).toBe(3);
    expect(events).toEqual(['retry', 'retry']);

    attempts = 0;
    await expect(
      queue.run('always busy', async () => {
        attempts++;
        throw new BusyError('busy');
      }),
    ).rejects.toBeInstanceOf(BusyError);
    expect(attempts).toBe(3);
  });

  it('does not retry other errors', async () => {
    const queue = makeQueue();
    let attempts = 0;
    await expect(
      queue.run('fatal', async () => {
        attempts++;
        throw new Error('fatal');
      }),
    ).rejects.toThrow('fatal');
    expect(attempts).toBe(1);
  });

  it('times out, aborts the task and moves on', async () => {
    const queue = makeQueue({ timeoutMs: 20 });
    let aborted = false;
    const hung = queue.run('hung', (signal) => {
      signal.addEventListener('abort', () => (aborted = true));
      return new Promise<never>(() => undefined);
    });
    const next = queue.run('next', async () => 'next ran');
    await expect(hung).rejects.toBeInstanceOf(CallTimeoutError);
    expect(aborted).toBe(true);
    await expect(next).resolves.toBe('next ran');
  });
});
