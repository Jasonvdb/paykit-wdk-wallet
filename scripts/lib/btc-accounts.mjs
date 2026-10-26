// BTC contact accounts (index 1, 2, ...) of a demo wallet: m/84'/1'/0'/0/i,
// the same path WDK's getAccount(i) uses on testnet. Public addresses only.
import { HDNodeWallet } from 'ethers';

import { p2wpkhTestnetAddress, readDemoEnv } from './demo-wallets.mjs';

export function btcAddressForAccount(walletName, accountIndex) {
  const key = `${walletName.toUpperCase()}_MNEMONIC`;
  const phrase = readDemoEnv()[key];
  if (!phrase) throw new Error(`${key} is not set in .env.demo`);
  const node = HDNodeWallet.fromPhrase(phrase, '', `m/84'/1'/0'/0/${accountIndex}`);
  return p2wpkhTestnetAddress(node.publicKey);
}
