// Chain constants for the two testnets the wallet uses.
//
// This file has no imports on purpose: pure logic (amount formatting,
// endpoint payload checks, faucet call data) imports it and is unit tested
// in Node, where the WDK and Paykit native modules do not exist.
// src/config/wdk.ts builds the WDK runtime configuration from these values.

/**
 * Bitcoin on Mutinynet, a signet with 30 s blocks.
 *
 * Mutinynet's Electrum TLS port (50002) has an expired certificate, so we use
 * plain TCP on 50001. That is fine for public testnet data, never for mainnet.
 */
export const MUTINYNET_ELECTRUM = {
  host: 'electrum.mutinynet.com',
  port: 50001,
  protocol: 'tcp',
} as const;

/** Fallback if Mutinynet is down: Bitcoin testnet4 over Electrum TLS. */
export const TESTNET4_ELECTRUM = {
  host: 'mempool.space',
  port: 40002,
  protocol: 'tls',
} as const;

/** Ethereum Sepolia. */
export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

/** Aave's test USDT on Sepolia (6 decimals). Anyone can mint it through the Aave faucet. */
export const SEPOLIA_USDT = '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0';

/**
 * Aave V3 Sepolia faucet. `mint(address token, address to, uint256 amount)` is
 * permissionless on Sepolia; one call mints at most 10,000 tokens. The caller
 * pays gas in Sepolia ETH.
 */
export const AAVE_SEPOLIA_FAUCET = '0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D';
export const AAVE_FAUCET_MINT_SELECTOR = '0xc6c3bbe6';
export const AAVE_FAUCET_MAX_MINT_UNITS = 10_000n * 10n ** 6n;

/** Block explorers, for links the user can open. */
export const MUTINYNET_EXPLORER = 'https://mutinynet.com';
export const SEPOLIA_EXPLORER = 'https://sepolia.etherscan.io';

/**
 * Keyless Blockscout API for Sepolia. WDK's EVM module has no history call,
 * so the wallet reads EVM activity from here (fetchEvmActivity in src/wallet/useActivity.ts).
 */
export const SEPOLIA_BLOCKSCOUT_API = 'https://eth-sepolia.blockscout.com/api/v2';
