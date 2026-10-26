// Feeds ./activityPeople.ts from Paykit: the contact -> Bitcoin account map
// and the addresses contacts shared with us privately.
import { useCallback } from 'react';

import { addressKey, useContactAccounts, usePrivateAddressOwners } from '../../../paykit';
import type { ActivityItem } from '../../../wallet';
import { activityPersonFor, type ActivityPerson } from './activityPeople';

/** A function that says which contact an activity item involves, if any. */
export function useActivityPeople(): (item: ActivityItem) => ActivityPerson | undefined {
  const accounts = useContactAccounts();
  const owners = usePrivateAddressOwners();
  return useCallback(
    (item: ActivityItem) =>
      activityPersonFor(item, {
        accountOwner: (index) => accounts.find((a) => a.accountIndex === index)?.pubky,
        addressOwner: (address) => owners.get(addressKey(address)),
      }),
    [accounts, owners],
  );
}
