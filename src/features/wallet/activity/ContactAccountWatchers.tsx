// Renders nothing: one watcher per contact Bitcoin account, so their
// history (contacts' private payments) is merged into Activity. See
// src/wallet/useContactAccountActivity.ts for why it takes a component per
// account. Mounted once, on the Wallet tab, which stays mounted.
import { useEffect } from 'react';

import { useContactAccounts } from '../../../paykit';
import { clearContactAccountActivity, useContactAccountWatcher } from '../../../wallet';

export function ContactAccountWatchers() {
  const accounts = useContactAccounts();
  useEffect(() => () => clearContactAccountActivity(), []);
  return (
    <>
      {accounts.map((account) => (
        <ContactAccountWatcher key={account.accountIndex} accountIndex={account.accountIndex} />
      ))}
    </>
  );
}

function ContactAccountWatcher({ accountIndex }: { accountIndex: number }) {
  useContactAccountWatcher(accountIndex);
  return null;
}
