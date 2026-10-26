// Feeds ./activityPeople.ts from Paykit: the contact -> Bitcoin account map,
// the addresses contacts shared with us privately, and the transactions
// that paid payment requests.
import { useCallback } from 'react';

import { addressKey, useContactAccounts, usePrivateAddressOwners, useRequestLinks } from '../../../paykit';
import type { ActivityItem } from '../../../wallet';
import { activityPersonFor, type ActivityPerson } from './activityPeople';

/** A function that says which contact an activity item involves, if any. */
export function useActivityPeople(): (item: ActivityItem) => ActivityPerson | undefined {
  const accounts = useContactAccounts();
  const owners = usePrivateAddressOwners();
  const requestLinks = useRequestLinks();
  return useCallback(
    (item: ActivityItem) =>
      activityPersonFor(item, {
        accountOwner: (index) => accounts.find((a) => a.accountIndex === index)?.pubky,
        addressOwner: (address) => owners.get(addressKey(address)),
        requestCounterparty: (hash) => {
          const link = requestLinks.get(hash.toLowerCase());
          return link ? { publicKey: link.counterparty, role: link.role } : undefined;
        },
      }),
    [accounts, owners, requestLinks],
  );
}
