// PaykitService: the one place that owns the Paykit SDK handle.
//
// It wires the pieces together and offers a small, typed facade for what
// the app does today:
//
//   connect()            session (import -> sign in -> sign up), encrypted
//                        state store, payment adapter, SDK handle, initialize
//   setUpIdentity()      publish the Noise key authorization + app registry
//   publishProfile()     name + optional avatar
//   profiles             cached names and avatars for display (./profiles.ts)
//   setPublicAddresses() hand over WDK's account-0 addresses; they are
//                        published as public endpoints once the app is
//                        registered (and retried each sync round until
//                        that works)
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
// - round hooks: registerPrivatePaymentHooks (./privatePayments.ts) and
//   registerPaymentRequestHooks (./requests.ts) are called once per service,
//   here in connect(), before the loop starts. Each phase fills in its own
//   function with `service.syncLoop.addRoundHook(name, hook)`;
// - `addressCache` and `reservationInputsFor` (./paymentAdapter.ts) give the
//   per-contact receiving details.
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
import { UserFacingError, describeError, isRetryablePaykitError } from './errors';
import { SyncEventLog } from './eventLog';
import { arrayBufferToBase64, sniffImageType } from './bytes';
import { cleanKeyInput, shortKey } from './keys';
import { WdkPaymentAdapter } from './paymentAdapter';
import { connectSession, type SessionOrigin } from './session';
import { loadOrCreateStorageKey } from './secureStorage';
import { registerPrivatePaymentHooks } from './privatePayments';
import { registerPaymentRequestHooks } from './requests';
import { ProfileDirectory, cleanDisplayName } from './profiles';
import { openPaykitAppStore, openStateStore } from './stateStore';
import { PaykitSyncLoop } from './syncLoop';

export type ConnectOptions = {
  /** The wallet's BIP-39 phrase. Used once to derive the Pubky key, then dropped. */
  mnemonic: string;
  /**
   * Only for a wallet created on this device, during onboarding: a staging
   * invite code for the brand-new identity. See ./session.ts.
   */
  signupCode?: string;
  /**
   * True once this install has run setUpIdentity (onboarding finished), so
   * the SDK's local state already has the Paykit app registered.
   */
  appPublished: boolean;
  log: SyncEventLog;
};

/**
 * A profile change. Leave a field out to keep what is published; pass an
 * empty name to remove the name, or `avatar: null` to remove the photo.
 */
export type ProfileInput = {
  displayName?: string;
  avatar?: { bytes: ArrayBuffer; contentType: 'image/jpeg' | 'image/png' } | null;
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

/** Free the Rust side of an SDK handle now. The factory is typed as the interface but returns the class. */
function releaseSdk(sdk: FfiPaykitSdkInterface): void {
  if (FfiPaykitSdk.instanceOf(sdk)) sdk.uniffiDestroy();
}

export class PaykitService {
  private state: FfiPaykitStateObservation | undefined;
  private readonly stateListeners = new Set<() => void>();
  private disposed = false;
  /** The address pair last published without failures (see publishPublicEndpointsIfNeeded). */
  private endpointsPublishedFor: string | undefined;
  private publishingEndpoints = false;

  private constructor(
    private readonly sdk: FfiPaykitSdkInterface,
    readonly publicKey: string,
    readonly sessionOrigin: SessionOrigin,
    readonly identity: FfiIdentityStatus,
    readonly addressCache: ReceivingAddressCache,
    private readonly queue: SerialCallQueue,
    readonly log: SyncEventLog,
    private appPublished: boolean,
  ) {
    this.syncLoop = new PaykitSyncLoop({
      call: (label, task) => this.call(label, task, 'background'),
      contactKeys: () => this.state?.contacts.map((c) => c.publicKey) ?? [],
      log,
      onRoundComplete: () => this.refreshState('background'),
    });
    this.profiles = new ProfileDirectory({
      resolveProfile: async (key) => {
        const resolved = await this.call('resolveProfile', (sdk, signal) => sdk.resolveProfile(key, true, { signal }), 'background');
        return resolved ? { displayName: resolved.displayName, imageUri: resolved.imageUri } : undefined;
      },
      fetchImage: (uri) => this.fetchImageDataUri(uri, 'background'),
    });
    // Retries a failed or not-yet-possible endpoint publish. Costs nothing
    // (no SDK call) once the current addresses are published.
    this.syncLoop.addRoundHook('public-endpoints', () => this.publishPublicEndpointsIfNeeded('background'));
  }

  readonly syncLoop: PaykitSyncLoop;
  /** Names and avatars for display, cached (10 minutes). Use the hooks in ./hooks.ts. */
  readonly profiles: ProfileDirectory;

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
    let identity: FfiIdentityStatus;
    try {
      identity = await queue.run('initialize', (signal) => sdk.initialize({ signal }));
    } catch (error) {
      queue.close();
      releaseSdk(sdk);
      throw error;
    }
    log.info('Paykit initialized');

    const service = new PaykitService(sdk, publicKey, session.origin, identity, addressCache, queue, log, options.appPublished);
    registerPrivatePaymentHooks(service);
    registerPaymentRequestHooks(service);
    liveService = service;
    return service;
  }

  /** Run any SDK call through the serialized queue. The extension point for later modules. */
  call<T>(label: string, task: Task<T>, priority: CallPriority = 'user'): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Paykit is disconnected'));
    return this.queue.run(label, (signal) => task(this.sdk, signal), priority);
  }

  /**
   * Stop the sync loop, cancel queued SDK calls and release the SDK handle.
   * Releasing it explicitly (instead of waiting for garbage collection)
   * matters because the handle holds a live Pubky session: a forgotten old
   * handle could keep acting for an identity the app has moved away from.
   * A call already running keeps its own reference and finishes harmlessly.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.syncLoop.stop();
    this.queue.close();
    releaseSdk(this.sdk);
    if (liveService === this) liveService = undefined;
  }

  // Onboarding ----------------------------------------------------------------

  /**
   * Publish what peers need before they can link to us or pay us: the
   * Paykit Noise key authorization (signed by the root key) and our entry in
   * the app registry. Safe to repeat.
   *
   * Registering the app also unlocks the SDK's other writes: until
   * publishPaykitApp has run on this install, it refuses to publish
   * endpoints ("Paykit app ... must be published before creating new
   * state"). So public endpoints are published here, right after.
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
    this.appPublished = true;
    this.log.info('published Noise key authorization and app registry');
    await this.publishPublicEndpointsIfNeeded('user');
    return registry;
  }

  // Profile ---------------------------------------------------------------------

  /**
   * Publish name and avatar (/pub/paykit/profile.json).
   *
   * Optimistic concurrency: it reads the published profile first and
   * passes that revision as `expectedRevision`. If another device changed
   * the profile in between, the SDK refuses (ConcurrentUpdate) instead of
   * overwriting it, and the person tries again on fresh data. Fields the
   * input leaves out (and `extraJson`) are carried over from that read.
   */
  async publishProfile(input: ProfileInput): Promise<void> {
    const avatar = input.avatar;
    let uploadedUri: string | undefined;
    if (avatar) {
      const blob = await this.call('uploadProfileAvatar', (sdk, signal) => sdk.uploadProfileAvatar(avatar.bytes, avatar.contentType, { signal }));
      uploadedUri = blob.uri;
      // Show the new photo everywhere at once, without downloading it again.
      this.profiles.setImage(blob.uri, `data:${avatar.contentType};base64,${arrayBufferToBase64(avatar.bytes)}`);
    }
    const current = await this.call('fetchPaykitProfile', (sdk, signal) => sdk.fetchPaykitProfile(this.publicKey, { signal }));
    const displayName = input.displayName === undefined ? current?.profile.displayName : cleanDisplayName(input.displayName);
    const imageUri = avatar === null ? undefined : (uploadedUri ?? current?.profile.imageUri);
    await this.call('publishPaykitProfile', (sdk, signal) =>
      sdk.publishPaykitProfile({ displayName, imageUri, extraJson: current?.profile.extraJson }, current?.revision, { signal }),
    );
    this.profiles.setProfile(this.publicKey, { displayName, imageUri });
    this.log.info('published profile');
  }

  /** Our own profile as peers see it. */
  currentProfile(): Promise<FfiProfileResolution | undefined> {
    return this.call('currentProfile', (sdk, signal) => sdk.currentProfile(true, { signal }));
  }

  resolveProfile(publicKey: string): Promise<FfiProfileResolution | undefined> {
    return this.call('resolveProfile', (sdk, signal) => sdk.resolveProfile(publicKey, true, { signal }));
  }

  /**
   * Download a pubky:// image (an avatar) as a data URI for <Image>.
   * Someone else's file, so: capped at MAX_AVATAR_BYTES by the SDK, and the
   * type comes from the bytes, not the name. Anything that is not a JPEG,
   * PNG, WebP or GIF is dropped (undefined).
   */
  async fetchImageDataUri(uri: string, priority: CallPriority = 'user'): Promise<string | undefined> {
    const bytes = await this.call(
      'fetchPubkyFileBounded',
      (sdk, signal) => sdk.fetchPubkyFileBounded(uri, BigInt(MAX_AVATAR_BYTES), { signal }),
      priority,
    );
    if (!bytes) return undefined;
    const type = sniffImageType(bytes);
    return type ? `data:${type};base64,${arrayBufferToBase64(bytes)}` : undefined;
  }

  // Public endpoints -----------------------------------------------------------

  /**
   * Hand over WDK's account-0 addresses. They go into the synchronous
   * address cache (the payment adapter reads it) and are published as
   * public endpoints as soon as that is allowed.
   */
  setPublicAddresses(addresses: { btc: string; evm: string }): void {
    if (this.disposed) return;
    this.addressCache.setPublicAddresses(addresses);
    void this.publishPublicEndpointsIfNeeded('user');
  }

  /**
   * Publish account-0 addresses as public payment endpoints, once per
   * address pair. Skips (and a later sync round retries) while the app is
   * not registered yet or the addresses are not known yet. Only a publish
   * with no failed endpoint counts as done, so a partial failure is retried.
   */
  private async publishPublicEndpointsIfNeeded(priority: CallPriority): Promise<void> {
    if (this.disposed || !this.appPublished || this.publishingEndpoints) return;
    const { btc, evm } = this.addressCache.getPublicAddresses();
    if (!btc || !evm) return;
    const addressPair = `${btc}|${evm}`;
    if (addressPair === this.endpointsPublishedFor) return;
    this.publishingEndpoints = true;
    try {
      const report = await this.syncPublicEndpoints(priority);
      if (report.failed.length === 0) this.endpointsPublishedFor = addressPair;
    } catch (error) {
      this.log.warn(`public endpoints: ${describeError(error)} (retrying next round)`);
    } finally {
      this.publishingEndpoints = false;
    }
  }

  /**
   * Publish the cached account-0 addresses as public payment endpoints. Uses
   * the explicit-input SDK call, so publication does not depend on the
   * adapter callbacks. Unchanged endpoints are not rewritten. Requires the
   * app to be registered (setUpIdentity).
   */
  async syncPublicEndpoints(priority: CallPriority = 'user'): Promise<FfiEndpointSyncReport> {
    const details = this.addressCache.publicReceivingDetails();
    // An empty list would unpublish every endpoint; never send one by accident.
    if (details.length === 0) throw new Error('No receiving addresses yet');
    const report = await this.call(
      'syncPublicEndpointsWithReceivingDetails',
      (sdk, signal) =>
        sdk.syncPublicEndpointsWithReceivingDetails(
          details.map(({ identifier, payload }) => ({ identifier, payload: new FfiPaymentPayload(payload) })),
          { signal },
        ),
      priority,
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
    if (publicKey === this.publicKey) throw new UserFacingError("That's your own key.");
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
