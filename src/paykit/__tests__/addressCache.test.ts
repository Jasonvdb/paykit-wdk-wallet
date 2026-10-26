import { FIRST_CONTACT_BTC_ACCOUNT, ReceivingAddressCache, type StringStore } from '../addressCache';
import { ENDPOINT_BTC, ENDPOINT_USDT } from '../../config/paykit';

function memoryStore(): StringStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getString: (key) => data.get(key), set: (key, value) => void data.set(key, value) };
}

const ALICE = 'pubky8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo';
const BOB = 'pubkyufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy';
const EVM = '0x1111111111111111111111111111111111111111';
const BTC0 = 'tb1qpublicaddress0000000000000000000000000';

describe('ReceivingAddressCache', () => {
  it('publishes account 0 addresses publicly', () => {
    const cache = new ReceivingAddressCache(memoryStore());
    expect(cache.publicReceivingDetails()).toEqual([]);
    cache.setPublicAddresses({ btc: BTC0, evm: EVM });
    expect(cache.publicReceivingDetails().map((d) => d.identifier)).toEqual([ENDPOINT_USDT, ENDPOINT_BTC]);
    expect(JSON.parse(cache.publicReceivingDetails()[1]!.payload)).toEqual({ value: BTC0 });
  });

  it('publishes only the assets switched on, and remembers the choice', () => {
    const store = memoryStore();
    const cache = new ReceivingAddressCache(store);
    cache.setPublicAddresses({ btc: BTC0, evm: EVM });
    expect(cache.publicEndpointChoice()).toEqual({ btc: true, usdt: true });

    cache.setPublicEndpointChoice({ btc: true, usdt: false });
    expect(cache.publicReceivingDetails().map((d) => d.identifier)).toEqual([ENDPOINT_BTC]);
    cache.setPublicEndpointChoice({ btc: false, usdt: false });
    expect(cache.publicReceivingDetails()).toEqual([]);
    expect(cache.publicAddressesKnown()).toBe(true);

    const reloaded = new ReceivingAddressCache(store);
    expect(reloaded.publicEndpointChoice()).toEqual({ btc: false, usdt: false });
  });

  it('keeps private lists complete whatever is published publicly', () => {
    const cache = new ReceivingAddressCache(memoryStore());
    cache.setPublicAddresses({ btc: BTC0, evm: EVM });
    cache.setPublicEndpointChoice({ btc: false, usdt: false });
    cache.setBtcAddress(cache.ensureContactAccount(ALICE), 'tb1qalice000000000000000000000000000000000');
    expect(cache.privateReceivingDetails(ALICE)?.map((d) => d.identifier)).toEqual([ENDPOINT_USDT, ENDPOINT_BTC]);
  });

  it('falls back to publishing both when the stored choice is unreadable', () => {
    const store = memoryStore();
    store.set('public-endpoints-v1', '{not json');
    expect(new ReceivingAddressCache(store).publicEndpointChoice()).toEqual({ btc: true, usdt: true });
  });

  it('allocates stable, increasing BTC accounts per contact and persists them', () => {
    const store = memoryStore();
    const cache = new ReceivingAddressCache(store);
    expect(cache.ensureContactAccount(ALICE)).toBe(FIRST_CONTACT_BTC_ACCOUNT);
    expect(cache.ensureContactAccount(BOB)).toBe(FIRST_CONTACT_BTC_ACCOUNT + 1);
    expect(cache.ensureContactAccount(ALICE)).toBe(FIRST_CONTACT_BTC_ACCOUNT);

    // A new cache over the same store (an app restart) sees the same map.
    const reloaded = new ReceivingAddressCache(store);
    expect(reloaded.contactAccountIndex(ALICE)).toBe(1);
    expect(reloaded.contactAccountIndex(BOB)).toBe(2);
    expect(reloaded.ensureContactAccount('pubkysomeoneelse')).toBe(3);
  });

  it('never reuses an index, even if the stored counter is behind', () => {
    const store = memoryStore();
    store.set('contact-btc-accounts-v1', JSON.stringify({ next: 1, accounts: { [ALICE]: 4 } }));
    const cache = new ReceivingAddressCache(store);
    expect(cache.ensureContactAccount(BOB)).toBe(5);
  });

  it('refuses to start over when the stored map is corrupt', () => {
    const store = memoryStore();
    store.set('contact-btc-accounts-v1', '{not json');
    expect(() => new ReceivingAddressCache(store)).toThrow();
  });

  it('shares the contact BTC address and the shared USD₮ address privately', () => {
    const cache = new ReceivingAddressCache(memoryStore());
    cache.setPublicAddresses({ btc: BTC0, evm: EVM });
    const index = cache.ensureContactAccount(ALICE);
    cache.setBtcAddress(index, 'tb1qalice');
    const details = cache.privateReceivingDetails(ALICE) ?? [];
    expect(details.map((d) => d.identifier)).toEqual([ENDPOINT_USDT, ENDPOINT_BTC]);
    expect(JSON.parse(details[1]!.payload)).toEqual({ value: 'tb1qalice' });
    expect(cache.contactForBtcAddress('tb1qalice')).toBe(ALICE);
  });

  it('never returns a partial private list', () => {
    const cache = new ReceivingAddressCache(memoryStore());
    const index = cache.ensureContactAccount(ALICE);
    cache.setBtcAddress(index, 'tb1qalice');
    // No EVM address yet: a BTC-only list would drop USD₮ for Alice.
    expect(cache.privateReceivingDetails(ALICE)).toBeUndefined();
    cache.setPublicAddresses({ btc: BTC0, evm: EVM });
    expect(cache.privateReceivingDetails(ALICE)).toHaveLength(2);
  });

  it('reports a missing contact address asynchronously instead of blocking', async () => {
    const cache = new ReceivingAddressCache(memoryStore());
    cache.setPublicAddresses({ btc: BTC0, evm: EVM });
    const missing: [string, number][] = [];
    cache.onMissingContactAddress((pubky, index) => missing.push([pubky, index]));
    // No BTC address for Bob yet: a USD₮-only list would drop BTC for him.
    expect(cache.privateReceivingDetails(BOB)).toBeUndefined();
    expect(missing).toEqual([]); // not inside the (synchronous) adapter call
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(missing).toEqual([[BOB, 1]]);
  });
});
