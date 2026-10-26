// Electrum drops the connection now and then; reads should not show that.
//
// WDK's Bitcoin module talks to Mutinynet's Electrum server over one TCP
// socket (@mempool/electrum-client). When the server or the network closes
// it (an idle timeout, the app coming back from the background), every
// request fails with "Connection to server lost, please retry" until the
// client's reconnect timer has opened a new socket, about a second later
// (`ELECTRUM_RECONNECT` in src/config/wdk.ts keeps that timer going for the
// whole session; WDK's default gives up after two closes).
//
// So a read that hits that error waits a little and tries once more before
// anyone hears about it. Only reads go through here. A send is never
// retried this way: "may have been sent" is decided by sendFailureFor
// (./sendChecks.ts), and repeating a broadcast is how a wallet pays twice.
//
// WDK also writes each failure to console.error before it throws. In dev
// builds that would raise a LogBox toast for a hiccup the app recovers
// from, so App.tsx tells LogBox to ignore exactly this message
// (`ELECTRUM_CONNECTION_LOST_LOG`).

/** The text @mempool/electrum-client rejects with while its socket is closed. */
const CONNECTION_LOST = /connection to server lost/i;

/** Matches WDK's console.error line for that failure, for LogBox.ignoreLogs. */
export const ELECTRUM_CONNECTION_LOST_LOG = /\[AccountService\] callAccountMethod:\w+ failed:[\s\S]*Connection to server lost/;

/** How long to wait before the one retry: a little longer than the client's 1 s reconnect timer. */
export const ELECTRUM_RETRY_DELAY_MS = 1_500;

/** True when an error says the Electrum socket was closed (a retry is likely to work). */
export function isElectrumConnectionLost(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return CONNECTION_LOST.test(message);
}

/**
 * Run a read; if it failed because the Electrum socket was closed, wait and
 * run it once more. Any other error, or a second failure, is thrown as is.
 */
export async function retryIfElectrumDropped<T>(
  read: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isElectrumConnectionLost(error)) throw error;
    await wait(ELECTRUM_RETRY_DELAY_MS);
    return read();
  }
}
