// React glue for the Paykit service: connects it, feeds it WDK addresses and
// shares it with screens through context.
//
// This is where the two SDKs meet:
// - The mnemonic comes from WDK (useWalletLifecycle().getMnemonic) and is
//   only used to derive the Pubky key inside PaykitService.connect.
// - Receive addresses come from WDK hooks and are copied into Paykit's
//   synchronous address cache, because Paykit's adapter callbacks cannot
//   wait for WDK (see ./addressCache.ts).
//
// Connection rules:
// - After onboarding, the provider connects automatically once the wallet is
//   unlocked (`autoConnect`). During onboarding, the invite-code screen calls
//   `connect({ signupCode })` itself.
// - One connect at a time; a failed connect stays failed until someone
//   calls `connect()` again (no retry loop: staging rate-limits sign-ins).
import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useBtcAddressLoader, useWalletAddresses, useWalletLifecycle } from '../wallet';
import { describeError } from './errors';
import { SyncEventLog } from './eventLog';
import { PaykitService } from './PaykitService';

export type PaykitConnection =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected'; service: PaykitService }
  | { status: 'error'; message: string };

export type PaykitContextValue = {
  connection: PaykitConnection;
  /** The connected service, or undefined. */
  service: PaykitService | undefined;
  /** The developer event log (You > Sync status). Lives across reconnects. */
  log: SyncEventLog;
  /** Connect (or reconnect). Pass a signup code only during onboarding. */
  connect: (options?: { signupCode?: string }) => Promise<PaykitService>;
};

export const PaykitContext = createContext<PaykitContextValue | null>(null);

export function PaykitProvider({ autoConnect, children }: { autoConnect: boolean; children: ReactNode }) {
  const wallet = useWalletLifecycle();
  const addresses = useWalletAddresses();
  const loadBtcAddresses = useBtcAddressLoader();
  const [log] = useState(() => new SyncEventLog());
  const [connection, setConnection] = useState<PaykitConnection>({ status: 'disconnected' });
  const connecting = useRef<Promise<PaykitService> | null>(null);
  const service = connection.status === 'connected' ? connection.service : undefined;

  const { status: walletStatus, getMnemonic } = wallet;

  const connect = useCallback(
    (options: { signupCode?: string } = {}) => {
      if (connecting.current) return connecting.current;
      const attempt = (async () => {
        if (walletStatus !== 'ready') throw new Error('The wallet is not unlocked yet.');
        setConnection({ status: 'connecting' });
        try {
          const next = await PaykitService.connect({
            mnemonic: await getMnemonic(),
            signupCode: options.signupCode,
            log,
          });
          next.syncLoop.start();
          void next.refreshState('background');
          setConnection({ status: 'connected', service: next });
          return next;
        } catch (error) {
          const message = describeError(error);
          log.error(`connect failed: ${message}`);
          setConnection({ status: 'error', message });
          throw error;
        }
      })();
      connecting.current = attempt;
      attempt.then(
        () => (connecting.current = null),
        () => (connecting.current = null),
      );
      return attempt;
    },
    [walletStatus, getMnemonic, log],
  );

  // Auto-connect after onboarding, once per launch.
  const autoConnected = useRef(false);
  useEffect(() => {
    if (!autoConnect || walletStatus !== 'ready' || autoConnected.current) return;
    autoConnected.current = true;
    // Onboarding has usually connected already; keep that handle.
    if (connection.status === 'connected' || connection.status === 'connecting') return;
    connect().catch(() => undefined);
  }, [autoConnect, walletStatus, connect, connection.status]);

  // Copy account-0 addresses into the adapter cache, then publish them once.
  const publishedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!service || !addresses.btc || !addresses.evm) return;
    service.addressCache.setPublicAddresses({ btc: addresses.btc, evm: addresses.evm });
    const key = `${service.publicKey}:${addresses.btc}:${addresses.evm}`;
    if (publishedFor.current === key) return;
    publishedFor.current = key;
    service.syncPublicEndpoints().catch((error) => log.warn(`public endpoints: ${describeError(error)}`));
  }, [service, addresses.btc, addresses.evm, log]);

  // Derive contacts' BTC addresses: all known ones now, new ones on demand.
  useEffect(() => {
    if (!service) return;
    const cache = service.addressCache;
    const derive = async (indices: number[]) => {
      if (indices.length === 0) return;
      try {
        const derived = await loadBtcAddresses(indices);
        for (const [index, address] of derived) cache.setBtcAddress(index, address);
      } catch (error) {
        log.warn(`derive contact addresses: ${describeError(error)}`);
      }
    };
    void derive(cache.allContactAccounts().map((c) => c.accountIndex));
    const stopMissing = cache.onMissingContactAddress((_pubky, accountIndex) => void derive([accountIndex]));
    // Allocation happens synchronously in saveContactAndLink; derive right after.
    const stopChanges = cache.subscribe(() => {
      const missing = cache
        .allContactAccounts()
        .map((c) => c.accountIndex)
        .filter((index) => cache.btcAddress(index) === undefined);
      if (missing.length > 0) setTimeout(() => void derive(missing), 0);
    });
    return () => {
      stopMissing();
      stopChanges();
    };
  }, [service, loadBtcAddresses, log]);

  // Stop the loop when the provider goes away (e.g. the wallet is reset).
  useEffect(() => () => service?.dispose(), [service]);

  const value = useMemo<PaykitContextValue>(
    () => ({ connection, service, log, connect }),
    [connection, service, log, connect],
  );

  return <PaykitContext.Provider value={value}>{children}</PaykitContext.Provider>;
}
