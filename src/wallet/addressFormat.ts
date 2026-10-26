// Cheap format checks for addresses typed or pasted by a user.
//
// These catch typos and the wrong network before WDK builds a transaction.
// They are not full validation: WDK and the chain still reject anything
// malformed. Mainnet formats (bc1..., 1..., 3...) are rejected on purpose,
// because this wallet only ever pays testnet addresses.
import type { Chain } from './assets';

/** Mutinynet uses testnet bech32 addresses: tb1q... (P2WPKH) or tb1p... (P2TR). */
const TESTNET_BECH32 = /^tb1[02-9ac-hj-np-z]{8,87}$/;

/** An EVM address: 0x followed by 40 hex characters (checksum case is not checked). */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function isBtcTestnetAddress(text: string): boolean {
  return TESTNET_BECH32.test(text.trim().toLowerCase());
}

export function isEvmAddress(text: string): boolean {
  return EVM_ADDRESS.test(text.trim());
}

export function isAddressForChain(text: string, chain: Chain): boolean {
  return chain === 'bitcoin' ? isBtcTestnetAddress(text) : isEvmAddress(text);
}

/** Which chain an address belongs to, if it looks like one of ours. */
export function chainOfAddress(text: string): Chain | undefined {
  if (isBtcTestnetAddress(text)) return 'bitcoin';
  if (isEvmAddress(text)) return 'ethereum';
  return undefined;
}

export function sameEvmAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
