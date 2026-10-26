// Building our payment request terms and reading anyone's.
import { ENDPOINT_BTC, ENDPOINT_USDT, PAYKIT_APP_ID } from '../../config/paykit';
import { btcReceivingDetail, usdtReceivingDetail } from '../endpoints';
import {
  REQUEST_MESSAGE_BUDGET_BYTES,
  buildRequestTerms,
  cleanNote,
  newPaymentReference,
  proposalMessageBytes,
  readRequestTerms,
  type PlainTerms,
  type RequestDraft,
} from '../requestTerms';

const BTC = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const EVM = '0x6620AFBA9Eb4ae3ca540cE715420FFEb70bA3B0A';
const NOW = Date.parse('2026-10-26T12:00:00.250Z');

const draft = (overrides: Partial<RequestDraft> = {}): RequestDraft => ({
  asset: 'btc',
  amount: 12_345n,
  note: 'Pizza',
  expiry: '1h',
  repeat: 'once',
  count: 3,
  receivingDetail: btcReceivingDetail(BTC),
  nowMs: NOW,
  ...overrides,
});

describe('buildRequestTerms', () => {
  it('builds a one-time Bitcoin request bound to our address', () => {
    const terms = buildRequestTerms(draft(), 'pkw-1');
    expect(terms).toEqual({
      amount: { value: '0.00012345', asset: 'btc' },
      paymentReference: 'pkw-1',
      proposalExpiresAt: '2026-10-26T13:00:00Z',
      recurrence: undefined,
      acceptedPaymentEndpointIdentifiers: [ENDPOINT_BTC],
      paymentEndpoints: { [ENDPOINT_BTC]: btcReceivingDetail(BTC).payload },
      requiredAppId: PAYKIT_APP_ID,
      metadata: { note: 'Pizza' },
    });
  });

  it('builds a counted recurring USD₮ request, expiring no later than its last period', () => {
    const terms = buildRequestTerms(draft({ asset: 'usdt', amount: 5_000_000n, repeat: '1m', count: 3, expiry: '1d', receivingDetail: usdtReceivingDetail(EVM) }), 'pkw-2');
    expect(terms.amount).toEqual({ value: '5', asset: 'usdt' });
    expect(terms.recurrence).toEqual({ every: 1, unit: 'minute', startsAt: '2026-10-26T12:00:00Z', anchor: '2026-10-26T12:00:00Z', endsAt: '2026-10-26T12:03:00Z' });
    expect(terms.proposalExpiresAt).toBe('2026-10-26T12:03:00Z');
    expect(terms.acceptedPaymentEndpointIdentifiers).toEqual([ENDPOINT_USDT]);
  });

  it('leaves out an empty note and refuses an address for another asset', () => {
    expect(buildRequestTerms(draft({ note: '   ' }), 'r').metadata).toEqual({});
    expect(() => buildRequestTerms(draft({ asset: 'usdt' }), 'r')).toThrow();
  });

  it('fits in one private message with the longest plain note, and measures multi-byte notes', () => {
    const recurringUsdt = (note: string) =>
      buildRequestTerms(draft({ asset: 'usdt', receivingDetail: usdtReceivingDetail(EVM), repeat: '5m', note }), newPaymentReference(NOW));
    expect(proposalMessageBytes(recurringUsdt('x'.repeat(200)))).toBeLessThanOrEqual(REQUEST_MESSAGE_BUDGET_BYTES);
    // 100 three-byte characters are too much: requestMoney refuses before the SDK would.
    expect(proposalMessageBytes(recurringUsdt('€'.repeat(200)))).toBeGreaterThan(REQUEST_MESSAGE_BUDGET_BYTES);
  });
});

it('cleans notes like names and caps them', () => {
  expect(cleanNote('  hi‮ there\u0007 ')).toBe('hi there');
  expect(cleanNote('x'.repeat(300))).toHaveLength(100);
  expect(cleanNote('')).toBeUndefined();
});

it('makes short references without control characters', () => {
  const reference = newPaymentReference(NOW, () => 0.5);
  expect(reference).toMatch(/^pkw-[0-9a-z]+$/);
  expect(reference.length).toBeLessThan(32);
});

describe('readRequestTerms', () => {
  const plain = (overrides: Partial<PlainTerms> = {}): PlainTerms => ({
    amountValue: '0.0001',
    amountAsset: 'btc',
    reference: 'pkw-1',
    proposalExpiresAt: '2026-10-26T13:00:00Z',
    acceptedIdentifiers: [ENDPOINT_BTC],
    paymentEndpoints: [[ENDPOINT_BTC, btcReceivingDetail(BTC).payload]],
    requiredAppId: PAYKIT_APP_ID,
    metadataJson: '{"note":"Pizza"}',
    ...overrides,
  });

  it('reads a payable request', () => {
    const view = readRequestTerms(plain());
    expect(view.asset).toBe('btc');
    expect(view.amount).toBe(10_000n);
    expect(view.note).toBe('Pizza');
    expect(view.endpoint?.address).toBe(BTC);
    expect(view.cannotPay).toBeUndefined();
    expect(view.expiresAtMs).toBe(Date.parse('2026-10-26T13:00:00Z'));
  });

  it('says why it cannot pay other assets, rails and addresses', () => {
    expect(readRequestTerms(plain({ amountAsset: 'eur', amountValue: '5' })).cannotPay).toMatch(/5 eur/);
    expect(readRequestTerms(plain({ amountValue: '1.123456789' })).cannotPay).toBeDefined();
    expect(readRequestTerms(plain({ acceptedIdentifiers: ['btc-lightning-bolt11'] })).cannotPay).toBeDefined();
    expect(readRequestTerms(plain({ paymentEndpoints: [[ENDPOINT_BTC, '{"value":"bc1qmainnet"}']] })).cannotPay).toBeDefined();
  });

  it('pays through the private list when the request binds no address', () => {
    const view = readRequestTerms(plain({ paymentEndpoints: undefined }));
    expect(view.cannotPay).toBeUndefined();
    expect(view.endpoint).toBeUndefined();
  });

  it('ignores unreadable metadata', () => {
    expect(readRequestTerms(plain({ metadataJson: 'nope' })).note).toBeUndefined();
    expect(readRequestTerms(plain({ metadataJson: '{"note":7}' })).note).toBeUndefined();
  });
});
