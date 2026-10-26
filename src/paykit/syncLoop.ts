// The foreground sync loop: Paykit delivery is pull-based, so something has
// to keep moving messages while the app is open.
//
// Every ~3 s while the app is active (paused in the background), one round:
//   1. read the scheduling snapshot (linked peers + pending outbound work);
//   2. advance Encrypted Link handshakes: peers in Linking or
//      RecoveryRequired, and saved contacts with no link yet. Both sides must
//      keep calling ensureLinkWithPeer until the link is Linked. A peer that
//      fails (usually NotFound: they have not onboarded or added us) is
//      retried with backoff, not every round;
//   3. process outbound: send queued private messages for every pending peer;
//   4. receive from linked peers;
//   5. process pending again if anything arrived (delivery confirmations);
//   6. run extension hooks (private payment lists, payment requests);
//   7. tell the provider to refresh its observeState snapshot.
// `flush()` runs a round now; the UI calls it right after a user action
// (saving a contact, sending a request) so the other phone hears about it
// within seconds instead of on the next tick.
//
// Rounds never overlap, and every SDK call goes through the serialized call
// queue at background priority, so UI calls still jump ahead between steps.
// The loop never signs in: session problems are reported, not retried.
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import {
  FfiLinkedPeerState,
  type FfiLinkedPeerRecord,
  type FfiPaykitSdkInterface,
} from '@synonymdev/react-native-paykit';

import {
  PAYKIT_LINK_ADVANCE_STEPS,
  PAYKIT_LINK_RETRY_MAX_MS,
  PAYKIT_LINK_RETRY_MIN_MS,
  PAYKIT_SYNC_INTERVAL_MS,
} from '../config/sync';
import { describeError } from './errors';
import type { SyncEventLog } from './eventLog';
import { shortKey } from './keys';

export type SyncPhase = 'stopped' | 'idle' | 'syncing' | 'paused';

export type SyncStatus = {
  phase: SyncPhase;
  rounds: number;
  lastRoundAt?: number;
  lastRoundMs?: number;
  /** Last round-level failure, as a safe description. Cleared by a clean round. */
  lastError?: string;
  linkedCount: number;
  linkingCount: number;
  pendingOutboundCount: number;
};

/** What extension hooks get each round. Records are display data, never authorization. */
export type SyncRoundContext = {
  linkedPeers: FfiLinkedPeerRecord[];
  /** Counterparties that sent us anything this round. */
  receivedFrom: string[];
};

/**
 * An extension hook runs at the end of every round, inside the loop's
 * single-flight guarantee. Use `call` for SDK work so it stays serialized.
 */
export type SyncRoundHook = (context: SyncRoundContext) => Promise<void>;

export type SyncLoopDeps = {
  /** Run one SDK call through the serialized queue at background priority. */
  call: <T>(label: string, task: (sdk: FfiPaykitSdkInterface, signal: AbortSignal) => Promise<T>) => Promise<T>;
  /** Saved contacts, from the last observed state. */
  contactKeys: () => string[];
  log: SyncEventLog;
  /** Refresh whatever the UI renders (observeState). */
  onRoundComplete: () => Promise<void>;
};

type LinkRetry = { nextAttemptAt: number; delayMs: number };

export class PaykitSyncLoop {
  private status: SyncStatus = { phase: 'stopped', rounds: 0, linkedCount: 0, linkingCount: 0, pendingOutboundCount: 0 };
  private readonly listeners = new Set<() => void>();
  private readonly hooks = new Map<string, SyncRoundHook>();
  private readonly linkRetries = new Map<string, LinkRetry>();
  private readonly lastLinkState = new Map<string, FfiLinkedPeerState>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private appStateSubscription: NativeEventSubscription | undefined;
  private roundInFlight: Promise<void> | undefined;
  private rerunRequested = false;
  private active = AppState.currentState === 'active';

  constructor(private readonly deps: SyncLoopDeps) {}

  start(): void {
    if (this.status.phase !== 'stopped') return;
    this.appStateSubscription = AppState.addEventListener('change', this.onAppStateChange);
    this.setStatus({ phase: this.active ? 'idle' : 'paused' });
    this.deps.log.info('sync loop started');
    if (this.active) this.flush();
  }

  stop(): void {
    this.appStateSubscription?.remove();
    this.appStateSubscription = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.setStatus({ phase: 'stopped' });
  }

  /** Run a round as soon as possible (after the current one, if one is running). */
  flush(): void {
    if (this.status.phase === 'stopped' || !this.active) return;
    if (this.roundInFlight) {
      this.rerunRequested = true;
      return;
    }
    clearTimeout(this.timer);
    this.roundInFlight = this.runRound().finally(() => {
      this.roundInFlight = undefined;
      this.scheduleNext();
    });
  }

  /** Register an extension hook (see src/paykit/privatePayments.ts, requests.ts). Returns an unsubscribe. */
  addRoundHook(name: string, hook: SyncRoundHook): () => void {
    this.hooks.set(name, hook);
    return () => this.hooks.delete(name);
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Forget the link backoff for a peer, e.g. right after the user adds them again. */
  resetLinkBackoff(counterparty: string): void {
    this.linkRetries.delete(counterparty);
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener();
  }

  private onAppStateChange = (next: AppStateStatus): void => {
    const wasActive = this.active;
    this.active = next === 'active';
    if (this.status.phase === 'stopped' || wasActive === this.active) return;
    if (this.active) {
      this.deps.log.info('app active: sync resumed');
      this.setStatus({ phase: 'idle' });
      this.flush();
    } else {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.setStatus({ phase: 'paused' });
    }
  };

  private scheduleNext(): void {
    if (this.status.phase === 'stopped' || !this.active) return;
    if (this.rerunRequested) {
      this.rerunRequested = false;
      this.flush();
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), PAYKIT_SYNC_INTERVAL_MS);
  }

  private async runRound(): Promise<void> {
    const started = Date.now();
    this.setStatus({ phase: 'syncing' });
    try {
      const snapshot = await this.deps.call('privateMessageSchedulingSnapshot', (sdk, signal) =>
        sdk.privateMessageSchedulingSnapshot({ signal }),
      );
      let linkedPeers = await this.advanceLinks(snapshot.linkedPeers);

      if (snapshot.pendingOutboundCounterparties.length > 0) {
        await this.processPending('outbound');
      }

      const intake = await this.deps.call('receivePrivateMessagesFromLinkedPeers', (sdk, signal) =>
        sdk.receivePrivateMessagesFromLinkedPeers({ signal }),
      );
      const receivedFrom: string[] = [];
      for (const peer of intake) {
        if (peer.error) {
          this.deps.log.warn(`receive from ${shortKey(peer.counterparty)}: ${peer.error.category()}/${peer.error.code()}`);
        } else if (peer.report && peer.report.streamItemIds.length > 0) {
          receivedFrom.push(peer.counterparty);
          this.deps.log.info(`received ${peer.report.streamItemIds.length} message(s) from ${shortKey(peer.counterparty)}`);
        }
      }
      if (receivedFrom.length > 0) {
        await this.processPending('confirmations');
        linkedPeers = await this.deps.call('linkedPeers', (sdk, signal) => sdk.linkedPeers({ signal }));
      }

      for (const [name, hook] of this.hooks) {
        try {
          await hook({ linkedPeers, receivedFrom });
        } catch (error) {
          this.deps.log.warn(`hook ${name}: ${describeError(error)}`);
        }
      }

      await this.deps.onRoundComplete();
      this.setStatus({
        phase: 'idle',
        rounds: this.status.rounds + 1,
        lastRoundAt: Date.now(),
        lastRoundMs: Date.now() - started,
        lastError: undefined,
        linkedCount: linkedPeers.filter((p) => p.state === FfiLinkedPeerState.Linked).length,
        linkingCount: linkedPeers.filter((p) => p.state === FfiLinkedPeerState.Linking).length,
        pendingOutboundCount: snapshot.pendingOutboundCounterparties.length,
      });
    } catch (error) {
      const message = describeError(error);
      if (message !== this.status.lastError) this.deps.log.error(`sync round failed: ${message}`);
      this.setStatus({
        phase: 'idle',
        rounds: this.status.rounds + 1,
        lastRoundAt: Date.now(),
        lastRoundMs: Date.now() - started,
        lastError: message,
      });
    }
  }

  private async processPending(reason: string): Promise<void> {
    const reports = await this.deps.call('processPendingPrivateMessages', (sdk, signal) =>
      sdk.processPendingPrivateMessages({ signal }),
    );
    for (const peer of reports) {
      if (peer.error) {
        this.deps.log.warn(`send to ${shortKey(peer.counterparty)}: ${peer.error.category()}/${peer.error.code()}`);
      } else if (peer.report && peer.report.sent.length > 0) {
        this.deps.log.info(`sent ${peer.report.sent.length} message(s) to ${shortKey(peer.counterparty)} (${reason})`);
      }
    }
  }

  /** Advance handshakes that need it; returns the freshest link records we have. */
  private async advanceLinks(linkedPeers: FfiLinkedPeerRecord[]): Promise<FfiLinkedPeerRecord[]> {
    const byPeer = new Map(linkedPeers.map((p) => [p.counterparty, p]));
    const candidates = new Set<string>();
    for (const peer of linkedPeers) {
      if (peer.state === FfiLinkedPeerState.Linking || peer.state === FfiLinkedPeerState.RecoveryRequired) {
        candidates.add(peer.counterparty);
      }
    }
    for (const contact of this.deps.contactKeys()) {
      const record = byPeer.get(contact);
      if (!record || record.state === FfiLinkedPeerState.NotLinked) candidates.add(contact);
    }

    const now = Date.now();
    for (const counterparty of candidates) {
      const retry = this.linkRetries.get(counterparty);
      if (retry && retry.nextAttemptAt > now) continue;
      try {
        const report = await this.deps.call(`ensureLinkWithPeer ${shortKey(counterparty)}`, (sdk, signal) =>
          sdk.ensureLinkWithPeer(counterparty, PAYKIT_LINK_ADVANCE_STEPS, { signal }),
        );
        this.linkRetries.delete(counterparty);
        this.noteLinkState(counterparty, report.state);
        const existing = byPeer.get(counterparty);
        byPeer.set(counterparty, existing ? { ...existing, state: report.state } : { ...emptyRecord(counterparty), state: report.state });
      } catch (error) {
        const delayMs = Math.min((retry?.delayMs ?? PAYKIT_LINK_RETRY_MIN_MS / 2) * 2, PAYKIT_LINK_RETRY_MAX_MS);
        this.linkRetries.set(counterparty, { nextAttemptAt: Date.now() + delayMs, delayMs });
        this.deps.log.warn(`link ${shortKey(counterparty)}: ${describeError(error)} (retry in ${Math.round(delayMs / 1000)} s)`);
      }
    }
    return [...byPeer.values()];
  }

  private noteLinkState(counterparty: string, state: FfiLinkedPeerState): void {
    const previous = this.lastLinkState.get(counterparty);
    if (previous === state) return;
    this.lastLinkState.set(counterparty, state);
    this.deps.log.info(`link with ${shortKey(counterparty)}: ${FfiLinkedPeerState[state]}`);
  }
}

function emptyRecord(counterparty: string): FfiLinkedPeerRecord {
  return {
    counterparty,
    state: FfiLinkedPeerState.NotLinked,
    lastSyncAt: undefined,
    lastPrivateReceiveAt: undefined,
    failureCount: 0,
    localRecoveryAttemptId: undefined,
    localRecoveryMarkerCreatedAt: undefined,
    localRecoveryMarkerLastError: undefined,
    remoteRecoveryAttemptId: undefined,
    remoteRecoveryMarkerObservedAt: undefined,
  };
}
