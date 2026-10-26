import {
  allowanceCovers,
  allowanceTermsWords,
  allowanceUsage,
  allowanceUsageWords,
  automaticBlockWords,
  buildAllowanceTerms,
  readAllowanceTerms,
  type PlainAllowanceTerms,
} from '../allowanceTerms';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const date = (ms: number) => new Date(ms).toISOString();

describe('buildAllowanceTerms', () => {
  it('builds the conservative demo terms for USD₮', () => {
    const terms = buildAllowanceTerms({ asset: 'usdt', perPayment: 5_000_000n, duration: 'day', nowMs: NOW + 123 });
    expect(terms).toEqual({
      asset: 'usdt',
      perPayment: { minimum: '0', maximum: '5' },
      periodLimits: [{ amountLimit: '20', paymentCountLimit: 10, period: { kind: 'rolling', every: 1, unit: 'hour' } }],
      lifetimeAmountLimit: '50',
      activeFrom: undefined,
      expiresAt: '2026-10-27T12:00:00Z',
      allowedEndpointIdentifiers: ['usdt-sepolia-address'],
    });
  });

  it('uses Bitcoin decimals and the Bitcoin method', () => {
    const terms = buildAllowanceTerms({ asset: 'btc', perPayment: 5_000n, duration: 'hour', nowMs: NOW });
    expect(terms.perPayment?.maximum).toBe('0.00005');
    expect(terms.lifetimeAmountLimit).toBe('0.0005');
    expect(terms.expiresAt).toBe('2026-10-26T13:00:00Z');
    expect(terms.allowedEndpointIdentifiers).toEqual(['btc-mutinynet-p2wpkh']);
  });

  it('refuses zero', () => {
    expect(() => buildAllowanceTerms({ asset: 'btc', perPayment: 0n, duration: 'hour', nowMs: NOW })).toThrow();
  });
});

describe('readAllowanceTerms and words', () => {
  const plain = buildAllowanceTerms({ asset: 'usdt', perPayment: 5_000_000n, duration: 'day', nowMs: NOW });
  const view = readAllowanceTerms(plain);

  it('reads amounts into base units', () => {
    expect(view.asset).toBe('usdt');
    expect(view.perPaymentMax).toBe(5_000_000n);
    expect(view.periods[0]).toMatchObject({ amount: 20_000_000n, count: 10, rolling: true, lengthMs: 3_600_000 });
    expect(view.lifetime).toBe(50_000_000n);
    expect(view.expiresAtMs).toBe(NOW + 86_400_000);
  });

  it('words the limits as sentences', () => {
    expect(allowanceTermsWords(view, date)).toBe(
      'Up to 5.00 USD₮ a payment. At most 10 payments and 20.00 USD₮ an hour. 50.00 USD₮ in all. Until 2026-10-27T12:00:00.000Z.',
    );
  });

  it("doesn't pretend to read an asset it doesn't hold", () => {
    const other: PlainAllowanceTerms = { ...plain, asset: 'eur' };
    const read = readAllowanceTerms(other);
    expect(read.asset).toBeUndefined();
    expect(allowanceTermsWords(read, date)).toBe("Limits in eur, which this wallet doesn't hold.");
  });

  it('treats an amount it cannot parse as unreadable', () => {
    expect(readAllowanceTerms({ ...plain, lifetimeAmountLimit: '1.0000001' }).asset).toBeUndefined();
  });
});

describe('allowanceCovers', () => {
  const view = readAllowanceTerms(buildAllowanceTerms({ asset: 'usdt', perPayment: 5_000_000n, duration: 'day', nowMs: NOW }));

  it('covers a request in the same asset up to the per-payment limit', () => {
    expect(allowanceCovers(view, { asset: 'usdt', amount: 5_000_000n }, NOW)).toBe(true);
    expect(allowanceCovers(view, { asset: 'usdt', amount: 1n }, NOW)).toBe(true);
  });

  it('does not cover more, another asset, an unpayable request or after expiry', () => {
    expect(allowanceCovers(view, { asset: 'usdt', amount: 5_000_001n }, NOW)).toBe(false);
    expect(allowanceCovers(view, { asset: 'btc', amount: 1n }, NOW)).toBe(false);
    expect(allowanceCovers(view, { asset: 'usdt', amount: 1n, cannotPay: 'no' }, NOW)).toBe(false);
    expect(allowanceCovers(view, { asset: 'usdt', amount: 1n }, NOW + 86_400_000)).toBe(false);
  });

  it('respects the allowed payment methods', () => {
    expect(allowanceCovers({ ...view, endpoints: ['btc-mutinynet-p2wpkh'] }, { asset: 'usdt', amount: 1n }, NOW)).toBe(false);
  });
});

describe('allowanceUsage', () => {
  const view = readAllowanceTerms(buildAllowanceTerms({ asset: 'usdt', perPayment: 5_000_000n, duration: 'day', nowMs: NOW }));
  const entries = [
    { amount: 1_000_000n, admittedAtMs: NOW - 3_600_000 }, // exactly one hour ago: has left the rolling hour
    { amount: 2_000_000n, admittedAtMs: NOW - 60_000 },
    { amount: 3_000_000n, admittedAtMs: NOW },
  ];

  it('counts a rolling hour as (now - 1 h, now]', () => {
    const usage = allowanceUsage(view, entries, NOW);
    expect(usage.payments).toBe(3);
    expect(usage.total).toBe(6_000_000n);
    expect(usage.periods[0]).toEqual({ payments: 2, total: 5_000_000n });
    expect(allowanceUsageWords(view, usage)).toBe('2 of 10 payments and 5.00 USD₮ of 20.00 USD₮ in the last hour. 6.00 USD₮ of 50.00 USD₮ used in all.');
  });

  it('counts an anchored period from its anchor', () => {
    const anchored = { ...view, periods: [{ ...view.periods[0]!, rolling: false, anchorMs: Date.parse('2026-10-26T00:00:00Z') }] };
    const usage = allowanceUsage(anchored, entries, NOW);
    // 11:00 belongs to the previous anchored hour; 11:59 and 12:00 are split.
    expect(usage.periods[0]).toEqual({ payments: 1, total: 3_000_000n });
  });
});

describe('automaticBlockWords', () => {
  it('words the SDK reasons', () => {
    expect(automaticBlockWords('SharedRule', 'period_count_limit')).toMatch(/hourly limit/);
    expect(automaticBlockWords('SharedRule', 'lifetime_amount_limit')).toMatch(/total/);
    expect(automaticBlockWords('ManualOnly')).toMatch(/yourself/);
    expect(automaticBlockWords('Something')).toBeTruthy();
  });
});
