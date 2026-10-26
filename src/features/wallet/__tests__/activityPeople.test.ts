// Putting a contact's name on an on-chain activity item.
import type { ActivityItem } from '../../../wallet';
import { activityPersonFor, type AddressBook } from '../activity/activityPeople';
import { activityTitleWithPerson } from '../activity/activityText';

const BEN = 'pubky5fpe1iozempar1row5gyyn51y4i1sir7r7eu9krab1x3i5oen1gy';
const BEN_BTC = 'tb1qzrav4ryngqgz8edew2y37976y9rvt2syvwuhgx';
const BEN_EVM = '0x83a881ddad0f675a3d57d306f3f4e6b352b95cd0';

const book: AddressBook = {
  accountOwner: (index) => (index === 1 ? BEN : undefined),
  addressOwner: (address) => (address.toLowerCase() === BEN_BTC || address.toLowerCase() === BEN_EVM ? BEN : undefined),
};

const base: ActivityItem = {
  id: 'x',
  chain: 'bitcoin',
  asset: 'btc',
  direction: 'in',
  amount: 1n,
  hash: 'h',
  status: 'confirmed',
  accountIndex: 0,
};

describe('activityPersonFor', () => {
  it('attributes a receive on a contact account to that contact', () => {
    expect(activityPersonFor({ ...base, accountIndex: 1 }, book)).toEqual({ publicKey: BEN, role: 'paid-you' });
    expect(activityPersonFor({ ...base, accountIndex: 1, direction: 'out' }, book)).toEqual({ publicKey: BEN, role: 'moved' });
    expect(activityPersonFor({ ...base, movedFromAccount: 1 }, book)).toEqual({ publicKey: BEN, role: 'moved' });
  });

  it('attributes a send to an address they shared with us', () => {
    expect(activityPersonFor({ ...base, direction: 'out', counterpartyAddress: BEN_BTC }, book)).toEqual({ publicKey: BEN, role: 'you-paid' });
  });

  it('attributes USD₮ from their address, in any letter case', () => {
    const usdt: ActivityItem = { ...base, chain: 'ethereum', asset: 'usdt', counterpartyAddress: '0x83A881Ddad0F675A3d57d306F3F4E6b352b95CD0' };
    expect(activityPersonFor(usdt, book)).toEqual({ publicKey: BEN, role: 'paid-you' });
  });

  it('leaves unknown addresses, account-0 BTC receives and faucet mints alone', () => {
    expect(activityPersonFor(base, book)).toBeUndefined();
    expect(activityPersonFor({ ...base, direction: 'out', counterpartyAddress: 'tb1qother' }, book)).toBeUndefined();
    const mint: ActivityItem = { ...base, chain: 'ethereum', asset: 'usdt', counterpartyAddress: '0x0000000000000000000000000000000000000000' };
    expect(activityPersonFor(mint, book)).toBeUndefined();
  });

  it('words it', () => {
    expect(activityTitleWithPerson(base, { role: 'paid-you', name: 'Ben' })).toBe('Ben paid you');
    expect(activityTitleWithPerson({ ...base, direction: 'out' }, { role: 'you-paid', name: 'Ben' })).toBe('You paid Ben');
    expect(activityTitleWithPerson({ ...base, movedFromAccount: 1 }, { role: 'moved', name: 'Ben' })).toBe('Moved to main account');
    expect(activityTitleWithPerson(base, undefined)).toBe('Received');
  });
});
