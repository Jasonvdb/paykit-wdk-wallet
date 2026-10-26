// Shared helpers for the host-side funding scripts (scripts/fund-*.mjs).
//
// The two demo wallets are defined by the BIP-39 phrases in the git-ignored
// .env.demo (IOS_MNEMONIC, ANDROID_MNEMONIC). These helpers derive the same
// addresses the app derives with WDK, so the scripts and the app agree on
// where the money is:
//
//   EVM (ETH and USD₮ on Sepolia)  m/44'/60'/0'/0/0   WDK wallet-evm getAccount(0)
//   BTC (Mutinynet, P2WPKH tb1q…)  m/84'/1'/0'/0/0    WDK wallet-btc getAccount(0), network 'testnet'
//
// Both use the BIP-39 seed with an empty passphrase, like WDK. The iOS demo
// wallet doubles as the treasury: its EVM key signs the Sepolia scripts.
//
// Secrets stay in this process: nothing here prints a phrase or a private
// key. Only addresses (public) leave these functions, plus an ethers Wallet
// object for signing that callers must never log.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bech32 } from '@scure/base';
import { HDNodeWallet, JsonRpcProvider, getBytes, ripemd160, sha256 } from 'ethers';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_PATH = join(ROOT, '.env.demo');

// Chain constants. They mirror src/config/chains.ts (which is TypeScript and
// cannot be imported from plain Node without a build step);
// src/config/__tests__/chains.test.ts fails if the two drift apart.
export const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
export const SEPOLIA_CHAIN_ID = 11155111n;
export const SEPOLIA_USDT = '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0';
export const AAVE_SEPOLIA_FAUCET = '0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D';
export const MUTINYNET_API = 'https://mutinynet.com/api';
export const MUTINYNET_FAUCET = 'https://faucet.mutinynet.com';
export const SEPOLIA_EXPLORER = 'https://sepolia.etherscan.io';
export const MUTINYNET_EXPLORER = 'https://mutinynet.com';

const EVM_PATH = "m/44'/60'/0'/0/0";
/** BTC account i (0 = spending, 1, 2, … = contact accounts), as WDK's getAccount(i) on testnet. */
const btcPath = (accountIndex) => `m/84'/1'/0'/0/${accountIndex}`;

/** Read .env.demo into an object. Values are secrets: never print them. */
export function readDemoEnv() {
  if (!existsSync(ENV_PATH)) {
    throw new Error('No .env.demo found. See README.md, "First launch".');
  }
  const values = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

/** A P2WPKH testnet address (tb1q…) for a compressed secp256k1 public key. */
export function p2wpkhTestnetAddress(compressedPublicKeyHex) {
  const hash160 = getBytes(ripemd160(sha256(compressedPublicKeyHex)));
  return bech32.encode('tb', [0, ...bech32.toWords(hash160)]);
}

/**
 * The public side of one demo wallet: { name, evm, btc }. Throws if the
 * phrase is missing; the message names the key, never the value.
 */
export function demoWallet(name, env = readDemoEnv()) {
  const key = `${name.toUpperCase()}_MNEMONIC`;
  const phrase = env[key];
  if (!phrase) throw new Error(`${key} is not set in .env.demo`);
  const evm = HDNodeWallet.fromPhrase(phrase, '', EVM_PATH);
  const btc = HDNodeWallet.fromPhrase(phrase, '', btcPath(0));
  return { name, evm: evm.address, btc: p2wpkhTestnetAddress(btc.publicKey) };
}

/** A demo wallet's BTC address for account `accountIndex` (contact accounts are 1, 2, …). Public only. */
export function btcAddressForAccount(name, accountIndex, env = readDemoEnv()) {
  const key = `${name.toUpperCase()}_MNEMONIC`;
  const phrase = env[key];
  if (!phrase) throw new Error(`${key} is not set in .env.demo`);
  return p2wpkhTestnetAddress(HDNodeWallet.fromPhrase(phrase, '', btcPath(accountIndex)).publicKey);
}

/** Both demo wallets' public addresses. */
export function demoWallets() {
  const env = readDemoEnv();
  return { ios: demoWallet('ios', env), android: demoWallet('android', env) };
}

/**
 * The treasury signer: the iOS demo wallet's EVM account 0, connected to
 * Sepolia. Never log this object; it holds the private key.
 */
export function treasurySigner() {
  const phrase = readDemoEnv().IOS_MNEMONIC;
  if (!phrase) throw new Error('IOS_MNEMONIC is not set in .env.demo');
  return HDNodeWallet.fromPhrase(phrase, '', EVM_PATH).connect(new JsonRpcProvider(SEPOLIA_RPC, Number(SEPOLIA_CHAIN_ID)));
}

/** Resolve "ios" / "android" to that wallet's address on `chain`, or accept a literal address. */
export function resolveTarget(text, chain) {
  if (text === 'ios' || text === 'android') return demoWallets()[text][chain];
  return text;
}

/** Format base units as a decimal string (bigint in, string out). */
export function formatUnits(value, decimals) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}
