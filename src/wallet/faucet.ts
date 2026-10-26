// Call data for the Aave Sepolia faucet: `mint(address token, address to, uint256 amount)`.
//
// WDK's EVM account can send a raw transaction with `data`, so the wallet
// mints its own test USD₮ instead of depending on a web faucet. The account
// needs a little Sepolia ETH for gas. The ABI encoding is done by hand here
// because it is three 32-byte words; pulling in an ABI library for that
// would hide what is going on.
import {
  AAVE_FAUCET_MAX_MINT_UNITS,
  AAVE_FAUCET_MINT_SELECTOR,
  AAVE_SEPOLIA_FAUCET,
  SEPOLIA_USDT,
} from '../config/chains';
import { isEvmAddress } from './addressFormat';

/** Default amount for "Get test USD₮": 1,000 USD₮ in micro-units. */
export const DEFAULT_FAUCET_MINT_UNITS = 1_000n * 10n ** 6n;

function encodeAddressWord(address: string): string {
  if (!isEvmAddress(address)) throw new Error('Not an EVM address');
  return address.slice(2).toLowerCase().padStart(64, '0');
}

function encodeUintWord(value: bigint): string {
  if (value < 0n) throw new Error('uint256 cannot be negative');
  const hex = value.toString(16);
  if (hex.length > 64) throw new Error('Value does not fit in uint256');
  return hex.padStart(64, '0');
}

/** ABI-encode `mint(token, to, amount)` for the Aave faucet. */
export function encodeFaucetMint(token: string, to: string, amount: bigint): string {
  if (amount <= 0n || amount > AAVE_FAUCET_MAX_MINT_UNITS) {
    throw new Error('The faucet mints between 0 and 10,000 tokens per call');
  }
  return AAVE_FAUCET_MINT_SELECTOR + encodeAddressWord(token) + encodeAddressWord(to) + encodeUintWord(amount);
}

/** The transaction WDK sends to mint test USD₮ to `to`. */
export function usdtFaucetTransaction(to: string, amount: bigint = DEFAULT_FAUCET_MINT_UNITS) {
  return {
    to: AAVE_SEPOLIA_FAUCET,
    value: '0',
    data: encodeFaucetMint(SEPOLIA_USDT, to, amount),
  };
}
