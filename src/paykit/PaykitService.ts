// PaykitService: the one place that owns the Paykit SDK handle.
//
// It wires the pieces together and offers a small, typed facade for what
// the app does today:
//
//   connect()            session (import -> sign in -> sign up), encrypted
//                        state store, payment adapter, SDK handle, initialize
//   setUpIdentity()      publish the Noise key authorization + app registry
//   publishProfile()     name + optional avatar
//   syncPublicEndpoints() publish BTC/USD₮ account-0 addresses
//   resolvePeer()        what another pubky publishes (registry, endpoints, profile)
//   saveContactAndLink() / removeContact() / blockContact()
//   refreshState()       observeState snapshot for the UI
//
// Rules this class enforces:
// - Exactly one SDK handle per identity. A second handle restoring the same
//   Pubky grant would replace the first one's session.
// - Every SDK call goes through one SerialCallQueue (user calls first).
// - Nothing here logs Paykit records, secrets or the mnemonic.
//
// Extension points for later phases (private payments, payment requests):
// - `call(label, task)` runs any SDK method through the queue;
// - `syncLoop.addRoundHook(name, hook)` runs code at the end of every sync
//   round;
// - `addressCache` and `reservationInputsFor` (./paymentAdapter.ts) give the
//   per-contact receiving details.
// See src/paykit/privatePayments.ts and src/paykit/requests.ts.
import {
  FfiLinkedPeerState,
  FfiPaykitSdk,
  defaultConfig,
  defaultPubkyClientConfig,
  normalizePubkyPublicKey,
  pubkyPublicKeyFromSecret,
  pubkySecretKeyFromBip39Mnemonic,
  FfiPaymentPayload,
  type FfiContactRecord,
  type FfiEndpointSyncReport,
  type FfiIdentityStatus,
  type FfiPaykitAppRegistry,
  type FfiPaykitSdkInterface,
  type FfiPaykitStateObservation,
  type FfiProfileResolution,
  type FfiPublicContactPaymentResolution,
} from '@synonymdev/react-native-paykit';

import { PAYKIT_APP_ID, PAYKIT_APP_NAME } from '../config/paykit';
import { PAYKIT_CALL_TIMEOUT_MS, PAYKIT_LINK_ADVANCE_STEPS } from '../config/sync';
import { ReceivingAddressCache } from './addressCache';
import { SerialCallQueue, type CallPriority } from './callQueue';
import { describeError, isRetryablePaykitError } from './errors';
import { SyncEventLog } from './eventLog';
import { arrayBufferToBase64 } from './bytes';
import { cleanKeyInput, shortKey } from './keys';
import { WdkPaymentAdapter } from './paymentAdapter';
import { connectSession, type SessionOrigin } from './session';
import { loadOrCreateStorageKey } from './secureStorage';
import { openPaykitAppStore, openStateStore } from './stateStore';
import { PaykitSyncLoop } from './syncLoop';

export type ConnectOptions = {
  /** The wallet's BIP-39 phrase. Used once to derive the Pubky key, then dropped. */
  mnemonic: string;
  /** Only during onboarding: a staging invite code, used only if sign-in fails. */
  signupCode?: string;
  log: SyncEventLog;
};

export type ProfileInput = {
  displayName?: string;
  avatar?: { bytes: ArrayBuffer; contentType: 'image/jpeg' | 'image/png' };
};

export type PeerOverview = {
  publicKey: string;
  registry?: FfiPaykitAppRegistry;
  publicPayment: FfiPublicContactPaymentResolution;
  profile?: FfiProfileResolution;
};

type Task<T> = (sdk: FfiPaykitSdkInterface, signal: AbortSignal) => Promise<T>;

/** Largest avatar we download for display. */
const MAX_AVATAR_BYTES = 512 * 1024;

let liveService: PaykitService | undefined;

export class PaykitService {
  private state: FfiPaykitStateObservation | undefined;
  private readonly stateListeners = new Set<() => void>();
  private disposed = false;

  private constructor(
    private readonly sdk: FfiPaykitSdkInterface,
    readonly publicKey: string,
    readonly sessionOrigin: SessionOrigin,
    readonly identity: FfiIdentityStatus,
    readonly addressCache: ReceivingAddressCache,
    readonly queue: SerialCallQueue,
    readonly log: SyncEventLog,
  ) {
    this.syncLoop = new PaykitSyncLoop({
      call: (label, task) => this.call(label, task, 'background'),
      contactKeys: () => this.state?.contacts.map((c) => c.publicKey) ?? [],
      log,
      onRoundComplete: () => this.refreshState('background'),
    });
  }

  readonly syncLoop: PaykitSyncLoop;

  /** The public key for a phrase, without connecting. Pure derivation, no network. */
  static publicKeyForMnemonic(mnemonic: string): string {
    return pubkyPublicKeyFromSecret(pubkySecretKeyFromBip39Mnemonic(mnemonic));
  }

  /**
   * Connect: derive the identity, get a session, open storage, build the SDK
   * handle and initialize it. Disposes any previous live service first.
   */
  static async connect(options: ConnectOptions): Promise<PaykitService> {
    liveService?.dispose();
    const { log } = options;
    // The Pubky key is the first 32 bytes of the BIP-39 seed (Paykit's own
    // derivation, the Bitkit / Pubky Ring convention). Not domain-separated
    // from the wallet keys: acceptable for this testnet demo only.
    const secretKey = pubkySecretKeyFromBip39Mnemonic(options.mnemonic);
    const publicKey = pubkyPublicKeyFromSecret(secretKey);
    log.info(`connecting as ${shortKey(publicKey)}`);

    // Staging uses the public DHT and the default pkarr relays.
    const pubkyClient = defaultPubkyClientConfig();
    const session = await connectSession({
      secretKey,
      publicKey,
      pubkyClient,
      signupCode: options.signupCode,
      log: (message) => log.info(message),
    });

    const encryptionKey = await loadOrCreateStorageKey();
    const store = openStateStore(publicKey, encryptionKey);
    const addressCache = new ReceivingAddressCache(openPaykitAppStore(publicKey, encryptionKey));
    const adapter = new WdkPaymentAdapter(addressCache);
    const sdk = FfiPaykitSdk.withPaymentAdapterAndPubkyClientConfig(
      store,
      session.provider,
      adapter,
      defaultConfig(PAYKIT_APP_ID),
      pubkyClient,
    );

    const queue = new SerialCallQueue({
      timeoutMs: PAYKIT_CALL_TIMEOUT_MS,
      isRetryable: isRetryablePaykitError,
      onEvent: (event) =>
        event.type === 'retry'
          ? log.warn(`${event.label}: busy, retry ${event.attempt}`)
          : log.error(`${event.label}: timed out after ${Math.round(event.timeoutMs / 1000)} s`),
    });
    const identity = await queue.run('initialize', (signal) => sdk.initialize({ signal }));
    log.info('Paykit initialized');

    const service = new PaykitService(sdk, publicKey, session.origin, identity, addressCache, queue, log);
    liveService = service;
    return service;
  }

  /** Run any SDK call through the serialized queue. The extension point for later modules. */
  call<T>(label: string, task: Task<T>, priority: CallPriority = 'user'): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Paykit is disconnected'));
    return this.queue.run(label, (signal) => task(this.sdk, signal), priority);
  }

  /** Stop background work. The SDK handle is released with the object. */
  dispose(): void {
    this.disposed = true;
    this.syncLoop.stop();
    if (liveService === this) liveService = undefined;
  }

  // Onboarding ----------------------------------------------------------------

  /**
   * Publish what peers need before they can link to us or pay us: the
   * Paykit Noise key authorization (signed by the root key) and our entry in
   * the app registry. Safe to repeat.
   */
  async setUpIdentity(): Promise<FfiPaykitAppRegistry> {
    await this.call('publishPaykitNoiseKeyAuthorization', (sdk, signal) => sdk.publishPaykitNoiseKeyAuthorization({ signal }));
    const registry = await this.call('publishPaykitApp', (sdk, signal) =>
      sdk.publishPaykitApp(
        PAYKIT_APP_NAME,
        { privatePayments: true, paymentRequests: true, receipts: true, outgoingPayments: true },
        { signal },
      ),
    );
    this.log.info('published Noise key authorization and app registry');
    return registry;
  }

  // Profile ---------------------------------------------------------------------

  /** Publish name and avatar (/pub/paykit/profile.json). Uses the current revision, so it never clobbers blindly. */
  async publishProfile(input: ProfileInput): Promise<void> {
    let imageUri: string | undefined;
    if (input.avatar) {
      const blob = await this.call('uploadProfileAvatar', (sdk, signal) =>
        sdk.uploadProfileAvatar(input.avatar!.bytes, input.avatar!.contentType, { signal }),
      );
      imageUri = blob.uri;
    }
    const current = await this.call('fetchPaykitProfile', (sdk, signal) => sdk.fetchPaykitProfile(this.publicKey, { signal }));
    await this.call('publishPaykitProfile', (sdk, signal) =>
      sdk.publishPaykitProfile(
        {
          displayName: input.displayName?.trim() || current?.profile.displayName,
          imageUri: imageUri ?? current?.profile.imageUri,
          extraJson: current?.profile.extraJson,
        },
        current?.revision,
        { signal },
      ),
    );
    this.log.info('published profile');
  }

  /** Our own profile as peers see it. */
  currentProfile(): Promise<FfiProfileResolution | undefined> {
    return this.call('currentProfile', (sdk, signal) => sdk.currentProfile(true, { signal }));
  }

  resolveProfile(publicKey: string): Promise<FfiProfileResolution | undefined> {
    return this.call('resolveProfile', (sdk, signal) => sdk.resolveProfile(publicKey, true, { signal }));
  }

  /** Download a pubky:// image (an avatar) as a data URI for <Image>. */
  async fetchImageDataUri(uri: string): Promise<string | undefined> {
    const bytes = await this.call('fetchPubkyFileBounded', (sdk, signal) =>
      sdk.fetchPubkyFileBounded(uri, BigInt(MAX_AVATAR_BYTES), { signal }),
    );
    if (!bytes) return undefined;
    const type = /\.png$/i.test(uri) ? 'image/png' : /\.webp$/i.test(uri) ? 'image/webp' : 'image/jpeg';
    return `data:${type};base64,${arrayBufferToBase64(bytes)}`;
  }

  // Public endpoints -----------------------------------------------------------

  /**
   * Publish account-0 addresses as public payment endpoints. Uses the
   * explicit-input SDK call, so publication does not depend on the adapter
   * callbacks. Unchanged endpoints are not rewritten.
   */
  async syncPublicEndpoints(): Promise<FfiEndpointSyncReport | undefined> {
    const details = this.addressCache.publicReceivingDetails();
    if (details.length === 0) return undefined;
    const report = await this.call('syncPublicEndpointsWithReceivingDetails', (sdk, signal) =>
      sdk.syncPublicEndpointsWithReceivingDetails(
        details.map(({ identifier, payload }) => ({ identifier, payload: new FfiPaymentPayload(payload) })),
        { signal },
      ),
    );
    const names = (list: { identifier: string }[]) => list.map((c) => c.identifier).join(', ') || 'none';
    this.log.info(`public endpoints: published ${names(report.published)}; failed ${names(report.failed)}`);
    return report;
  }

  // Peers and contacts -----------------------------------------------------------

  /** Normalize pasted, scanned or linked key text. Throws if it is not a pubky. */
  normalizeKey(text: string): string {
    return normalizePubkyPublicKey(cleanKeyInput(text));
  }

  /** What a pubky publishes: app registry, public endpoints and profile. */
  async resolvePeer(text: string): Promise<PeerOverview> {
    const publicKey = this.normalizeKey(text);
    const registry = await this.call('paykitAppRegistry', (sdk, signal) => sdk.paykitAppRegistry(publicKey, { signal }));
    const publicPayment = await this.call('resolvePublicContactPayment', (sdk, signal) =>
      sdk.resolvePublicContactPayment(publicKey, undefined, { signal }),
    );
    const profile = await this.resolveProfile(publicKey);
    return { publicKey, registry, publicPayment, profile };
  }

  /**
   * Save a contact and start the Encrypted Link handshake. Both people must
   * add each other; the sync loop keeps advancing the handshake until it is
   * Linked. Allocates the contact's private BTC account right away.
   */
  async saveContactAndLink(text: string, label?: string): Promise<FfiContactRecord> {
    const publicKey = this.normalizeKey(text);
    if (publicKey === this.publicKey) throw new Error("That's your own key.");
    const record = await this.call('saveContact', (sdk, signal) => sdk.saveContact({ publicKey, label }, { signal }));
    this.addressCache.ensureContactAccount(publicKey);
    this.log.info(`saved contact ${shortKey(publicKey)}`);
    try {
      await this.call('refreshContactPaykitProfile', (sdk, signal) => sdk.refreshContactPaykitProfile(publicKey, { signal }));
    } catch (error) {
      this.log.warn(`profile of ${shortKey(publicKey)}: ${describeError(error)}`);
    }
    try {
      const report = await this.call('ensureLinkWithPeer', (sdk, signal) =>
        sdk.ensureLinkWithPeer(publicKey, PAYKIT_LINK_ADVANCE_STEPS, { signal }),
      );
      this.log.info(`link with ${shortKey(publicKey)}: ${FfiLinkedPeerState[report.state]}`);
    } catch (error) {
      // Usually NotFound: they have not set up Paykit yet. The loop retries.
      this.log.warn(`link with ${shortKey(publicKey)}: ${describeError(error)}`);
    }
    this.syncLoop.resetLinkBackoff(publicKey);
    await this.refreshState();
    this.syncLoop.flush();
    return record;
  }

  async removeContact(publicKey: string): Promise<void> {
    await this.call('removeContact', (sdk, signal) => sdk.removeContact(publicKey, { signal }));
    this.log.info(`removed contact ${shortKey(publicKey)}`);
    await this.refreshState();
  }

  /** Remove the contact and block the peer: their messages are ignored from now on. */
  async blockContact(publicKey: string): Promise<void> {
    await this.call('removeContactsAndBlockPeers', (sdk, signal) => sdk.removeContactsAndBlockPeers([publicKey], { signal }));
    this.log.info(`blocked ${shortKey(publicKey)}`);
    await this.refreshState();
  }

  async unblockContact(publicKey: string, label?: string): Promise<void> {
    await this.call('saveContactsAndUnblockPeers', (sdk, signal) =>
      sdk.saveContactsAndUnblockPeers([{ publicKey, label }], { signal }),
    );
    this.syncLoop.resetLinkBackoff(publicKey);
    await this.refreshState();
    this.syncLoop.flush();
  }

  // Observed state ----------------------------------------------------------------

  /**
   * Re-read the SDK's display snapshot (contacts, link states, payment
   * requests, receipts). For display only: never use it to authorize a
   * payment.
   */
  async refreshState(priority: CallPriority = 'user'): Promise<void> {
    try {
      this.state = await this.call('observeState', (sdk, signal) => sdk.observeState({ signal }), priority);
      for (const listener of this.stateListeners) listener();
    } catch (error) {
      this.log.warn(`observeState: ${describeError(error)}`);
    }
  }

  getState(): FfiPaykitStateObservation | undefined {
    return this.state;
  }

  subscribeState(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }
}
