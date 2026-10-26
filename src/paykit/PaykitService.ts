// PaykitService: the one place that owns the Paykit SDK handle.
//
// It wires the pieces together and offers a small, typed facade:
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
//   saveContactAndLink() / setContactLabel() / removeContact()
//   blockPeer() / unblockPeer() / forgetPeer()
//   privateLists         what we shared privately with each contact and
//                        what they shared with us (./privatePayments.ts
//                        fills it from the sync loop)
//   appStore             the encrypted app store the payment request book
//                        lives in (./requests.ts, ./requestBook.ts)
//   sealBackup() / openBackup() / inScratchState() / restoredFromBackup
//                        backups: seal and open them with the phrase-derived
//                        key, restore one into a throwaway handle to check
//                        it, and what connect({ restoreBackup }) restored
//                        (./backup.ts)
//   refreshState()       observeState snapshot for the UI
//
// Rules this class enforces:
// - Exactly one SDK handle per identity. A second handle restoring the same
//   Pubky grant would replace the first one's session.
// - Every SDK call goes through one SerialCallQueue (user calls first).
// - Nothing here logs Paykit records, secrets or the mnemonic.
//
// How the feature modules plug in:
// - `call(label, task)` runs any SDK method through the queue;
// - round hooks for private payment lists (registerPrivatePaymentHooks,
//   ./privatePayments.ts), payment requests (registerPaymentRequestHooks,
//   ./requests.ts) and automatic payments (registerAllowanceHooks,
//   ./automaticPayments.ts) are registered once per service, here in
//   connect(), before the loop starts, each with
//   `service.syncLoop.addRoundHook(name, hook)`;
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
  PaykitFfiError_Tags,
  type FfiContactRecord,
  type FfiEndpointSyncReport,
  type FfiIdentityStatus,
  type FfiPaykitAppRegistry,
  type FfiPaykitSdkInterface,
  type FfiPaykitStateObservation,
  type FfiProfileResolution,
  type FfiPubkyClientConfig,
  type FfiPublicContactPaymentResolution,
} from '@synonymdev/react-native-paykit';

import { PAYKIT_APP_ID, PAYKIT_APP_NAME } from '../config/paykit';
import { PAYKIT_CALL_TIMEOUT_MS, PAYKIT_LINK_ADVANCE_STEPS } from '../config/sync';
import { ReceivingAddressCache, type PublicEndpointChoice, type StringStore } from './addressCache';
import { SerialCallQueue, type CallPriority } from './callQueue';
import { UserFacingError, describeError, isRetryablePaykitError, paykitErrorTag } from './errors';
import { SyncEventLog } from './eventLog';
import { arrayBufferToBase64, isSafeAvatarSize, readImageSize, sniffImageType } from './bytes';
import { cleanKeyInput, shortKey } from './keys';
import { WdkPaymentAdapter } from './paymentAdapter';
import { AppSessionProvider, connectSession, type SessionOrigin } from './session';
import { applyBackup, BACKUP_APP_KEYS, type BackupSummary } from './backup';
import { backupKeyFrom, backupOpenMessage, openBackup, readEnvelope, sealBackup, type BackupEnvelope } from './backupCrypto';
import { loadOrCreateStorageKey } from './secureStorage';
import { registerPrivatePaymentHooks } from './privatePayments';
import { PrivateListStore } from './privatePaymentLists';
import { paymentRequestsOf, paymentsWithUndeliveredProof, registerPaymentRequestHooks } from './requests';
import { registerAllowanceHooks } from './automaticPayments';
import { ProfileDirectory, cleanDisplayName } from './profiles';
import { MemoryStateBlobStore, openPaykitAppStore, openStateStore } from './stateStore';
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
  /**
   * Onboarding Restore only: a sealed backup of this identity's contacts
   * and requests (./backup.ts), restored into the fresh state before
   * anything else runs. A backup that doesn't open, or a phone that
   * already has state for this identity, fails the connect.
   */
  restoreBackup?: string;
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

/**
 * The last public endpoint publish, for You > What you publish.
 * `published` and `failed` are endpoint identifiers.
 */
export type PublicEndpointStatus = {
  state: 'waiting' | 'publishing' | 'published' | 'failed';
  published: string[];
  failed: string[];
  /** When the last publish finished (ms since epoch). */
  at?: number;
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
  /** The endpoint set last published without failures (see publishPublicEndpointsIfNeeded). */
  private endpointsPublishedFor: string | undefined;
  private publishingEndpoints: Promise<void> | undefined;
  private endpointStatus: PublicEndpointStatus = { state: 'waiting', published: [], failed: [] };
  private readonly endpointStatusListeners = new Set<() => void>();

  private constructor(
    private readonly sdk: FfiPaykitSdkInterface,
    readonly publicKey: string,
    readonly sessionOrigin: SessionOrigin,
    readonly identity: FfiIdentityStatus,
    readonly addressCache: ReceivingAddressCache,
    /** Encrypted app-side store (paykit-app-<id>): the address map, the request book. */
    readonly appStore: StringStore,
    private readonly queue: SerialCallQueue,
    readonly log: SyncEventLog,
    private appPublished: boolean,
    /** For a throwaway SDK handle with the same session (inScratchState). */
    private readonly session: { provider: AppSessionProvider; pubkyClient: FfiPubkyClientConfig },
    /** Seals and opens backups (./backupCrypto.ts). Derived from the recovery phrase; never logged. */
    private readonly backupKey: Uint8Array,
    /** What a backup restored during this connect, if one did. */
    readonly restoredFromBackup: BackupSummary | undefined,
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
  /** Private Payment Lists, shared and received (./privatePaymentLists.ts). Display data. */
  readonly privateLists = new PrivateListStore();

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

    // The backup key comes from the same phrase-derived secret (./backupCrypto.ts),
    // so a backup opens with the recovery phrase alone.
    const backupKey = backupKeyFrom(new Uint8Array(secretKey.exportBytes()));
    // Open the backup before anything is built: a wrong paste fails fast.
    let envelope: BackupEnvelope | undefined;
    try {
      envelope = options.restoreBackup ? readEnvelope(openBackup(options.restoreBackup, backupKey), publicKey, BACKUP_APP_KEYS) : undefined;
    } catch (error) {
      throw new UserFacingError(backupOpenMessage(error) ?? "Couldn't open the backup.");
    }

    const encryptionKey = await loadOrCreateStorageKey();
    const store = openStateStore(publicKey, encryptionKey);
    const appStore = openPaykitAppStore(publicKey, encryptionKey);
    const addressCache = new ReceivingAddressCache(appStore);
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

    let restored: BackupSummary | undefined;
    if (envelope) {
      try {
        restored = await applyBackup((label, task) => queue.run(label, (signal) => task(sdk, signal)), envelope, appStore);
      } catch (error) {
        queue.close();
        releaseSdk(sdk);
        log.error(`restore backup: ${describeError(error)}`);
        if (paykitErrorTag(error) === PaykitFfiError_Tags.Policy) {
          throw new UserFacingError('This phone already has contacts or requests for this identity, so the backup was not restored over them.');
        }
        throw error;
      }
      addressCache.reloadFromStore();
      log.info(`restored a backup: ${restored.contacts} contacts, ${restored.requests} requests, ${restored.reconnecting} links to form again`);
    }

    const service = new PaykitService(
      sdk,
      publicKey,
      session.origin,
      identity,
      addressCache,
      appStore,
      queue,
      log,
      options.appPublished,
      { provider: session.provider, pubkyClient },
      backupKey,
      restored,
    );
    registerPrivatePaymentHooks(service);
    registerPaymentRequestHooks(service);
    registerAllowanceHooks(service, paymentRequestsOf(service));
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

  // Backups (./backup.ts) -------------------------------------------------------

  /** Seal backup plaintext (ASCII JSON) with this identity's backup key. */
  sealBackup(plaintext: string, nonce: Uint8Array): string {
    return sealBackup(plaintext, this.backupKey, nonce);
  }

  /** Open backup text made with this recovery phrase. Throws BackupOpenError. */
  openBackup(text: string): string {
    return openBackup(text, this.backupKey);
  }

  /**
   * Run `task` on a throwaway SDK handle: same identity and session, an
   * empty in-memory state store, no payment adapter and no sync loop. It
   * runs in this service's call queue (one SDK call at a time) and is
   * released afterwards. Its own session provider wraps the live session,
   * so nothing it does can drop this service's session.
   */
  async inScratchState<T>(label: string, task: (sdk: FfiPaykitSdkInterface, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error('Paykit is disconnected');
    return this.queue.run(label, async (signal) => {
      const scratch = FfiPaykitSdk.withPubkyClientConfig(
        new MemoryStateBlobStore(),
        new AppSessionProvider(this.session.provider.loadSessionAccess()),
        defaultConfig(PAYKIT_APP_ID),
        this.session.pubkyClient,
      );
      try {
        await scratch.initialize({ signal });
        return await task(scratch, signal);
      } finally {
        releaseSdk(scratch);
      }
    });
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
   * A field-level merge: it reads the published profile right before
   * publishing, carries over the fields the input leaves out (and
   * `extraJson`), and passes that read's revision as `expectedRevision`.
   * So ConcurrentUpdate only catches another device writing between this
   * read and the publish; it does not protect what an edit screen loaded
   * earlier. To guard that too, the screen would load the revision when
   * it opens and pass it through ProfileInput.
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
   * PNG, WebP or GIF is dropped (undefined), and so is an image whose
   * header declares more than 2048 px a side or 4 MP: a small file can
   * declare a huge canvas, and decoding it in every seal that shows this
   * person could run the app out of memory each time.
   */
  async fetchImageDataUri(uri: string, priority: CallPriority = 'user'): Promise<string | undefined> {
    const bytes = await this.call(
      'fetchPubkyFileBounded',
      (sdk, signal) => sdk.fetchPubkyFileBounded(uri, BigInt(MAX_AVATAR_BYTES), { signal }),
      priority,
    );
    if (!bytes) return undefined;
    const type = sniffImageType(bytes);
    if (!type) return undefined;
    if (!isSafeAvatarSize(readImageSize(bytes, type))) {
      this.log.warn('dropped an avatar: its declared size is too large or unreadable');
      return undefined;
    }
    return `data:${type};base64,${arrayBufferToBase64(bytes)}`;
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

  publicEndpointChoice(): PublicEndpointChoice {
    return this.addressCache.publicEndpointChoice();
  }

  /**
   * Switch public endpoints on or off per asset (You > What you publish),
   * then publish to match: a switched-off asset's endpoint is removed from
   * the homeserver. Contacts keep getting private addresses either way.
   * Resolves once the publish ran; its outcome is in publicEndpointStatus().
   */
  async setPublicEndpointChoice(choice: PublicEndpointChoice): Promise<void> {
    this.addressCache.setPublicEndpointChoice(choice);
    await this.publishPublicEndpointsIfNeeded('user');
  }

  publicEndpointStatus(): PublicEndpointStatus {
    return this.endpointStatus;
  }

  subscribePublicEndpointStatus(listener: () => void): () => void {
    this.endpointStatusListeners.add(listener);
    return () => this.endpointStatusListeners.delete(listener);
  }

  private setEndpointStatus(status: PublicEndpointStatus): void {
    this.endpointStatus = status;
    for (const listener of this.endpointStatusListeners) listener();
  }

  /** What should be published right now, as a comparable key, or undefined while addresses are unknown. */
  private desiredEndpointsKey(): string | undefined {
    if (!this.addressCache.publicAddressesKnown()) return undefined;
    return this.addressCache
      .publicReceivingDetails()
      .map((d) => `${d.identifier}=${d.payload}`)
      .join('|');
  }

  /**
   * Publish what the cache says (account-0 addresses of the switched-on
   * assets), once per distinct set. Skips (and a later sync round retries)
   * while the app is not registered yet or the addresses are not known yet.
   * Only a publish with no failed endpoint counts as done, so a partial
   * failure is retried. If the choice changes while a publish runs, it runs
   * again for the new choice.
   */
  private async publishPublicEndpointsIfNeeded(priority: CallPriority): Promise<void> {
    if (this.disposed || !this.appPublished) return;
    if (this.publishingEndpoints) return this.publishingEndpoints;
    const run = async () => {
      for (;;) {
        const desired = this.desiredEndpointsKey();
        if (this.disposed || desired === undefined || desired === this.endpointsPublishedFor) return;
        this.setEndpointStatus({ ...this.endpointStatus, state: 'publishing' });
        try {
          const report = await this.syncPublicEndpoints(priority);
          const failed = report.failed.map((c) => c.identifier);
          if (failed.length === 0) this.endpointsPublishedFor = desired;
          this.setEndpointStatus({
            state: failed.length === 0 ? 'published' : 'failed',
            published: this.addressCache.publicReceivingDetails().map((d) => d.identifier),
            failed,
            at: Date.now(),
          });
          if (failed.length > 0) return;
        } catch (error) {
          this.log.warn(`public endpoints: ${describeError(error)} (retrying next round)`);
          this.setEndpointStatus({ ...this.endpointStatus, state: 'failed', at: Date.now() });
          return;
        }
      }
    };
    this.publishingEndpoints = run().finally(() => {
      this.publishingEndpoints = undefined;
    });
    return this.publishingEndpoints;
  }

  /**
   * Publish the cached public receiving details (see publicReceivingDetails)
   * and remove our other SDK-managed endpoints. Uses the explicit-input SDK
   * call, so publication does not depend on the adapter callbacks.
   * Unchanged endpoints are not rewritten. Requires the app to be
   * registered (setUpIdentity).
   */
  async syncPublicEndpoints(priority: CallPriority = 'user'): Promise<FfiEndpointSyncReport> {
    // An empty list unpublishes every endpoint. That is only right when the
    // person switched both off, never because addresses are not known yet.
    if (!this.addressCache.publicAddressesKnown()) throw new Error('No receiving addresses yet');
    const details = this.addressCache.publicReceivingDetails();
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
    this.log.info(`public endpoints: published ${names(report.published)}; removed ${names(report.removed)}; failed ${names(report.failed)}`);
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
   *
   * `ensureLinkWithPeer` is the right call for both sides: the SDK picks
   * initiator or responder from the two keys, so neither app has to decide
   * (initiateLinkWithPeer, acceptLinkWithPeer and advanceLinkHandshake are
   * the lower-level steps it runs).
   */
  async saveContactAndLink(text: string, label?: string): Promise<FfiContactRecord> {
    const publicKey = this.normalizeKey(text);
    if (publicKey === this.publicKey) throw new UserFacingError("That's your own key.");
    const peer = this.state?.linkedPeers.find((p) => p.counterparty === publicKey);
    const existing = this.state?.contacts.find((c) => c.publicKey === publicKey);
    // Saving again must not drop a label the person set earlier.
    const update = { publicKey, label: label?.trim() ? cleanDisplayName(label) : existing?.label };
    // A peer left blocked (a removal that could not unblock) is unblocked by
    // the same atomic call that saves the contact.
    const record =
      peer?.state === FfiLinkedPeerState.Blocked
        ? (await this.call('saveContactsAndUnblockPeers', (sdk, signal) => sdk.saveContactsAndUnblockPeers([update], { signal })))[0]
        : await this.call('saveContact', (sdk, signal) => sdk.saveContact(update, { signal }));
    if (!record) throw new Error('The contact was not saved');
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

  /**
   * Your own name for a contact, shown instead of the name they publish.
   * Local only: it never leaves this phone. An empty label goes back to
   * their published name.
   */
  async setContactLabel(publicKey: string, label: string): Promise<void> {
    const cleaned = cleanDisplayName(label);
    await this.call('saveContact', (sdk, signal) => sdk.saveContact({ publicKey, label: cleaned || undefined }, { signal }));
    this.log.info(`renamed contact ${shortKey(publicKey)}`);
    await this.refreshState();
  }

  /**
   * Remove a contact and end the private connection with them.
   *
   * The SDK keeps a Contact Record and an Encrypted Link apart:
   * `removeContact` deletes only the record and leaves the link (and their
   * messages) running. Removing someone here means "stop paying each other
   * privately", so:
   *   1. queue an empty Private Payment List for them and send it (best
   *      effort): their wallet drops our private addresses;
   *   2. `removeContactsAndBlockPeers` removes the record and discards the
   *      link in one transaction;
   *   3. `unblockPeer` returns them to NotLinked and clears our recovery
   *      attempt id, so adding them again starts a fresh link (their side
   *      sees the new attempt and links again too) instead of a blocked peer.
   *      Skipped for someone the person had blocked: removing them must not
   *      lift the block, so their messages stay refused.
   * Money already sent to the addresses they had still arrives; the
   * contact's Bitcoin account stays in You > Bitcoin from contacts.
   */
  async removeContact(publicKey: string): Promise<void> {
    this.refuseWhileProofPending(publicKey);
    const wasBlocked = this.isBlocked(publicKey);
    await this.withdrawPrivateList(publicKey);
    const removed = await this.call('removeContactsAndBlockPeers', (sdk, signal) => sdk.removeContactsAndBlockPeers([publicKey], { signal }));
    if (removed.length === 0 && this.state?.contacts.some((c) => c.publicKey === publicKey)) {
      // The SDK skips a peer that is in the middle of another operation.
      throw new UserFacingError('Still finishing something with them. Try again in a moment.');
    }
    if (!wasBlocked) {
      try {
        await this.call('unblockPeer', (sdk, signal) => sdk.unblockPeer(publicKey, { signal }));
      } catch (error) {
        // Adding them again unblocks them (saveContactAndLink).
        this.log.warn(`unblock ${shortKey(publicKey)} after removing: ${describeError(error)}`);
      }
    }
    this.privateLists.forget(publicKey);
    this.syncLoop.resetLinkBackoff(publicKey);
    this.log.info(`removed contact ${shortKey(publicKey)} and ended the link${wasBlocked ? ' (still blocked)' : ''}`);
    await this.refreshState();
  }

  /**
   * Block someone: their requests, lists and other private messages are
   * ignored until you unblock them. The contact record (and your label)
   * stays, so the Person page can show "Blocked" with Unblock.
   *
   * What the SDK's `blockPeer` does: it discards the Encrypted Link (keys
   * and handshake), marks every message still waiting to go to them as
   * needing a fresh link, and makes the request, allowance and payment
   * calls refuse this peer. Payment requests, proofs and receipts already
   * stored stay. So, like removeContact:
   *   - refuse while a proof of our payment to them has not left (it
   *     would never reach them);
   *   - first withdraw our Private Payment List (best effort), so their
   *     wallet drops our private addresses.
   */
  async blockPeer(publicKey: string): Promise<void> {
    this.refuseWhileProofPending(publicKey);
    await this.withdrawPrivateList(publicKey);
    await this.call('blockPeer', (sdk, signal) => sdk.blockPeer(publicKey, { signal }));
    this.privateLists.forget(publicKey);
    this.log.info(`blocked ${shortKey(publicKey)}`);
    await this.refreshState();
  }

  /**
   * Unblock: `unblockPeer` returns them to NotLinked (the old link is not
   * restored). If they are still a contact, the sync loop starts a fresh
   * link on its next round; their wallet sees the new attempt and links
   * again.
   */
  async unblockPeer(publicKey: string): Promise<void> {
    await this.call('unblockPeer', (sdk, signal) => sdk.unblockPeer(publicKey, { signal }));
    this.syncLoop.resetLinkBackoff(publicKey);
    this.log.info(`unblocked ${shortKey(publicKey)}`);
    await this.refreshState();
    this.syncLoop.flush();
  }

  /**
   * Forget what a blocked person sent (`forgetPeer`): the messages received
   * from them (requests and allowance offers you never answered, their
   * Private Payment List, receipt access you never used) are deleted for
   * good. The SDK refuses unless they are blocked, and refuses when you
   * have history with them (anything you sent them besides lists and
   * confirmations, a payment you claimed, the payment ledger, a receipt
   * you retrieved): those records name only ids, which a forgotten peer
   * could otherwise reuse with other terms. Nothing is sent to them.
   *
   * Returns 'kept' when the SDK refused because of that history: a normal
   * outcome, not an error, so the screen says so in Graphite.
   */
  async forgetPeer(publicKey: string): Promise<'forgotten' | 'kept'> {
    try {
      await this.call('forgetPeer', (sdk, signal) => sdk.forgetPeer(publicKey, { signal }));
    } catch (error) {
      if (paykitErrorTag(error) === PaykitFfiError_Tags.Policy) {
        this.log.info(`forget ${shortKey(publicKey)}: refused, history kept (${describeError(error)})`);
        return 'kept';
      }
      throw error;
    }
    this.log.info(`forgot what ${shortKey(publicKey)} sent`);
    await this.refreshState();
    return 'forgotten';
  }

  /**
   * Removing and blocking end the link and drop the messages still queued
   * for them: a proof of our payment waiting to go out would be lost for
   * good, so both refuse until it has left.
   */
  private refuseWhileProofPending(publicKey: string): void {
    if (paymentsWithUndeliveredProof(this, publicKey) > 0) {
      throw new UserFacingError("A proof of your payment to them hasn't gone out yet. Try again in a minute, once it has.");
    }
  }

  private isBlocked(publicKey: string): boolean {
    return !!this.state?.linkedPeers.some((p) => p.counterparty === publicKey && p.state === FfiLinkedPeerState.Blocked);
  }

  /** Send an empty Private Payment List to a Linked peer (best effort), so they drop our private addresses. */
  private async withdrawPrivateList(publicKey: string): Promise<void> {
    const linked = this.state?.linkedPeers.some((p) => p.counterparty === publicKey && p.state === FfiLinkedPeerState.Linked);
    if (!linked) return;
    try {
      await this.call('clearPrivatePaymentListAndProcessOutbound', (sdk, signal) => sdk.clearPrivatePaymentListAndProcessOutbound(publicKey, { signal }));
      this.log.info(`withdrew private list from ${shortKey(publicKey)}`);
    } catch (error) {
      this.log.warn(`withdraw private list from ${shortKey(publicKey)}: ${describeError(error)}`);
    }
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
