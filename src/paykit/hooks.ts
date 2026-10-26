// React hooks over the Paykit service, for screens.
//
// State comes from the SDK's `observeState()` snapshot, refreshed after
// every sync round and after user actions. It is display data: never use
// it to decide whether a payment is allowed (the SDK's execution calls
// re-check current state themselves).
import { useContext, useMemo, useSyncExternalStore } from 'react';
import {
  FfiLinkedPeerState,
  type FfiLinkedPeerRecord,
  type FfiPaykitStateObservation,
} from '@synonymdev/react-native-paykit';

import { middleEllipsis } from '../ui/format';
import type { SyncLogEntry } from './eventLog';
import type { LinkState } from './linkState';
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

/** Repeated failures before a not-yet-linked peer counts as unreachable. */
const UNREACHABLE_AFTER_FAILURES = 3;

export function linkStateOf(record: FfiLinkedPeerRecord | undefined, isContact: boolean): LinkState {
  if (!record) return isContact ? 'waiting' : 'none';
  switch (record.state) {
    case FfiLinkedPeerState.Linked:
      return 'linked';
    case FfiLinkedPeerState.Blocked:
      return 'blocked';
    case FfiLinkedPeerState.RecoveryRequired:
      return 'recovery';
    case FfiLinkedPeerState.Linking:
      return record.failureCount >= UNREACHABLE_AFTER_FAILURES ? 'unreachable' : 'connecting';
    default:
      return isContact ? 'waiting' : 'none';
  }
}

export type ContactSummary = {
  publicKey: string;
  /** Local label, if the user set one. */
  label?: string;
  /** Label, else their published name, else a shortened key. */
  displayName: string;
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
        displayName: contact.label || contact.profile?.displayName || middleEllipsis(contact.publicKey),
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
