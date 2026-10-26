// When to share our Private Payment List, and how lists from contacts are
// read: never a partial list, again after the link changes, and only
// payloads our own parser accepts.
import { ENDPOINT_BTC, ENDPOINT_USDT } from '../../config/paykit';
import { btcReceivingDetail, usdtReceivingDetail } from '../endpoints';
import {
  PrivateListStore,
  addressKey,
  assetsOf,
  fitsInPrivateMessage,
  planPrivateListShares,
  privateAddressesFrom,
  shareKeyFor,
  type LinkGeneration,
} from '../privatePaymentLists';

const ANA = 'pubkyp18qc8hqqs7exqohndch3zmxnzcrh3bfspqaaii8bgq6h46ksa5o';
const BEN = 'pubky5fpe1iozempar1row5gyyn51y4i1sir7r7eu9krab1x3i5oen1gy';
const CAT = 'pubky8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo';
const EVM = '0x00000000000000000000000000000000000000aA';
const BTC = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

type Input = { reservationId: string; identifier: string; payload: string };

function inputs(btc = BTC): Input[] {
  return [
    { reservationId: `${ENDPOINT_USDT}:0`, ...usdtReceivingDetail(EVM) },
    { reservationId: `${ENDPOINT_BTC}:1`, ...btcReceivingDetail(btc) },
  ];
}

const linked = (counterparty: string, local = 'a1', remote = 'b1'): LinkGeneration => ({
  counterparty,
  linked: true,
  localAttemptId: local,
  remoteAttemptId: remote,
});

describe('planPrivateListShares', () => {
  it('shares with linked contacts only', () => {
    const plan = planPrivateListShares({
      contacts: new Set([BEN, CAT]),
      links: [linked(BEN), { counterparty: CAT, linked: false }, linked(ANA)],
      inputsFor: () => inputs(),
      sharedKeys: new Map(),
    });
    expect(plan.share.map((s) => s.counterparty)).toEqual([BEN]);
    expect(plan.waiting).toEqual([]);
  });

  it('waits instead of sending a partial or empty list', () => {
    const plan = planPrivateListShares({
      contacts: new Set([BEN, CAT]),
      links: [linked(BEN), linked(CAT)],
      inputsFor: (peer) => (peer === BEN ? undefined : []),
      sharedKeys: new Map(),
    });
    expect(plan.share).toEqual([]);
    expect(plan.waiting).toEqual([BEN, CAT]);
  });

  it('does not share an unchanged list again on the same link', () => {
    const key = shareKeyFor(linked(BEN), inputs());
    const plan = planPrivateListShares({
      contacts: new Set([BEN]),
      links: [linked(BEN)],
      inputsFor: () => inputs(),
      sharedKeys: new Map([[BEN, key]]),
    });
    expect(plan.share).toEqual([]);
  });

  it('shares again when the list or the link generation changes', () => {
    const key = shareKeyFor(linked(BEN), inputs());
    const newAddress = planPrivateListShares({
      contacts: new Set([BEN]),
      links: [linked(BEN)],
      inputsFor: () => inputs('tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7'),
      sharedKeys: new Map([[BEN, key]]),
    });
    expect(newAddress.share.map((s) => s.counterparty)).toEqual([BEN]);

    const relinked = planPrivateListShares({
      contacts: new Set([BEN]),
      links: [linked(BEN, 'a2', 'b2')],
      inputsFor: () => inputs(),
      sharedKeys: new Map([[BEN, key]]),
    });
    expect(relinked.share.map((s) => s.counterparty)).toEqual([BEN]);
  });

  it('reports peers we shared with that are no longer linked contacts', () => {
    const plan = planPrivateListShares({
      contacts: new Set([CAT]),
      links: [{ counterparty: BEN, linked: false }],
      inputsFor: () => inputs(),
      sharedKeys: new Map([[BEN, 'old']]),
    });
    expect(plan.stale).toEqual([BEN]);
  });

  it('refuses a list that would not fit in one private message', () => {
    const huge = inputs().map((input) => ({ ...input, payload: input.payload + ' '.repeat(600) }));
    expect(fitsInPrivateMessage(inputs())).toBe(true);
    expect(fitsInPrivateMessage(huge)).toBe(false);
    const plan = planPrivateListShares({ contacts: new Set([BEN]), links: [linked(BEN)], inputsFor: () => huge, sharedKeys: new Map() });
    expect(plan.tooLarge).toEqual([BEN]);
    expect(plan.share).toEqual([]);
  });
});

describe('privateAddressesFrom', () => {
  it('keeps the first valid address per asset and drops what we cannot pay', () => {
    const addresses = privateAddressesFrom([
      { identifier: ENDPOINT_BTC, payloadText: '{"value":"bc1qmainnetaddress"}' },
      { identifier: ENDPOINT_BTC, payloadText: btcReceivingDetail(BTC).payload },
      { identifier: ENDPOINT_USDT, payloadText: JSON.stringify({ value: EVM, chain_id: '1', token: EVM }) },
      { identifier: 'btc-lightning-bolt11', payloadText: '{"value":"lnbc1"}' },
    ]);
    expect(addresses).toEqual({ btc: BTC });
    expect(assetsOf(addresses)).toEqual(['btc']);
    expect(assetsOf(privateAddressesFrom(inputs().map((i) => ({ identifier: i.identifier, payloadText: i.payload }))))).toEqual(['btc', 'usdt']);
  });
});

describe('PrivateListStore', () => {
  it('maps shared addresses to their owner, ignoring EVM case', () => {
    const store = new PrivateListStore();
    let changes = 0;
    store.subscribe(() => (changes += 1));
    store.setIncoming(BEN, { addresses: { btc: BTC, usdt: EVM }, loadedAt: 1 });
    expect(store.addressOwners().get(addressKey(EVM.toUpperCase().replace('0X', '0x')))).toBe(BEN);
    expect(store.addressOwners().get(BTC)).toBe(BEN);
    expect(store.summary()).toEqual({ sharedWith: 0, receivedFrom: 1 });

    store.setOutgoing(BEN, { state: 'shared', at: 2, assets: ['btc', 'usdt'] }, 'key');
    expect(store.sharedKeys().get(BEN)).toBe('key');
    expect(store.summary()).toEqual({ sharedWith: 1, receivedFrom: 1 });

    store.setOutgoing(BEN, { state: 'failed', at: 3 });
    expect(store.sharedKeys().has(BEN)).toBe(false);

    store.setOutgoing(CAT, { state: 'waiting-for-address' });
    expect(store.isWaitingForAddresses()).toBe(true);

    store.forget(BEN);
    expect(store.addressOwners().size).toBe(0);
    expect(changes).toBeGreaterThanOrEqual(5);
  });

  it('names nobody on an address two contacts both claim', () => {
    const store = new PrivateListStore();
    store.setIncoming(BEN, { addresses: { btc: BTC, usdt: EVM }, loadedAt: 1 });
    store.setIncoming(CAT, { addresses: { usdt: EVM.toUpperCase().replace('0X', '0x') }, loadedAt: 2 });
    expect(store.addressOwners().has(addressKey(EVM))).toBe(false);
    expect(store.addressOwners().get(BTC)).toBe(BEN);
  });
});
