// A small in-memory log of what the Paykit layer did, for You > Sync status.
//
// It is a developer aid shown on screen, so every message must be safe to
// show and to screenshot: no mnemonics, session secrets, signup codes,
// backup strings or Paykit records (TS records are not redacted the way
// Swift/Kotlin ones are). Log short descriptions and error codes only; use
// `describeError` from ./errors.ts for errors.

export type SyncLogLevel = 'info' | 'warn' | 'error';

export type SyncLogEntry = {
  id: number;
  /** Milliseconds since epoch. */
  at: number;
  level: SyncLogLevel;
  message: string;
};

type Listener = () => void;

export class SyncEventLog {
  private entries: SyncLogEntry[] = [];
  private nextId = 1;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly capacity = 200) {}

  add(level: SyncLogLevel, message: string): void {
    this.entries = [{ id: this.nextId++, at: Date.now(), level, message }, ...this.entries].slice(0, this.capacity);
    // Mirror problems to the Metro console in dev builds. The message is the
    // same secret-free text shown on screen. console.log on purpose: in dev
    // builds console.warn/error also raise a LogBox toast on the device,
    // and a sync round that keeps failing would cover the UI with them.
    // This is the one place allowed to bypass the no-console rule.
    // eslint-disable-next-line no-console
    if (__DEV__ && level !== 'info') console.log(`[paykit] ${level}: ${message}`);
    for (const listener of this.listeners) listener();
  }

  info(message: string): void {
    this.add('info', message);
  }

  warn(message: string): void {
    this.add('warn', message);
  }

  error(message: string): void {
    this.add('error', message);
  }

  /** Newest first. The array is replaced on every change, so it works as a React snapshot. */
  snapshot(): SyncLogEntry[] {
    return this.entries;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
