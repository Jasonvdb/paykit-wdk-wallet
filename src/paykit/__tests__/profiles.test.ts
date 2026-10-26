import { PROFILE_RETRY_MS, PROFILE_TTL_MS, ProfileDirectory, cleanDisplayName, isFetchableImageUri, type ProfileSource } from '../profiles';

function fakeSource(overrides: Partial<Record<keyof ProfileSource, jest.Mock>> = {}) {
  return {
    resolveProfile: jest.fn<ReturnType<ProfileSource['resolveProfile']>, [string]>(async (publicKey) => ({
      displayName: `name of ${publicKey}`,
      imageUri: `pubky://${publicKey}/pub/paykit/blobs/avatar-1.jpg`,
    })),
    fetchImage: jest.fn<ReturnType<ProfileSource['fetchImage']>, [string]>(async (uri) => `data:image/jpeg;base64,${uri.length}`),
    ...overrides,
  };
}

describe('ProfileDirectory', () => {
  let time = 0;
  const now = () => time;
  beforeEach(() => {
    time = 1_000_000;
  });

  it('loads a profile once while it is fresh and shares one request between callers', async () => {
    const source = fakeSource();
    const directory = new ProfileDirectory(source, now);
    await Promise.all([directory.ensureProfile('ana'), directory.ensureProfile('ana')]);
    await directory.ensureProfile('ana');
    expect(source.resolveProfile).toHaveBeenCalledTimes(1);
    expect(directory.profile('ana')?.displayName).toBe('name of ana');

    time += PROFILE_TTL_MS + 1;
    await directory.ensureProfile('ana');
    expect(source.resolveProfile).toHaveBeenCalledTimes(2);
  });

  it('keeps the old profile when a refresh fails and retries only after a pause', async () => {
    const source = fakeSource();
    const directory = new ProfileDirectory(source, now);
    await directory.ensureProfile('ana');
    const first = directory.profile('ana');

    source.resolveProfile.mockRejectedValueOnce(new Error('offline'));
    time += PROFILE_TTL_MS + 1;
    await directory.ensureProfile('ana');
    expect(directory.profile('ana')).toBe(first);

    await directory.ensureProfile('ana');
    expect(source.resolveProfile).toHaveBeenCalledTimes(2);
    time += PROFILE_RETRY_MS + 1;
    await directory.ensureProfile('ana');
    expect(source.resolveProfile).toHaveBeenCalledTimes(3);
  });

  it('keeps the same object when nothing changed, so React does not re-render', async () => {
    const directory = new ProfileDirectory(fakeSource(), now);
    await directory.ensureProfile('ana');
    const first = directory.profile('ana');
    await directory.ensureProfile('ana', { force: true });
    expect(directory.profile('ana')).toBe(first);
  });

  it('notifies listeners and accepts a profile we just published', async () => {
    const directory = new ProfileDirectory(fakeSource(), now);
    const listener = jest.fn();
    directory.subscribe(listener);
    directory.setProfile('me', { displayName: '  Ana  ', imageUri: 'pubky://me/pub/paykit/blobs/avatar-2.jpg' });
    expect(listener).toHaveBeenCalled();
    expect(directory.profile('me')).toEqual({ displayName: 'Ana', imageUri: 'pubky://me/pub/paykit/blobs/avatar-2.jpg' });
  });

  it('fetches only pubky:// images, once each', async () => {
    const source = fakeSource();
    const directory = new ProfileDirectory(source, now);
    await directory.ensureImage('https://tracker.example/pixel.png');
    await directory.ensureImage('pubky://ana/pub/paykit/blobs/avatar-1.jpg');
    await directory.ensureImage('pubky://ana/pub/paykit/blobs/avatar-1.jpg');
    expect(source.fetchImage).toHaveBeenCalledTimes(1);
    expect(directory.image('pubky://ana/pub/paykit/blobs/avatar-1.jpg')).toMatch(/^data:image\/jpeg/);
    expect(directory.image('https://tracker.example/pixel.png')).toBeUndefined();
  });

  it('retries a failed image only after a pause', async () => {
    const source = fakeSource({ fetchImage: jest.fn(async () => undefined) });
    const directory = new ProfileDirectory(source, now);
    const uri = 'pubky://ana/pub/paykit/blobs/avatar-1.jpg';
    await directory.ensureImage(uri);
    await directory.ensureImage(uri);
    expect(source.fetchImage).toHaveBeenCalledTimes(1);
    time += PROFILE_RETRY_MS + 1;
    await directory.ensureImage(uri);
    expect(source.fetchImage).toHaveBeenCalledTimes(2);
  });
});

describe('profile helpers', () => {
  it('cleans display names', () => {
    expect(cleanDisplayName('  Ben (Android) ')).toBe('Ben (Android)');
    expect(cleanDisplayName('   ')).toBeUndefined();
    expect(cleanDisplayName('A\u0000na\n')).toBe('Ana');
    expect(cleanDisplayName('x'.repeat(300))).toHaveLength(128);
  });

  it('drops bidi overrides and zero-width characters from names', () => {
    expect(cleanDisplayName('Ben\u202e (Android)')).toBe('Ben (Android)');
    expect(cleanDisplayName('B\u200be\u200dn\u2066')).toBe('Ben');
    expect(cleanDisplayName('\ufeff\u00ad')).toBeUndefined();
  });

  it('accepts only pubky:// image URIs', () => {
    expect(isFetchableImageUri('pubky://abc/pub/paykit/blobs/avatar-1.jpg')).toBe(true);
    expect(isFetchableImageUri('https://example.com/a.jpg')).toBe(false);
    expect(isFetchableImageUri(undefined)).toBe(false);
  });
});
