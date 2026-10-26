#!/usr/bin/env node
// Print both demo wallets' balances: BTC on Mutinynet, ETH and USD₮ on
// Sepolia. Read-only; needs .env.demo (the addresses are derived from its
// phrases, which are never printed).
//
//   node scripts/fund-status.mjs            account 0 of both wallets
//   node scripts/fund-status.mjs --contacts 3   also BTC contact accounts 1..3
//
// BTC comes from Mutinynet's esplora API (confirmed + mempool). ETH and USD₮
// come from the keyless Sepolia RPC the app uses.
import { Contract, JsonRpcProvider, formatEther } from 'ethers';

import { MUTINYNET_API, SEPOLIA_RPC, SEPOLIA_USDT, btcAddressForAccount, demoWallets, formatUnits } from './lib/demo-wallets.mjs';

const contactsArg = process.argv.indexOf('--contacts');
const contactCount = contactsArg >= 0 ? Number(process.argv[contactsArg + 1] ?? 3) : 0;

const provider = new JsonRpcProvider(SEPOLIA_RPC);
const usdt = new Contract(SEPOLIA_USDT, ['function balanceOf(address) view returns (uint256)'], provider);

async function btcBalance(address) {
  const response = await fetch(`${MUTINYNET_API}/address/${address}`);
  if (!response.ok) throw new Error(`mutinynet.com answered ${response.status}`);
  const { chain_stats: chain, mempool_stats: mempool } = await response.json();
  const confirmed = BigInt(chain.funded_txo_sum - chain.spent_txo_sum);
  const pending = BigInt(mempool.funded_txo_sum - mempool.spent_txo_sum);
  return { confirmed, pending };
}

function describeBtc({ confirmed, pending }) {
  const pendingText = pending !== 0n ? ` (${pending > 0n ? '+' : ''}${pending} sats unconfirmed)` : '';
  return `${confirmed} sats${pendingText}`;
}

const wallets = demoWallets();
for (const wallet of Object.values(wallets)) {
  const [btc, eth, usdtUnits] = await Promise.all([
    btcBalance(wallet.btc),
    provider.getBalance(wallet.evm),
    usdt.balanceOf(wallet.evm),
  ]);
  console.log(`${wallet.name}${wallet.name === 'ios' ? ' (treasury)' : ''}`);
  console.log(`  BTC   ${wallet.btc}  ${describeBtc(btc)}`);
  console.log(`  ETH   ${wallet.evm}  ${formatEther(eth)} ETH`);
  console.log(`  USD₮  ${wallet.evm}  ${formatUnits(usdtUnits, 6)} USD₮`);
  for (let index = 1; index <= contactCount; index++) {
    const address = btcAddressForAccount(wallet.name, index);
    console.log(`  BTC contact account ${index}  ${address}  ${describeBtc(await btcBalance(address))}`);
  }
}
