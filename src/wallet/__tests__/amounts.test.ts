import {
  formatAssetAmount,
  formatUnits,
  fromPaykitDecimal,
  parseAssetAmount,
  parseTypedAmount,
  parseBaseUnits,
  parseUnits,
  toPaykitDecimal,
} from '../amounts';

describe('formatUnits', () => {
  it('formats base units with the asset decimals', () => {
    expect(formatUnits(123456n, 6)).toBe('0.123456');
    expect(formatUnits(1_000_000n, 6)).toBe('1');
    expect(formatUnits(0n, 8)).toBe('0');
    expect(formatUnits(42n, 0)).toBe('42');
  });

  it('is exact for values beyond Number.MAX_SAFE_INTEGER', () => {
    const wei = 123456789012345678901234567890n;
    expect(formatUnits(wei, 18)).toBe('123456789012.34567890123456789');
  });

  it('pads, truncates (rounding down) and groups', () => {
    expect(formatUnits(250_000_000n, 6, { minFractionDigits: 2 })).toBe('250.00');
    expect(formatUnits(1_999_999n, 6, { maxFractionDigits: 2 })).toBe('1.99');
    expect(formatUnits(1_234_567_890_000n, 6, { groupThousands: true })).toBe('1,234,567.89');
  });

  it('handles negatives and never prints -0', () => {
    expect(formatUnits(-1_500_000n, 6)).toBe('-1.5');
    expect(formatUnits(-1n, 6, { maxFractionDigits: 2 })).toBe('0');
  });
});

describe('parseUnits', () => {
  it('parses decimal text into base units', () => {
    expect(parseUnits('12', 6)).toEqual({ ok: true, value: 12_000_000n });
    expect(parseUnits('12.5', 6)).toEqual({ ok: true, value: 12_500_000n });
    expect(parseUnits('.5', 8)).toEqual({ ok: true, value: 50_000_000n });
    expect(parseUnits('1,234.56', 6)).toEqual({ ok: true, value: 1_234_560_000n });
    expect(parseUnits(' 0.00000001 ', 8)).toEqual({ ok: true, value: 1n });
  });

  it('rejects bad input', () => {
    expect(parseUnits('', 6)).toEqual({ ok: false, reason: 'empty' });
    expect(parseUnits('.', 6)).toEqual({ ok: false, reason: 'invalid' });
    expect(parseUnits('-1', 6)).toEqual({ ok: false, reason: 'invalid' });
    expect(parseUnits('1e5', 6)).toEqual({ ok: false, reason: 'invalid' });
    expect(parseUnits('1.2.3', 6)).toEqual({ ok: false, reason: 'invalid' });
    expect(parseUnits('0.0000001', 6)).toEqual({ ok: false, reason: 'too-many-decimals' });
  });

  it('round-trips with formatUnits', () => {
    for (const value of [0n, 1n, 999_999n, 10n ** 24n + 7n]) {
      const parsed = parseUnits(formatUnits(value, 18), 18);
      expect(parsed).toEqual({ ok: true, value });
    }
  });
});

describe('asset helpers', () => {
  it('formats each asset with its display rules', () => {
    expect(formatAssetAmount(421_000n, 'btc', { withSymbol: true })).toBe('0.00421 BTC');
    expect(formatAssetAmount(250_000_000n, 'usdt', { withSymbol: true })).toBe('250.00 USD₮');
    expect(formatAssetAmount(12_345_678n, 'usdt')).toBe('12.345678');
    expect(formatAssetAmount(18_123_456_789_000_000n, 'eth', { withSymbol: true })).toBe('0.018123 ETH');
    expect(formatAssetAmount(12_000_000n, 'usdt', { signed: true })).toBe('+12.00');
    expect(formatAssetAmount(-100_000n, 'btc')).toBe('−0.001');
  });

  it('parses per asset precision', () => {
    expect(parseAssetAmount('0.001', 'btc')).toEqual({ ok: true, value: 100_000n });
    expect(parseAssetAmount('0.123456789', 'btc')).toEqual({ ok: false, reason: 'too-many-decimals' });
  });

  it('converts at the Paykit decimal boundary', () => {
    expect(toPaykitDecimal(1_000n, 'btc')).toBe('0.00001');
    expect(toPaykitDecimal(5_000_000n, 'usdt')).toBe('5');
    expect(fromPaykitDecimal('0.00001', 'btc')).toEqual({ ok: true, value: 1_000n });
    expect(fromPaykitDecimal('1,000', 'usdt')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('parses WDK base-unit strings', () => {
    expect(parseBaseUnits('12345')).toBe(12345n);
    expect(parseBaseUnits('1.5')).toBeUndefined();
    expect(parseBaseUnits(null)).toBeUndefined();
  });
});

describe('parseTypedAmount', () => {
  it('reads a decimal comma from locale keypads', () => {
    expect(parseTypedAmount('0,5', 'usdt')).toEqual({ ok: true, value: 500_000n });
    expect(parseTypedAmount('12,50', 'usdt')).toEqual({ ok: true, value: 12_500_000n });
    expect(parseTypedAmount('0,500', 'usdt')).toEqual({ ok: true, value: 500_000n });
  });

  it('reads commas as grouping when the text says so', () => {
    expect(parseTypedAmount('1,000.50', 'usdt')).toEqual({ ok: true, value: 1_000_500_000n });
    expect(parseTypedAmount('1,000,000', 'usdt')).toEqual({ ok: true, value: 1_000_000_000_000n });
  });

  it('refuses "1,000", which could be one or a thousand', () => {
    expect(parseTypedAmount('1,000', 'usdt')).toEqual({ ok: false, reason: 'ambiguous' });
    expect(parseTypedAmount('12,345', 'btc')).toEqual({ ok: false, reason: 'ambiguous' });
  });
});
