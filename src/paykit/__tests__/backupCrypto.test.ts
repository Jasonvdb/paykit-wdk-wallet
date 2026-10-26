import {
  BACKUP_PREFIX,
  BackupOpenError,
  asciiJson,
  backupKeyFrom,
  backupOpenMessage,
  buildEnvelope,
  looksLikeBackup,
  openBackup,
  readEnvelope,
  sealBackup,
} from '../backupCrypto';

const SECRET = new Uint8Array(32).fill(7);
const NONCE = new Uint8Array(24).fill(1);
const PUBKY = 'pubkyp18qc8hqqs7exqohndch3zmxnzcrh3bfspqaaii8bgq6h46ksa5o';

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof BackupOpenError ? error.reason : 'other';
  }
  return undefined;
}

describe('backupKeyFrom', () => {
  it('is HKDF-SHA256 with the app salt and info (checked against Node crypto.hkdfSync)', () => {
    const hex = Buffer.from(backupKeyFrom(SECRET)).toString('hex');
    expect(hex).toBe('52f015c78899da454a195f1f7d87c8463ab8b571efa848b56de6557c299169cd');
  });

  it('refuses a secret that is not 32 bytes', () => {
    expect(() => backupKeyFrom(new Uint8Array(16))).toThrow();
  });
});

describe('sealBackup / openBackup', () => {
  const key = backupKeyFrom(SECRET);

  it('round-trips and hides the plaintext', () => {
    const text = sealBackup('{"hello":"world"}', key, NONCE);
    expect(text.startsWith(BACKUP_PREFIX)).toBe(true);
    expect(text).not.toContain('hello');
    expect(openBackup(text, key)).toBe('{"hello":"world"}');
  });

  it('accepts pasted text with spaces and line breaks', () => {
    const text = sealBackup('abc', key, NONCE);
    const wrapped = `  ${text.slice(0, 40)}\n${text.slice(40)}  `;
    expect(looksLikeBackup(wrapped)).toBe(true);
    expect(openBackup(wrapped, key)).toBe('abc');
  });

  it('fails with the wrong key (another recovery phrase)', () => {
    const text = sealBackup('abc', key, NONCE);
    expect(reasonOf(() => openBackup(text, backupKeyFrom(new Uint8Array(32).fill(8))))).toBe('wrong-phrase');
  });

  it('fails when one character is changed', () => {
    const text = sealBackup('abc', key, NONCE);
    const last = text.slice(-1) === '0' ? '1' : '0';
    expect(reasonOf(() => openBackup(text.slice(0, -1) + last, key))).toBe('wrong-phrase');
  });

  it('says when the text is not a backup', () => {
    expect(reasonOf(() => openBackup('hello', key))).toBe('not-a-backup');
    expect(reasonOf(() => openBackup(`${BACKUP_PREFIX}zz`, key))).toBe('not-a-backup');
    expect(reasonOf(() => openBackup(`${BACKUP_PREFIX}00`, key))).toBe('not-a-backup');
  });

  it('refuses plaintext that is not ASCII, and asciiJson escapes it', () => {
    expect(() => sealBackup('é', key, NONCE)).toThrow();
    const json = asciiJson({ note: 'café ₮' });
    expect(/^[\x20-\x7e]*$/.test(json)).toBe(true);
    expect(JSON.parse(openBackup(sealBackup(json, key, NONCE), key))).toEqual({ note: 'café ₮' });
  });

  it('refuses a nonce of the wrong size', () => {
    expect(() => sealBackup('abc', key, new Uint8Array(12))).toThrow();
  });
});

describe('envelope', () => {
  const allowed = ['contact-btc-accounts-v1', 'payment-requests-v1'];

  it('keeps only the allowed app keys', () => {
    const envelope = buildEnvelope({
      createdAtMs: Date.parse('2026-10-26T18:00:00Z'),
      publicKey: PUBKY,
      paykit: 'abcd',
      app: { 'contact-btc-accounts-v1': '{}', 'something-else': 'x' },
    });
    const read = readEnvelope(JSON.stringify(envelope), PUBKY, allowed);
    expect(read.createdAt).toBe('2026-10-26T18:00:00.000Z');
    expect(read.app).toEqual({ 'contact-btc-accounts-v1': '{}' });
    expect(read.paykit).toBe('abcd');
  });

  it("refuses another identity's backup", () => {
    const envelope = buildEnvelope({ createdAtMs: 0, publicKey: PUBKY, paykit: 'ab', app: {} });
    expect(reasonOf(() => readEnvelope(JSON.stringify(envelope), 'pubkyother', allowed))).toBe('other-identity');
  });

  it('refuses something that is not an envelope', () => {
    expect(reasonOf(() => readEnvelope('not json', PUBKY, allowed))).toBe('unreadable');
    expect(reasonOf(() => readEnvelope('{"format":"x"}', PUBKY, allowed))).toBe('unreadable');
    const bad = { ...buildEnvelope({ createdAtMs: 0, publicKey: PUBKY, paykit: 'ab', app: {} }), paykit: 'not hex' };
    expect(reasonOf(() => readEnvelope(JSON.stringify(bad), PUBKY, allowed))).toBe('unreadable');
  });

  it('has words for every reason', () => {
    for (const reason of ['not-a-backup', 'wrong-phrase', 'other-identity', 'unreadable'] as const) {
      expect(backupOpenMessage(new BackupOpenError(reason))).toBeTruthy();
    }
    expect(backupOpenMessage(new Error('x'))).toBeUndefined();
  });
});
