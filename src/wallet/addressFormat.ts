// Cheap format checks for addresses typed or pasted by a user.
//
// These catch typos and the wrong network before WDK builds a transaction.
// They are not full validation: WDK and the chain still reject anything
// malformed. Mainnet formats (bc1..., 1..., 3...) are rejected on purpose,
// because this wallet only ever pays testnet addresses.
//
// Payment URIs (BIP-21 "bitcoin:", EIP-681 "ethereum:") are read here, once,
// for every way an address gets in: typed or pasted into Send, a
// paykitwdk://send?to=… link, or a scanned QR code
// (src/features/people/scan/parseScannedCode.ts). An EIP-681 token transfer
// names the token contract first and the payee in `address=`; paying the
// first address would send the tokens to the contract, where they are lost.
import { AAVE_SEPOLIA_FAUCET, SEPOLIA_CHAIN_ID, SEPOLIA_USDT } from '../config/chains';
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

// Payment URIs -------------------------------------------------------------------

/** Query parameters of `a=1&b=2`, decoded. Repeated keys keep the first value; malformed ones are skipped. */
export function parseQueryParams(query: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const part of query.split('&')) {
    const [rawKey, ...rest] = part.split('=');
    if (!rawKey) continue;
    try {
      const key = decodeURIComponent(rawKey);
      if (!params.has(key)) params.set(key, decodeURIComponent(rest.join('=')));
    } catch {
      // Malformed percent-encoding: skip the parameter.
    }
  }
  return params;
}

/**
 * Contracts this wallet talks to. They hold no one's money: tokens sent to
 * them are lost, so they are never accepted as a recipient.
 */
const KNOWN_CONTRACTS = [SEPOLIA_USDT, AAVE_SEPOLIA_FAUCET];

export function isKnownContract(address: string): boolean {
  return KNOWN_CONTRACTS.some((contract) => sameEvmAddress(contract, address));
}

export type PayeeResult = { ok: true; address: string } | { ok: false; message: string };

/**
 * The payee of an EIP-681 URI (the text after "ethereum:"):
 *   0x…[@11155111]                                   pay that address
 *   <USD₮ token>[@11155111]/transfer?address=0x…     pay `address=`, never the token
 * Other chain ids and other functions (approve, other tokens) are refused.
 * Amounts are ignored: the person types the amount and reviews the fee.
 */
export function payeeOfEthereumUri(rest: string): PayeeResult {
  // ethereum:[pay-]<target>[@chainId][/function][?params]
  const match = /^(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:\/([A-Za-z]+))?(?:\?(.*))?$/.exec(rest.trim());
  if (!match) return { ok: false, message: 'That Ethereum code is not an address this wallet can pay.' };
  const [, target = '', chainId, fn, query = ''] = match;
  if (chainId !== undefined && chainId !== String(SEPOLIA_CHAIN_ID)) {
    return { ok: false, message: 'That code is for another Ethereum network. This wallet pays on Sepolia only.' };
  }
  if (fn === undefined) return { ok: true, address: target };
  if (fn !== 'transfer' || !sameEvmAddress(target, SEPOLIA_USDT)) {
    return { ok: false, message: 'That code asks for a token this wallet does not hold. It pays test USD₮ only.' };
  }
  const payee = parseQueryParams(query).get('address') ?? '';
  return isEvmAddress(payee) ? { ok: true, address: payee } : { ok: false, message: 'That USD₮ request has no address to pay.' };
}

/**
 * The payee in pasted or scanned payment text: "bitcoin:tb1…?amount=1"
 * (BIP-21) gives the address, "ethereum:…" (EIP-681) goes through
 * payeeOfEthereumUri, and anything else is returned trimmed for the
 * address checks to judge.
 */
export function payeeOfPaymentText(text: string): PayeeResult {
  const trimmed = text.trim();
  const ethereum = /^ethereum:([\s\S]*)$/i.exec(trimmed);
  if (ethereum) return payeeOfEthereumUri(ethereum[1] ?? '');
  const bitcoin = /^bitcoin:([^?]*)/i.exec(trimmed);
  return { ok: true, address: bitcoin ? (bitcoin[1] ?? '') : trimmed };
}

/** The payee address in payment text, or the text itself if it names none (see payeeOfPaymentText). */
export function addressFromPaymentText(text: string): string {
  const payee = payeeOfPaymentText(text);
  return payee.ok ? payee.address : text.trim();
}

// Checking what someone typed into the Send screen's "To" field ----------------

export type RecipientCheck =
  | { ok: true; address: string }
  | { ok: false; reason: 'empty' | 'mainnet' | 'wrong-chain' | 'pubky' | 'unsupported' | 'contract' | 'invalid'; message: string };

/** Mainnet Bitcoin: bech32 bc1…, or base58 P2PKH (1…) and P2SH (3…). */
const BTC_MAINNET = /^(bc1[02-9ac-hj-np-z]{8,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/i;
/** Testnet base58 (m…, n…, 2…) and regtest bech32 (bcrt1…): valid Bitcoin, but not what this wallet pays. */
const BTC_OTHER_TESTNET = /^([mn2][1-9A-HJ-NP-Za-km-z]{25,34}|bcrt1[02-9ac-hj-np-z]{8,87})$/i;
/** A Pubky key: "pubky" + 52 z-base32 characters, or the bare 52 characters. */
const PUBKY_KEY = /^(pubky)?[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/;

/**
 * Is `text` an address this wallet can pay on `chain`? The message follows
 * docs/DESIGN.md: it says what is wrong and what to do. Mainnet addresses
 * are refused on purpose: this wallet only moves testnet coins. So are the
 * token and faucet contracts (money sent there is lost) and EIP-681 codes
 * for other networks.
 *
 * EVM addresses look the same on every EVM chain, so "mainnet" cannot be
 * detected from a bare 0x address; WDK sends on Sepolia whatever the address.
 */
export function checkRecipientAddress(text: string, chain: Chain): RecipientCheck {
  if (text.trim() === '') return { ok: false, reason: 'empty', message: 'Enter an address.' };
  const payee = payeeOfPaymentText(text);
  if (!payee.ok) return { ok: false, reason: 'unsupported', message: payee.message };
  const address = payee.address;
  if (address === '') return { ok: false, reason: 'invalid', message: 'That payment code has no address in it.' };

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

  if (isEvmAddress(address)) {
    if (isKnownContract(address)) {
      return {
        ok: false,
        reason: 'contract',
        message: "That is the test USD₮ token or faucet contract, not someone's wallet. Money sent there is lost. Paste the payee's own address.",
      };
    }
    return { ok: true, address };
  }
  if (isBtcTestnetAddress(address) || BTC_MAINNET.test(address) || BTC_OTHER_TESTNET.test(address)) {
    return { ok: false, reason: 'wrong-chain', message: 'That is a Bitcoin address. Choose Bitcoin to send to it.' };
  }
  return { ok: false, reason: 'invalid', message: 'That is not an Ethereum address. It should be 0x and 40 characters.' };
}
