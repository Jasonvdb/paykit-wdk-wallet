import { readRestoreReview, RESTORE_REVIEW_KEY, resumeAfterRestore, subscribeRestoreReview, writeRestoreReview } from '../restoreReview';

function memoryStore() {
  const values = new Map<string, string>();
  return { getString: (key: string) => values.get(key), set: (key: string, value: string) => void values.set(key, value) };
}

describe('restore review', () => {
  it('is absent until a restore writes one', () => {
    expect(readRestoreReview(memoryStore())).toBeUndefined();
  });

  it('round-trips and resumes, keeping the restored requests paid by hand', () => {
    const store = memoryStore();
    const seen: number[] = [];
    const unsubscribe = subscribeRestoreReview(() => seen.push(1));
    writeRestoreReview(store, { restoredAtMs: 2, backupCreatedAtMs: 1, requestKeys: ['ben|r1'], paused: true });
    expect(readRestoreReview(store)).toEqual({ restoredAtMs: 2, backupCreatedAtMs: 1, requestKeys: ['ben|r1'], paused: true });
    resumeAfterRestore(store);
    expect(readRestoreReview(store)).toMatchObject({ paused: false, requestKeys: ['ben|r1'] });
    expect(seen).toHaveLength(2);
    unsubscribe();
  });

  it('stays paused when the paused flag is unreadable', () => {
    const store = memoryStore();
    store.set(RESTORE_REVIEW_KEY, JSON.stringify({ restoredAtMs: 2, requestKeys: [7, 'ben|r1'], paused: 'no' }));
    expect(readRestoreReview(store)).toEqual({ restoredAtMs: 2, backupCreatedAtMs: undefined, requestKeys: ['ben|r1'], paused: true });
  });

  it('ignores a damaged record', () => {
    const store = memoryStore();
    store.set(RESTORE_REVIEW_KEY, '{not json');
    expect(readRestoreReview(store)).toBeUndefined();
  });
});
