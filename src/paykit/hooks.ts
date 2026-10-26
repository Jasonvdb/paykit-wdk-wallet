// React hooks over the Paykit service, for screens.
//
// State comes from the SDK's `observeState()` snapshot, refreshed after
// every sync round and after user actions. It is display data: never use
// it to decide whether a payment is allowed (the SDK's execution calls
// re-check current state themselves).
import { useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { FfiPaykitStateObservation } from '@synonymdev/react-native-paykit';

import type { SyncLogEntry } from './eventLog';
import { linkStateOf, type LinkState } from './linkState';
import { PaykitContext, type PaykitContextValue } from './PaykitProvider';
import type { PaykitService, PublicEndpointStatus } from './PaykitService';
import type { IncomingList, OutgoingListStatus } from './privatePaymentLists';
import { cleanDisplayName, type PersonProfile } from './profiles';
import type { BillingPeriod } from './recurrence';
import { paymentKey, type RequestBook } from './requestBook';
import { paymentRequestsOf, receivedReceiptKeys, requestFactsOf, requestViewOf, type RequestView } from './requests';
import type { RequestFacts } from './requestStatus';
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
  /** Their published name from the contact record (cleaned), never your label. */
  publishedName?: string;
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
        name: contact.label || cleanDisplayName(contact.profile?.displayName),
        publishedName: cleanDisplayName(contact.profile?.displayName),
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

export type DisplayProfile = {
  /** Their published name (or your own), if any. A local contact label is not included. */
  displayName?: string;
  /** The avatar as a data: URI, ready for <Seal imageUri> or <Image>. */
  image?: string;
};

/**
 * A person's published name and avatar, from the service's profile cache
 * (./profiles.ts). Loads in the background on first use and every 10
 * minutes after that. `hint` is what the caller already knows (a contact
 * record's profile from observeState), shown until the cache has more.
 */
export function usePersonProfile(publicKey: string | undefined, hint?: PersonProfile): DisplayProfile {
  const service = usePaykitService();
  const directory = service?.profiles;
  const subscribe = useCallback((listener: () => void) => (directory ? directory.subscribe(listener) : () => undefined), [directory]);
  const cached = useSyncExternalStore(subscribe, () => (publicKey ? directory?.profile(publicKey) : undefined));
  // The hint is someone else's data too: clean it like a fetched profile.
  const displayName = cached?.displayName ?? cleanDisplayName(hint?.displayName);
  const imageUri = cached ? cached.imageUri : hint?.imageUri;
  const image = useSyncExternalStore(subscribe, () => (imageUri ? directory?.image(imageUri) : undefined));

  useEffect(() => {
    if (directory && publicKey) void directory.ensureProfile(publicKey);
  }, [directory, publicKey]);
  useEffect(() => {
    if (directory && imageUri) void directory.ensureImage(imageUri);
  }, [directory, imageUri]);

  return useMemo(() => ({ displayName, image }), [displayName, image]);
}

/** Your own published name and avatar. */
export function useOwnProfile(): DisplayProfile {
  return usePersonProfile(usePaykitService()?.publicKey);
}

/** The last public endpoint publish (You > What you publish). */
export function usePublicEndpointStatus(): PublicEndpointStatus | undefined {
  const service = usePaykitService();
  return useSyncExternalStore(
    service ? (listener) => service.subscribePublicEndpointStatus(listener) : noopSubscribe,
    () => service?.publicEndpointStatus(),
  );
}

// Private payments (Phase 4) ------------------------------------------------------

/** Re-render when the service's private lists change; returns the store (or undefined). */
function usePrivateListStore() {
  const service = usePaykitService();
  const store = service?.privateLists;
  useSyncExternalStore(
    store ? (listener) => store.subscribe(listener) : noopSubscribe,
    () => store?.getRevision(),
  );
  return store;
}

export type PrivateListsWithPerson = {
  /** What they shared with you (checked addresses), once read. */
  incoming?: IncomingList;
  /** Whether your list reached them. */
  outgoing?: OutgoingListStatus;
};

/** One contact's Private Payment Lists, both ways. Display data. */
export function usePrivateLists(publicKey: string | undefined): PrivateListsWithPerson {
  const store = usePrivateListStore();
  if (!store || !publicKey) return {};
  return { incoming: store.incomingList(publicKey), outgoing: store.outgoingStatus(publicKey) };
}

/** How many contacts have your list and how many shared theirs (You > Network details). */
export function usePrivateListSummary(): { sharedWith: number; receivedFrom: number } | undefined {
  return usePrivateListStore()?.summary();
}

/** Addresses contacts shared with you privately -> their pubky (lowercased address keys). */
export function usePrivateAddressOwners(): ReadonlyMap<string, string> {
  const store = usePrivateListStore();
  return store?.addressOwners() ?? EMPTY_OWNERS;
}

const EMPTY_OWNERS: ReadonlyMap<string, string> = new Map();

export type ContactAccount = { pubky: string; accountIndex: number };

/** Each contact's own Bitcoin account (where their private payments land), kept current. */
export function useContactAccounts(): ContactAccount[] {
  const service = usePaykitService();
  const cache = service?.addressCache;
  const subscribe = useCallback((listener: () => void) => (cache ? cache.subscribe(listener) : () => undefined), [cache]);
  // The cache returns a new array each time: compare by content.
  const key = useSyncExternalStore(subscribe, () =>
    cache ? cache.allContactAccounts().map((a) => `${a.accountIndex}:${a.pubky}`).join(',') : '',
  );
  return useMemo(
    () =>
      key
        ? key.split(',').map((entry) => {
            const [index, pubky] = entry.split(':');
            return { accountIndex: Number(index), pubky: pubky ?? '' };
          })
        : [],
    [key],
  );
}

// Payment requests (Phase 5) -------------------------------------------------------

/** Re-render when the request book changes; returns it (or undefined while disconnected). */
export function useRequestBook(): RequestBook | undefined {
  const service = usePaykitService();
  const book = service ? paymentRequestsOf(service).book : undefined;
  useSyncExternalStore(
    book ? (listener) => book.subscribe(listener) : noopSubscribe,
    () => book?.getRevision(),
  );
  return book;
}

/** Every payment request, newest activity first. Display data from observeState. */
export function usePaymentRequests(): RequestView[] {
  const state = usePaykitState();
  return useMemo(
    () => (state?.paymentRequests ?? []).map(requestViewOf).sort((a, b) => (b.lastEventAtMs ?? 0) - (a.lastEventAtMs ?? 0)),
    [state],
  );
}

/** One request by its counterparty and id. */
export function usePaymentRequest(counterparty: string, requestId: string): RequestView | undefined {
  return usePaymentRequests().find((r) => r.counterparty === counterparty && r.requestId === requestId);
}

/**
 * A request's facts for the status words and timeline (./requestStatus.ts):
 * the record, our payment or check from the book, and the receipts.
 */
export function useRequestFacts(view: RequestView | undefined, name: string): RequestFacts | undefined {
  const state = usePaykitState();
  const book = useRequestBook();
  const revision = book?.getRevision();
  return useMemo(
    () => (view && book ? requestFactsOf(view, book, receivedReceiptKeys(state), name) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the book is mutable; its revision says when it changed
    [view, book, revision, state, name],
  );
}

/** What links an on-chain transaction to a payment request (Activity rows and detail). */
export type RequestLink = {
  counterparty: string;
  requestId: string;
  role: 'payer' | 'payee';
  period?: BillingPeriod;
  /** Payer: receipt retrieved. Payee: receipt sent. */
  receipt?: 'received' | 'sent';
  /** Payee: our on-chain check. */
  check?: 'pending' | 'verified' | 'rejected';
};

/** Transaction hash (lowercase) -> the request it paid, from proofs and our own payments in flight. */
export function useRequestLinks(): ReadonlyMap<string, RequestLink> {
  const requests = usePaymentRequests();
  const state = usePaykitState();
  const book = useRequestBook();
  const revision = book?.getRevision();
  return useMemo(() => {
    const links = new Map<string, RequestLink>();
    if (!book) return links;
    const receipts = receivedReceiptKeys(state);
    for (const view of requests) {
      if (view.role === 'unknown') continue;
      const recurring = !!view.terms?.recurrence;
      const add = (txHash: string | undefined, period: BillingPeriod | undefined) => {
        if (!txHash) return;
        const key = paymentKey(view.counterparty, view.requestId, recurring ? period : undefined);
        const check = book.check(key);
        links.set(txHash.toLowerCase(), {
          counterparty: view.counterparty,
          requestId: view.requestId,
          role: view.role === 'payer' ? 'payer' : 'payee',
          period: recurring ? period : undefined,
          receipt: receipts.has(key) ? 'received' : check?.receipt === 'sent' ? 'sent' : undefined,
          check: check?.status,
        });
      };
      for (const proof of view.proofs) add(proof.txHash, proof.period);
    }
    for (const payment of book.allOutgoing()) {
      if (payment.txHash && !links.has(payment.txHash.toLowerCase())) {
        links.set(payment.txHash.toLowerCase(), { counterparty: payment.counterparty, requestId: payment.requestId, role: 'payer', period: payment.period });
      }
    }
    return links;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the book is mutable; its revision says when it changed
  }, [requests, state, book, revision]);
}
