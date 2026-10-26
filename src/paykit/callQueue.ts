// One serialized queue for every Paykit SDK call.
//
// Why: the app keeps exactly one FfiPaykitSdk handle, and both the UI and the
// background sync loop use it. The SDK locks internally, but overlapping
// calls make timing unpredictable, and a sync callback that waits on the JS
// thread can stall a call that is waiting for another. One queue gives a
// simple rule: one SDK call at a time, user actions first.
//
// - Priority: 'user' jobs always run before queued 'background' jobs (the
//   sync loop), so a tap never waits behind a whole sync round. A running
//   job is never interrupted.
// - Timeout: each job gets an AbortSignal (the generated SDK methods accept
//   `{ signal }`). On timeout the signal is aborted and the caller gets a
//   CallTimeoutError. The queue waits briefly for the aborted call to settle
//   before it starts the next one, so calls do not pile up on the handle.
// - Retry: errors the caller marks retryable (SharedStateBusy) are retried
//   with backoff inside the same job.
// - Close: when the service is disposed, queued jobs are rejected and new
//   ones are refused, so nothing runs on a released SDK handle.
//
// This file does not import the Paykit package, so it is unit tested in Node.
// The retry rule is injected by src/paykit/errors.ts.

export type CallPriority = 'user' | 'background';

export type CallTask<T> = (signal: AbortSignal) => Promise<T>;

export type CallQueueOptions = {
  /** Abort a job and reject its caller after this long. */
  timeoutMs: number;
  /** Which errors are worth retrying (for Paykit: SharedStateBusy). */
  isRetryable: (error: unknown) => boolean;
  /** Retries after the first attempt. */
  maxRetries?: number;
  /** Delay before retry n (1-based). */
  retryDelayMs?: (attempt: number) => number;
  /** After a timeout, wait at most this long for the aborted call to settle. */
  abortGraceMs?: number;
  /** Observability hook; messages carry the job label only, never arguments. */
  onEvent?: (event: CallQueueEvent) => void;
};

export type CallQueueEvent =
  | { type: 'retry'; label: string; attempt: number }
  | { type: 'timeout'; label: string; timeoutMs: number };

export class QueueClosedError extends Error {
  constructor(readonly label: string) {
    super(`${label} cancelled: Paykit is disconnected`);
    this.name = 'QueueClosedError';
  }
}

export class CallTimeoutError extends Error {
  constructor(
    readonly label: string,
    readonly timeoutMs: number,
  ) {
    super(`${label} timed out after ${timeoutMs} ms`);
    this.name = 'CallTimeoutError';
  }
}

type Job = {
  label: string;
  task: CallTask<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SerialCallQueue {
  private readonly userJobs: Job[] = [];
  private readonly backgroundJobs: Job[] = [];
  private running = false;
  private closed = false;

  constructor(private readonly options: CallQueueOptions) {}

  /** Queue `task`; resolves or rejects with its result once it has run. */
  run<T>(label: string, task: CallTask<T>, priority: CallPriority = 'user'): Promise<T> {
    if (this.closed) return Promise.reject(new QueueClosedError(label));
    return new Promise<T>((resolve, reject) => {
      const job: Job = { label, task, resolve: resolve as (value: unknown) => void, reject };
      (priority === 'user' ? this.userJobs : this.backgroundJobs).push(job);
      void this.drain();
    });
  }

  /**
   * Reject every queued job and refuse new ones. A job that is already
   * running finishes on its own (the SDK call holds its own reference to the
   * handle); nothing starts after it.
   */
  close(): void {
    this.closed = true;
    for (const job of [...this.userJobs.splice(0), ...this.backgroundJobs.splice(0)]) {
      job.reject(new QueueClosedError(job.label));
    }
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const job = this.userJobs.shift() ?? this.backgroundJobs.shift();
        if (!job || this.closed) return;
        await this.runWithRetries(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async runWithRetries(job: Job): Promise<void> {
    const maxRetries = this.options.maxRetries ?? 3;
    const delay = this.options.retryDelayMs ?? ((attempt: number) => 250 * 2 ** (attempt - 1));
    for (let attempt = 0; ; attempt++) {
      try {
        job.resolve(await this.runOnce(job));
        return;
      } catch (error) {
        const retry = !(error instanceof CallTimeoutError) && attempt < maxRetries && this.options.isRetryable(error);
        if (!retry) {
          job.reject(error);
          return;
        }
        this.options.onEvent?.({ type: 'retry', label: job.label, attempt: attempt + 1 });
        await sleep(delay(attempt + 1));
      }
    }
  }

  private async runOnce(job: Job): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Start the call; keep a handle that never rejects, to wait on after a timeout.
    const call = job.task(controller.signal);
    const settled = call.then(
      () => undefined,
      () => undefined,
    );
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CallTimeoutError(job.label, this.options.timeoutMs)), this.options.timeoutMs);
    });
    try {
      return await Promise.race([call, timeout]);
    } catch (error) {
      if (error instanceof CallTimeoutError) {
        this.options.onEvent?.({ type: 'timeout', label: job.label, timeoutMs: this.options.timeoutMs });
        controller.abort();
        await Promise.race([settled, sleep(this.options.abortGraceMs ?? 2_000)]);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
