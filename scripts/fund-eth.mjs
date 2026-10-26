#!/usr/bin/env node
// Send a little Sepolia ETH (gas money) from the treasury to a demo wallet.
//
//   node scripts/fund-eth.mjs                   0.001 ETH to the Android wallet
//   node scripts/fund-eth.mjs android 0.005
//   node scripts/fund-eth.mjs 0xAbc… 0.002
//
// The treasury is the iOS demo wallet's EVM account (m/44'/60'/0'/0/0, the
// same account the iOS app spends from). A human funds it once from a
// public Sepolia faucet; see docs/research/04-testnet-funding.md.
import { formatEther, parseEther } from 'ethers';

import { SEPOLIA_EXPLORER, resolveTarget, treasurySigner } from './lib/demo-wallets.mjs';

const [targetArg = 'android', amountArg = '0.001'] = process.argv.slice(2);
const to = resolveTarget(targetArg, 'evm');
const value = parseEther(amountArg);
if (value <= 0n || value > parseEther('0.1')) {
  console.error('Send between 0 and 0.1 ETH at a time.');
  process.exit(1);
}

const signer = treasurySigner();
if (to.toLowerCase() === signer.address.toLowerCase()) {
  console.error('That is the treasury itself.');
  process.exit(1);
}
const balance = await signer.provider.getBalance(signer.address);
if (balance <= value) {
  console.error(`The treasury ${signer.address} has ${formatEther(balance)} ETH, not enough to send ${amountArg} ETH plus gas.`);
  process.exit(1);
}

console.log(`Sending ${amountArg} ETH from ${signer.address} to ${to}…`);
const tx = await signer.sendTransaction({ to, value });
console.log(`Sent ${tx.hash}`);
const receipt = await tx.wait();
console.log(`${receipt.status === 1 ? 'Confirmed' : 'FAILED'} in block ${receipt.blockNumber}: ${SEPOLIA_EXPLORER}/tx/${tx.hash}`);
