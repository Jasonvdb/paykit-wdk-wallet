import { readFileSync } from 'fs';
import { join } from 'path';

import * as chains from '../chains';

// The funding scripts are plain Node and keep their own copy of the chain
// constants (scripts/lib/demo-wallets.mjs). This test keeps the copy in
// step with src/config/chains.ts, like versions.test.ts does for versions.
const script = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'lib', 'demo-wallets.mjs'), 'utf8');

function scriptConstant(name: string): string | undefined {
  const match = new RegExp(`export const ${name} = (?:'([^']*)'|(\\d+)n);`).exec(script);
  return match ? (match[1] ?? match[2]) : undefined;
}

describe('chain constants in the funding scripts', () => {
  it.each([
    ['SEPOLIA_RPC', chains.SEPOLIA_RPC],
    ['SEPOLIA_CHAIN_ID', String(chains.SEPOLIA_CHAIN_ID)],
    ['SEPOLIA_USDT', chains.SEPOLIA_USDT],
    ['AAVE_SEPOLIA_FAUCET', chains.AAVE_SEPOLIA_FAUCET],
    ['MUTINYNET_API', chains.MUTINYNET_API],
    ['MUTINYNET_FAUCET', chains.MUTINYNET_FAUCET_URL],
    ['SEPOLIA_EXPLORER', chains.SEPOLIA_EXPLORER],
    ['MUTINYNET_EXPLORER', chains.MUTINYNET_EXPLORER],
  ])('%s matches src/config/chains.ts', (name, expected) => {
    expect(scriptConstant(name)).toBe(expected);
  });
});
