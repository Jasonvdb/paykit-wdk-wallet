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

// Checking what someone typed into the Send screen's "To" field ----------------

export type RecipientCheck =
  | { ok: true; address: string }
  | { ok: false; reason: 'empty' | 'mainnet' | 'wrong-chain' | 'pubky' | 'unsupported' | 'invalid'; message: string };

/** Mainnet Bitcoin: bech32 bc1…, or base58 P2PKH (1…) and P2SH (3…). */
const BTC_MAINNET = /^(bc1[02-9ac-hj-np-z]{8,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/i;
/** Testnet base58 (m…, n…, 2…) and regtest bech32 (bcrt1…): valid Bitcoin, but not what this wallet pays. */
const BTC_OTHER_TESTNET = /^([mn2][1-9A-HJ-NP-Za-km-z]{25,34}|bcrt1[02-9ac-hj-np-z]{8,87})$/i;
/** A Pubky key: "pubky" + 52 z-base32 characters, or the bare 52 characters. */
const PUBKY_KEY = /^(pubky)?[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/;

/**
 * Strip a payment URI down to the address: "bitcoin:tb1…?amount=1" (BIP-21)
 * and "ethereum:0x…@11155111" (EIP-681) are common in pasted text and QRs.
 */
export function addressFromPaymentText(text: string): string {
  const trimmed = text.trim();
  const uri = /^(bitcoin|ethereum):([^?@/]+)/i.exec(trimmed);
  return uri ? uri[2] : trimmed;
}

/**
 * Is `text` an address this wallet can pay on `chain`? The message follows
 * docs/DESIGN.md: it says what is wrong and what to do. Mainnet addresses
 * are refused on purpose: this wallet only moves testnet coins.
 *
 * EVM addresses look the same on every EVM chain, so "mainnet" cannot be
 * detected there; WDK sends on Sepolia whatever the address.
 */
export function checkRecipientAddress(text: string, chain: Chain): RecipientCheck {
  const address = addressFromPaymentText(text);
  if (address === '') return { ok: false, reason: 'empty', message: 'Enter an address.' };

  if (PUBKY_KEY.test(address.toLowerCase())) {
    return { ok: false, reason: 'pubky', message: 'That is a Pubky key, not an address. Paste a wallet address.' };
  }

  if (chain === 'bitcoin') {
    if (isBtcTestnetAddress(address)) return { ok: true, address: address.toLowerCase() };
    if (isEvmAddress(address)) {
      return { ok: false, reason: 'wrong-chain', message: 'That is an Ethereum address. Choose USD₮ to send to it.' };
    }
    if (BTC_MAINNET.test(address)) {
      return { ok: false, reason: 'mainnet', message: 'That is a mainnet Bitcoin address. This wallet only sends test bitcoin (tb1…).' };
    }
    if (BTC_OTHER_TESTNET.test(address)) {
      return { ok: false, reason: 'unsupported', message: 'This wallet sends to tb1… addresses only. Ask for a tb1… address.' };
    }
    return { ok: false, reason: 'invalid', message: 'That is not a Bitcoin testnet address. It should start with tb1.' };
  }

  if (isEvmAddress(address)) return { ok: true, address };
  if (isBtcTestnetAddress(address) || BTC_MAINNET.test(address) || BTC_OTHER_TESTNET.test(address)) {
    return { ok: false, reason: 'wrong-chain', message: 'That is a Bitcoin address. Choose Bitcoin to send to it.' };
  }
  return { ok: false, reason: 'invalid', message: 'That is not an Ethereum address. It should be 0x and 40 characters.' };
}
