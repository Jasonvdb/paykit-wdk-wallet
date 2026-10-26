// Profiles and avatars of people (and of you), cached for display.
//
// A seal shows a person's photo when their public profile has one, and
// rows show their published name. Both come from the network, so this
// cache keeps them for a while instead of asking on every render:
//
//   profile  displayName + imageUri (a pubky:// URI), per pubky,
//            refreshed after PROFILE_TTL_MS (10 minutes, as Bitkit does)
//   image    the avatar as a data: URI, per image URI. Avatar URIs name
//            the file by its hash (avatar-<sha8>.jpg), so a new photo has a
//            new URI and an image entry never goes stale.
//
// Loads are deduplicated (many seals of one person cause one request) and
// a failed load is retried only after PROFILE_RETRY_MS. Nothing here throws
// to the UI: a missing profile shows the seal pattern and the short key.
//
// Profiles are other people's public data, so they are untrusted: only
// pubky:// images are fetched (never an https URL, which could be used to
// track who looks at a profile), through the SDK with a size cap, and the
// bytes must be a real image (PaykitService.fetchImageDataUri).
//
// This file has no native imports and is unit tested; PaykitService builds
// one directory per identity and feeds it from the SDK.

export type PersonProfile = {
  displayName?: string;
  /** pubky:// URI of the avatar. */
  imageUri?: string;
};

/** Where the directory gets data from. PaykitService wires these to SDK calls at background priority. */
export type ProfileSource = {
  resolveProfile(publicKey: string): Promise<PersonProfile | undefined>;
  /** The image as a data: URI, or undefined if it is missing or not an image. */
  fetchImage(uri: string): Promise<string | undefined>;
};

export const PROFILE_TTL_MS = 10 * 60_000;
export const PROFILE_RETRY_MS = 60_000;
const MAX_CACHED_IMAGES = 64;

type ProfileEntry = {
  profile?: PersonProfile;
  /** When the last load finished (successfully or not). */
  loadedAt?: number;
  failed?: boolean;
  loading?: Promise<void>;
};

type ImageEntry = {
  dataUri?: string;
  loadedAt?: number;
  failed?: boolean;
  loading?: Promise<void>;
};

/** Only images on a Pubky homeserver are fetched (see the header). */
export function isFetchableImageUri(uri: string | undefined): uri is string {
  return typeof uri === 'string' && uri.startsWith('pubky://') && uri.length <= 2048;
}

/** Trim a published name for display; an empty name counts as none. */
export function cleanDisplayName(name: string | undefined): string | undefined {
  // Strip control characters a hostile profile could use to break layout.
  const cleaned = name?.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned ? cleaned.slice(0, 128) : undefined;
}

export class ProfileDirectory {
  private readonly profiles = new Map<string, ProfileEntry>();
  private readonly images = new Map<string, ImageEntry>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly source: ProfileSource,
    private readonly now: () => number = Date.now,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** The cached profile, if any. Stable object identity until it changes (safe for useSyncExternalStore). */
  profile(publicKey: string): PersonProfile | undefined {
    return this.profiles.get(publicKey)?.profile;
  }

  /** The cached avatar data URI for a pubky:// image URI, if loaded. */
  image(uri: string): string | undefined {
    return this.images.get(uri)?.dataUri;
  }

  /** Load the profile unless a fresh one is cached (or a recent load failed). Never rejects. */
  ensureProfile(publicKey: string, options: { force?: boolean } = {}): Promise<void> {
    const entry = this.profiles.get(publicKey) ?? {};
    if (entry.loading) return entry.loading;
    const age = entry.loadedAt === undefined ? Infinity : this.now() - entry.loadedAt;
    const fresh = entry.failed ? age < PROFILE_RETRY_MS : age < PROFILE_TTL_MS;
    if (fresh && !options.force) return Promise.resolve();

    const loading = this.source
      .resolveProfile(publicKey)
      .then(
        (resolved) => {
          const profile = resolved
            ? { displayName: cleanDisplayName(resolved.displayName), imageUri: resolved.imageUri || undefined }
            : undefined;
          const previous = this.profiles.get(publicKey)?.profile;
          const same = previous?.displayName === profile?.displayName && previous?.imageUri === profile?.imageUri;
          this.profiles.set(publicKey, { profile: same ? previous : profile, loadedAt: this.now() });
        },
        () => {
          // Keep showing what we had; try again after PROFILE_RETRY_MS.
          this.profiles.set(publicKey, { profile: this.profiles.get(publicKey)?.profile, loadedAt: this.now(), failed: true });
        },
      )
      .finally(() => this.emit());
    this.profiles.set(publicKey, { ...entry, loading });
    return loading;
  }

  /** Record a profile we just published ourselves, so every screen shows it at once. */
  setProfile(publicKey: string, profile: PersonProfile): void {
    this.profiles.set(publicKey, {
      profile: { displayName: cleanDisplayName(profile.displayName), imageUri: profile.imageUri || undefined },
      loadedAt: this.now(),
    });
    this.emit();
  }

  /** Put an image we already have (our own new photo) into the cache, so it shows without a download. */
  setImage(uri: string, dataUri: string): void {
    this.images.set(uri, { dataUri, loadedAt: this.now() });
    this.trimImages();
    this.emit();
  }

  /** Load an avatar unless cached. Skips URIs that are not pubky://. Never rejects. */
  ensureImage(uri: string | undefined): Promise<void> {
    if (!isFetchableImageUri(uri)) return Promise.resolve();
    const entry = this.images.get(uri) ?? {};
    if (entry.loading) return entry.loading;
    if (entry.dataUri) return Promise.resolve();
    if (entry.failed && entry.loadedAt !== undefined && this.now() - entry.loadedAt < PROFILE_RETRY_MS) return Promise.resolve();

    const loading = this.source
      .fetchImage(uri)
      .then(
        (dataUri) => {
          this.images.set(uri, dataUri ? { dataUri, loadedAt: this.now() } : { failed: true, loadedAt: this.now() });
          this.trimImages();
        },
        () => {
          this.images.set(uri, { failed: true, loadedAt: this.now() });
        },
      )
      .finally(() => this.emit());
    this.images.set(uri, { ...entry, loading });
    return loading;
  }

  /** Drop the oldest images beyond MAX_CACHED_IMAGES (a Map keeps insertion order). */
  private trimImages(): void {
    while (this.images.size > MAX_CACHED_IMAGES) {
      const oldest = this.images.keys().next().value;
      if (oldest === undefined) return;
      this.images.delete(oldest);
    }
  }
}
