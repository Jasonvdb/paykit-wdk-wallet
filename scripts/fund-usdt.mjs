#!/usr/bin/env node
// Mint Aave test USD₮ on Sepolia to a demo wallet.
//
//   node scripts/fund-usdt.mjs android          1,000 USD₮ to the Android wallet
//   node scripts/fund-usdt.mjs ios 5000         5,000 USD₮ to the iOS wallet
//   node scripts/fund-usdt.mjs 0xAbc… 250       any Sepolia address
//
// The Aave faucet's mint(token, to, amount) is permissionless on Sepolia
// (at most 10,000 tokens per call), so the treasury (the iOS demo wallet's
// EVM account) only pays gas. It needs a little Sepolia ETH first. The app's
// "Get test USD₮" button sends the same call from the phone itself.
import { Contract, formatEther, parseUnits } from 'ethers';

import { AAVE_SEPOLIA_FAUCET, SEPOLIA_EXPLORER, SEPOLIA_USDT, resolveTarget, treasurySigner } from './lib/demo-wallets.mjs';

const MAX_MINT = 10_000n;
const [targetArg, amountArg = '1000'] = process.argv.slice(2);
if (!targetArg) {
  console.error('Usage: node scripts/fund-usdt.mjs <ios|android|0x…> [USD₮ amount, default 1000]');
  process.exit(1);
}
const to = resolveTarget(targetArg, 'evm');
const amount = parseUnits(amountArg, 6);
if (amount <= 0n || amount > MAX_MINT * 10n ** 6n) {
  console.error('The faucet mints between 0 and 10,000 USD₮ per call.');
  process.exit(1);
}

const signer = treasurySigner();
const gas = await signer.provider.getBalance(signer.address);
if (gas === 0n) {
  console.error(`The treasury ${signer.address} has no Sepolia ETH for gas. Send it some first (docs/research/04-testnet-funding.md).`);
  process.exit(1);
}

const faucet = new Contract(AAVE_SEPOLIA_FAUCET, ['function mint(address token, address to, uint256 amount) returns (uint256)'], signer);
console.log(`Minting ${amountArg} USD₮ to ${to} (treasury ${signer.address}, ${formatEther(gas)} ETH for gas)…`);
const tx = await faucet.mint(SEPOLIA_USDT, to, amount);
console.log(`Sent ${tx.hash}`);
const receipt = await tx.wait();
console.log(`${receipt.status === 1 ? 'Confirmed' : 'FAILED'} in block ${receipt.blockNumber}: ${SEPOLIA_EXPLORER}/tx/${tx.hash}`);
