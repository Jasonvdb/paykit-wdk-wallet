import { btcReceivingDetail, usdtReceivingDetail } from '../endpoints';
import { acceptedAssets, cannotPayReason, publicPaymentOptionsFrom, type ResolvedEndpointData } from '../publicPaymentOptions';
import { ENDPOINT_BTC, ENDPOINT_USDT } from '../../config/paykit';

const BEN = 'pubky5fpe1iozempar1row5gyyn51y4i1sir7r7eu9krab1x3i5oen1gy';
const MALLORY = 'pubky8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo';
const BTC = 'tb1qx06yqnsvfwu36p0gz8ps7rfufeahnxl3m4c2v6';
const EVM = '0x83A881Ddad0F675A3d57d306F3F4E6b352b95CD0';

const btc = (counterparty = BEN, address = BTC): ResolvedEndpointData => ({
  counterparty,
  identifier: ENDPOINT_BTC,
  payloadText: btcReceivingDetail(address).payload,
});
const usdt = (counterparty = BEN, address = EVM): ResolvedEndpointData => ({
  counterparty,
  identifier: ENDPOINT_USDT,
  payloadText: usdtReceivingDetail(address).payload,
});

function options(endpoints: ResolvedEndpointData[], overrides: Partial<Parameters<typeof publicPaymentOptionsFrom>[0]> = {}) {
  return publicPaymentOptionsFrom({ publicKey: BEN, status: 'payable', hasPaymentApp: true, endpoints, failedApps: 0, ...overrides });
}

describe('publicPaymentOptionsFrom', () => {
  it('maps their endpoints to an address per asset', () => {
    const result = options([usdt(), btc()]);
    expect(result.addresses).toEqual({ btc: BTC, usdt: EVM });
    expect(acceptedAssets(result)).toEqual(['btc', 'usdt']);
  });

  it('ignores endpoints of another pubky', () => {
    expect(options([btc(MALLORY, 'tb1qmallory00000000000000000000000000000000')]).addresses).toEqual({});
  });

  it('ignores payloads that fail our checks, and calls the result unsupported', () => {
    const wrongToken: ResolvedEndpointData = {
      counterparty: BEN,
      identifier: ENDPOINT_USDT,
      payloadText: JSON.stringify({ value: EVM, chain_id: '11155111', token: '0x0000000000000000000000000000000000000001' }),
    };
    const mainnet = btc(BEN, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    const result = options([wrongToken, mainnet]);
    expect(result.addresses).toEqual({});
    expect(result.status).toBe('unsupported');
  });

  it('keeps the first valid endpoint per asset (the SDK sorts by preference)', () => {
    expect(options([btc(BEN, BTC), btc(BEN, 'tb1qsecond0000000000000000000000000000000')]).addresses.btc).toBe(BTC);
  });
});

describe('cannotPayReason', () => {
  it('is undefined when the asset is accepted', () => {
    expect(cannotPayReason(options([btc()]), 'btc', 'Ben')).toBeUndefined();
  });

  it('names the asset they do accept', () => {
    expect(cannotPayReason(options([btc()]), 'usdt', 'Ben')).toBe("Ben doesn't accept USD₮ by pubky. Choose Bitcoin instead.");
  });

  it('explains a pubky with no payment app', () => {
    const result = options([], { status: 'no-endpoint', hasPaymentApp: false });
    expect(cannotPayReason(result, 'btc', 'Ben')).toMatch(/hasn't set up a wallet that takes payments by pubky/);
  });

  it('explains an unreachable homeserver', () => {
    const result = options([], { status: 'unavailable', failedApps: 1 });
    expect(cannotPayReason(result, 'usdt', 'Ben')).toMatch(/Couldn't load Ben's payment details/);
  });

  it('explains someone who publishes nothing', () => {
    expect(cannotPayReason(options([], { status: 'no-endpoint' }), 'btc', 'Ben')).toMatch(/doesn't publish any payment addresses/);
  });
});
