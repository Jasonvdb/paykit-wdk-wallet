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
//   unlocked (`autoConnect`). During onboarding, the identity screen calls
//   `connect()` itself.
// - One connect at a time; a failed connect stays failed until someone
//   calls `connect()` again (no retry loop: staging rate-limits sign-ins).
// - A service belongs to the wallet it was derived from. When the wallet
//   stops being 'ready' (locked, deleted, or replaced by a restore during
//   onboarding) the service is disposed. Otherwise the new wallet's
//   addresses would be published under the old wallet's pubky.
import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useBtcAddressLoader, useWalletAddresses, useWalletLifecycle } from '../wallet';
import { UserFacingError, describeError, userMessageFor } from './errors';
import { SyncEventLog } from './eventLog';
import { PaykitService } from './PaykitService';

export type PaykitConnection =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected'; service: PaykitService }
  /** `message` is written for people; the raw error is in the event log. */
  | { status: 'error'; message: string };

export type PaykitContextValue = {
  connection: PaykitConnection;
  /** The connected service, or undefined. */
  service: PaykitService | undefined;
  /** The developer event log (You > Sync status). Lives across reconnects. */
  log: SyncEventLog;
  /**
   * Connect (or reconnect). Pass a signup code only for a wallet created on
   * this device, and a sealed backup only for a restored one, both during
   * onboarding (see PaykitService.connect).
   */
  connect: (options?: { signupCode?: string; restoreBackup?: string }) => Promise<PaykitService>;
};

export const PaykitContext = createContext<PaykitContextValue | null>(null);

export function PaykitProvider({ autoConnect, children }: { autoConnect: boolean; children: ReactNode }) {
  const wallet = useWalletLifecycle();
  const addresses = useWalletAddresses();
  const loadBtcAddresses = useBtcAddressLoader();
  const [log] = useState(() => new SyncEventLog());
  const [connection, setConnection] = useState<PaykitConnection>({ status: 'disconnected' });
  const autoConnected = useRef(false);
  const connecting = useRef<Promise<PaykitService> | null>(null);
  /** Bumped whenever the wallet leaves 'ready'; a connect that spans a bump is thrown away. */
  const walletGeneration = useRef(0);
  const service = connection.status === 'connected' ? connection.service : undefined;

  const { status: walletStatus, getMnemonic } = wallet;

  const connect = useCallback(
    (options: { signupCode?: string; restoreBackup?: string } = {}) => {
      if (connecting.current) return connecting.current;
      const attempt = (async () => {
        if (walletStatus !== 'ready') throw new UserFacingError('The wallet is still starting. Try again in a moment.');
        const generation = walletGeneration.current;
        setConnection({ status: 'connecting' });
        try {
          const next = await PaykitService.connect({
            mnemonic: await getMnemonic(),
            signupCode: options.signupCode,
            restoreBackup: options.restoreBackup,
            // Onboarding only finishes after setUpIdentity has registered the app.
            appPublished: autoConnect,
            log,
          });
          if (generation !== walletGeneration.current) {
            next.dispose();
            throw new UserFacingError('The wallet changed while connecting. Try again.');
          }
          next.syncLoop.start();
          void next.refreshState('background');
          setConnection({ status: 'connected', service: next });
          return next;
        } catch (error) {
          log.error(`connect failed: ${describeError(error)}`);
          setConnection({ status: 'error', message: userMessageFor(error, "Couldn't connect your identity. Try again.") });
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
    [walletStatus, getMnemonic, autoConnect, log],
  );

  // Drop the service whenever the wallet it came from goes away.
  useEffect(() => {
    if (walletStatus === 'ready') return;
    walletGeneration.current += 1;
    autoConnected.current = false;
    setConnection((current) => (current.status === 'disconnected' ? current : { status: 'disconnected' }));
  }, [walletStatus]);

  // Auto-connect after onboarding, once per unlocked wallet.
  useEffect(() => {
    if (!autoConnect || walletStatus !== 'ready' || autoConnected.current) return;
    autoConnected.current = true;
    // Onboarding has usually connected already; keep that handle.
    if (connection.status === 'connected' || connection.status === 'connecting') return;
    connect().catch(() => undefined);
  }, [autoConnect, walletStatus, connect, connection.status]);

  // Hand account-0 addresses to the service: it caches them for the adapter
  // and publishes them as public endpoints once the app is registered.
  useEffect(() => {
    if (!service || !addresses.btc || !addresses.evm) return;
    service.setPublicAddresses({ btc: addresses.btc, evm: addresses.evm });
  }, [service, addresses.btc, addresses.evm]);

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

  // Dispose a service once it is replaced, dropped, or the provider unmounts.
  useEffect(() => () => service?.dispose(), [service]);

  const value = useMemo<PaykitContextValue>(
    () => ({ connection, service, log, connect }),
    [connection, service, log, connect],
  );

  return <PaykitContext.Provider value={value}>{children}</PaykitContext.Provider>;
}
