// React hooks over the Paykit service, for screens.
//
// State comes from the SDK's `observeState()` snapshot, refreshed after
// every sync round and after user actions. It is display data: never use
// it to decide whether a payment is allowed (the SDK's execution calls
// re-check current state themselves).
import { useContext, useMemo, useSyncExternalStore } from 'react';
import type { FfiPaykitStateObservation } from '@synonymdev/react-native-paykit';

import type { SyncLogEntry } from './eventLog';
import { linkStateOf, type LinkState } from './linkState';
import { PaykitContext, type PaykitContextValue } from './PaykitProvider';
import type { PaykitService } from './PaykitService';
import type { SyncStatus } from './syncLoop';

const noopSubscribe = () => () => undefined;

export function usePaykit(): PaykitContextValue {
  const context = useContext(PaykitContext);
  if (!context) throw new Error('usePaykit must be used inside <PaykitProvider>');
  return context;
}

/** The connected service, or undefined while connecting or disconnected. */
export function usePaykitService(): PaykitService | undefined {
  return usePaykit().service;
}

/** The latest observeState snapshot (contacts, links, requests, receipts). */
export function usePaykitState(): FfiPaykitStateObservation | undefined {
  const service = usePaykitService();
  return useSyncExternalStore(
    service ? (listener) => service.subscribeState(listener) : noopSubscribe,
    () => service?.getState(),
  );
}

export type ConnectionNotice = {
  /** One or two words for tight spots (a header). */
  label: string;
  /** A sentence with a next step, for a screen body. */
  message: string;
};

/**
 * The same "not connected" wording on every tab (docs/DESIGN.md, "Writing").
 * Undefined once connected. A failed connect is not retried automatically
 * (staging rate-limits sign-ins), so the message points to You > Reconnect.
 */
export function useConnectionNotice(): ConnectionNotice | undefined {
  const { connection } = usePaykit();
  switch (connection.status) {
    case 'connected':
      return undefined;
    case 'error':
      return { label: 'Offline', message: `${connection.message} You can reconnect from the You tab.` };
    default:
      return { label: 'Connecting…', message: 'Connecting to your identity…' };
  }
}

/** Sync loop status for the You tab. */
export function useSyncStatus(): SyncStatus | undefined {
  const service = usePaykitService();
  return useSyncExternalStore(
    service ? (listener) => service.syncLoop.subscribe(listener) : noopSubscribe,
    () => service?.syncLoop.getStatus(),
  );
}

/** The developer event log, newest first. Messages are secret-free by construction. */
export function useSyncLog(): SyncLogEntry[] {
  const { log } = usePaykit();
  return useSyncExternalStore(
    (listener) => log.subscribe(listener),
    () => log.snapshot(),
  );
}

export type ContactSummary = {
  publicKey: string;
  /** Local label, if the user set one. */
  label?: string;
  /** Label, else their published name. Undefined if neither: show the key. */
  name?: string;
  /** pubky:// avatar URI from their profile; load it with PaykitService.fetchImageDataUri. */
  imageUri?: string;
  linkState: LinkState;
  /** RFC3339. */
  createdAt: string;
};

/** Saved contacts with their link state, newest first. */
export function useContacts(): ContactSummary[] {
  const state = usePaykitState();
  return useMemo(() => {
    if (!state) return [];
    const links = new Map(state.linkedPeers.map((p) => [p.counterparty, p]));
    return state.contacts
      .map((contact) => ({
        publicKey: contact.publicKey,
        label: contact.label,
        name: contact.label || contact.profile?.displayName || undefined,
        imageUri: contact.profile?.imageUri,
        linkState: linkStateOf(links.get(contact.publicKey), true),
        createdAt: contact.createdAt,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [state]);
}

/** One peer's link state ('none' if they are not a contact and have no link). */
export function useLinkState(publicKey: string | undefined): LinkState {
  const state = usePaykitState();
  return useMemo(() => {
    if (!state || !publicKey) return 'none';
    const isContact = state.contacts.some((c) => c.publicKey === publicKey);
    return linkStateOf(
      state.linkedPeers.find((p) => p.counterparty === publicKey),
      isContact,
    );
  }, [state, publicKey]);
}
