// Which contact an on-chain activity item involves, if any.
//
// A blockchain transaction has addresses, not people. Paykit is what lets
// this wallet put a name on one, because every private address is tied to
// one contact:
//
//   our side    each contact pays us at their own Bitcoin account (1, 2, …),
//               so a receive on account k is from the contact who owns k;
//               a send from account k is a Collect back to account 0.
//   their side  the addresses a contact shared with us in their Private
//               Payment List: a send to one is "You paid Ben", a USD₮
//               transfer from one is "Ben paid you".
//
// Bitcoin receives on account 0 carry no sender address, so they stay
// "Received". Pure; unit tested. The hook that feeds it is
// ./useActivityPeople.ts.
import type { ActivityItem } from '../../../wallet';
import { isFaucetMint } from './activityText';

export type ActivityPersonRole = 'paid-you' | 'you-paid' | 'moved';

export type ActivityPerson = { publicKey: string; role: ActivityPersonRole };

export type AddressBook = {
  /** The contact whose Bitcoin account this is. */
  accountOwner: (accountIndex: number) => string | undefined;
  /** The contact who shared this address privately (any case). */
  addressOwner: (address: string) => string | undefined;
};

export function activityPersonFor(item: ActivityItem, book: AddressBook): ActivityPerson | undefined {
  if (item.movedFromAccount !== undefined) {
    const owner = book.accountOwner(item.movedFromAccount);
    return owner ? { publicKey: owner, role: 'moved' } : undefined;
  }
  if (item.accountIndex > 0) {
    const owner = book.accountOwner(item.accountIndex);
    if (!owner) return undefined;
    return { publicKey: owner, role: item.direction === 'in' ? 'paid-you' : 'moved' };
  }
  if (isFaucetMint(item) || !item.counterpartyAddress) return undefined;
  const owner = book.addressOwner(item.counterpartyAddress);
  if (!owner) return undefined;
  return { publicKey: owner, role: item.direction === 'in' ? 'paid-you' : 'you-paid' };
}
