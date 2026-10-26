// Payment proofs: their JSON, and the payee's on-chain checks.
import { Wallet, type HDNodeWallet } from 'ethers';

import { SEPOLIA_CHAIN_ID, SEPOLIA_USDT } from '../../config/chains';
import { ERC20_TRANSFER_TOPIC, erc20PaymentTypedData, type Erc20RequestBinding } from '../../wallet/erc20PaymentProof';
import type { EvmTransaction } from '../../wallet/paymentEvidence';
import {
  btcProofJson,
  erc20ProofJson,
  latestSepoliaBlockTimeMs,
  parseProof,
  paymentNotBefore,
  proofTransactionHash,
  transferKey,
  verifyBtcProof,
  verifyErc20Proof,
} from '../paymentProofs';

const TXID = 'ab'.repeat(32);
const NOW = Date.parse('2026-10-26T12:00:00Z');
const HASH = `0x${'cd'.repeat(32)}`;
const PAYEE_EVM = '0x6620afba9eb4ae3ca540ce715420ffeb70ba3b0a';
const pad = (address: string) => `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;

describe('proof JSON', () => {
  it('round-trips a Bitcoin proof', () => {
    expect(parseProof(btcProofJson(TXID.toUpperCase()))).toEqual({ kind: 'btc', txid: TXID });
    expect(proofTransactionHash(btcProofJson(TXID))).toBe(TXID);
  });

  it('round-trips an ERC-20 proof', () => {
    const json = erc20ProofJson({ transactionHash: HASH, receiptLogIndex: '0', signature: `0x${'1'.repeat(130)}` });
    expect(parseProof(json)).toEqual({ kind: 'erc20', chainId: '11155111', transactionHash: HASH, receiptLogIndex: '0', signature: `0x${'1'.repeat(130)}` });
    expect(JSON.parse(json)).toMatchObject({ type: 'erc20-transfer-eip712', chain_id: '11155111' });
  });

  it('refuses anything else', () => {
    for (const bad of ['nope', '{}', '{"type":"bitcoin-onchain-tx","network":"mainnet","txid":"' + TXID + '"}', '{"type":"bitcoin-onchain-tx","network":"mutinynet","txid":"xyz"}']) {
      expect(parseProof(bad)).toBeUndefined();
    }
    expect(parseProof(JSON.stringify({ type: 'erc20-transfer-eip712', chain_id: '11155111', transaction_hash: HASH, receipt_log_index: '01', signature: `0x${'1'.repeat(130)}` }))).toBeUndefined();
  });

  it('keys a transfer by chain, hash and log', () => {
    expect(transferKey({ kind: 'btc', txid: TXID })).toBe(`bitcoin:${TXID}`);
    expect(transferKey({ kind: 'erc20', chainId: '1', transactionHash: HASH, receiptLogIndex: '2', signature: '' })).toBe(`ethereum:1:${HASH}:2`);
  });
});

describe('verifyBtcProof', () => {
  const context = { amount: 10_000n, address: 'tb1q', paymentKey: 'k1', nowMs: NOW };
  it('waits for a transaction it has not seen or that is unconfirmed', () => {
    expect(verifyBtcProof({ found: false, received: 0n, confirmed: false }, context).status).toBe('pending');
    expect(verifyBtcProof({ found: true, received: 10_000n, confirmed: false }, context).status).toBe('pending');
  });
  it('verifies a confirmed payment of at least the amount', () => {
    expect(verifyBtcProof({ found: true, received: 10_000n, confirmed: true }, context).status).toBe('verified');
    expect(verifyBtcProof({ found: true, received: 20_000n, confirmed: true }, context).status).toBe('verified');
  });
  it('rejects too little, and a transaction that already paid something else', () => {
    expect(verifyBtcProof({ found: true, received: 9_999n, confirmed: true }, context).status).toBe('rejected');
    expect(verifyBtcProof({ found: true, received: 10_000n, confirmed: true }, { ...context, transferClaimedBy: 'k2' }).status).toBe('rejected');
    expect(verifyBtcProof({ found: true, received: 10_000n, confirmed: true }, { ...context, transferClaimedBy: 'k1' }).status).toBe('verified');
  });
});

describe('verifyErc20Proof', () => {
  const payer = Wallet.createRandom();
  const binding: Erc20RequestBinding = {
    payer: 'payerkey',
    payee: 'payeekey',
    paymentAppId: 'wdk-paykit-demo',
    paymentRequestId: 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33',
    paymentReference: 'pkw-1',
    paymentEndpointIdentifier: 'usdt-sepolia-address',
    periodStartsAt: '',
    periodEndsAt: '',
    conversionQuoteId: '',
  };
  const transferLog = (from: string, to = PAYEE_EVM, amount = 5_000_000n, token = SEPOLIA_USDT) => ({
    address: token,
    topics: [ERC20_TRANSFER_TOPIC, pad(from), pad(to)],
    data: `0x${amount.toString(16).padStart(64, '0')}`,
  });
  const mined = (logs: ReturnType<typeof transferLog>[]): EvmTransaction => ({ state: 'succeeded', confirmations: 1, logs });

  async function proofFor(signer: HDNodeWallet, logIndex = '1', signedBinding = binding) {
    const typed = erc20PaymentTypedData(SEPOLIA_CHAIN_ID, { transactionHash: HASH, receiptLogIndex: logIndex, request: signedBinding });
    const signature = (await signer.signTypedData(typed.domain, typed.types, typed.message)).toLowerCase();
    return { kind: 'erc20' as const, chainId: String(SEPOLIA_CHAIN_ID), transactionHash: HASH, receiptLogIndex: logIndex, signature };
  }

  const context = async (overrides: object = {}) => ({
    amount: 5_000_000n,
    address: PAYEE_EVM,
    paymentKey: 'k1',
    nowMs: NOW,
    token: SEPOLIA_USDT,
    chainId: SEPOLIA_CHAIN_ID,
    binding,
    proof: await proofFor(payer),
    ...overrides,
  });
  // Log 0 is something else (e.g. a fee transfer), log 1 is the payment.
  const otherLog = { address: SEPOLIA_USDT, topics: [ERC20_TRANSFER_TOPIC], data: '0x' };

  it('verifies a signed transfer from the signer to us', async () => {
    expect(verifyErc20Proof(mined([otherLog as never, transferLog(payer.address)]), await context())).toEqual({ status: 'verified' });
  });

  it('rejects an older transfer from the payer that was never tied to this request', async () => {
    const minedHoursAgo: EvmTransaction = { state: 'succeeded', confirmations: 1_000, logs: [otherLog as never, transferLog(payer.address)] };
    const notBefore = { ms: NOW - 60 * 60_000, what: 'request' as const };
    // 1000 confirmations: mined at least 999 slots (about 3.3 h) ago, before we asked an hour ago.
    expect(verifyErc20Proof(minedHoursAgo, await context({ notBefore }))).toEqual({ status: 'rejected', reason: 'It was paid before you asked for it.' });
    // 100 confirmations (at most 20 min ago): it may well be newer, so it passes.
    expect(verifyErc20Proof({ ...minedHoursAgo, confirmations: 100 }, await context({ notBefore })).status).toBe('verified');
  });

  it('waits while the transaction is not mined', async () => {
    expect(verifyErc20Proof({ state: 'pending' }, await context()).status).toBe('pending');
    expect(verifyErc20Proof({ state: 'unknown' }, await context()).status).toBe('pending');
  });

  it('rejects a reverted transaction', async () => {
    expect(verifyErc20Proof({ state: 'failed', confirmations: 1 }, await context()).status).toBe('rejected');
  });

  it('waits on a "dropped" transaction instead of rejecting it (a lagging RPC node says the same about a mined one)', async () => {
    expect(verifyErc20Proof({ state: 'dropped' }, await context())).toMatchObject({ status: 'pending', recheckMs: 60_000 });
  });

  it('rejects a signature from someone other than the sender (a public transfer claimed by another)', async () => {
    const thief = Wallet.createRandom();
    const verdict = verifyErc20Proof(mined([otherLog as never, transferLog(payer.address)]), await context({ proof: await proofFor(thief) }));
    expect(verdict).toEqual({ status: 'rejected', reason: 'The signature is not from the account that paid.' });
  });

  it('rejects a signature over another request', async () => {
    const proof = await proofFor(payer, '1', { ...binding, paymentRequestId: 'another' });
    expect(verifyErc20Proof(mined([otherLog as never, transferLog(payer.address)]), await context({ proof })).status).toBe('rejected');
  });

  it('rejects the wrong log, token, recipient, amount, chain or a reused transfer', async () => {
    const tx = mined([otherLog as never, transferLog(payer.address)]);
    expect(verifyErc20Proof(tx, await context({ proof: await proofFor(payer, '0') })).status).toBe('rejected');
    expect(verifyErc20Proof(mined([otherLog as never, transferLog(payer.address, PAYEE_EVM, 5_000_000n, `0x${'9'.repeat(40)}`)]), await context()).status).toBe('rejected');
    expect(verifyErc20Proof(mined([otherLog as never, transferLog(payer.address, `0x${'8'.repeat(40)}`)]), await context()).status).toBe('rejected');
    expect(verifyErc20Proof(mined([otherLog as never, transferLog(payer.address, PAYEE_EVM, 4_999_999n)]), await context()).status).toBe('rejected');
    expect(verifyErc20Proof(tx, await context({ chainId: 1 })).status).toBe('rejected');
    expect(verifyErc20Proof(tx, await context({ transferClaimedBy: 'k2' })).status).toBe('rejected');
  });
});

describe('payment time', () => {
  const asked = { ms: NOW - 60 * 60_000, what: 'request' as const };
  const btc = { amount: 10_000n, address: 'tb1q', paymentKey: 'k1', nowMs: NOW, notBefore: asked };

  it('takes the later of when we asked and when the period began', () => {
    expect(paymentNotBefore(1_000, undefined)).toEqual({ ms: 1_000, what: 'request' });
    expect(paymentNotBefore(1_000, 5_000)).toEqual({ ms: 5_000, what: 'period' });
    expect(paymentNotBefore(5_000, 1_000)).toEqual({ ms: 5_000, what: 'request' });
    expect(paymentNotBefore(undefined, undefined)).toBeUndefined();
  });

  it('rejects a Bitcoin payment confirmed before we asked (an earlier private send, say)', () => {
    const before = { found: true, received: 10_000n, confirmed: true, blockTimeMs: asked.ms - 11 * 60_000 };
    expect(verifyBtcProof(before, btc)).toEqual({ status: 'rejected', reason: 'It was paid before you asked for it.' });
    expect(verifyBtcProof(before, { ...btc, notBefore: { ms: asked.ms, what: 'period' } })).toEqual({ status: 'rejected', reason: 'It was paid before this payment was due.' });
  });

  it('allows block timestamps and clocks to drift a little, and waits while the block time is unknown', () => {
    expect(verifyBtcProof({ found: true, received: 10_000n, confirmed: true, blockTimeMs: asked.ms - 5 * 60_000 }, btc).status).toBe('verified');
    expect(verifyBtcProof({ found: true, received: 10_000n, confirmed: true }, btc).status).toBe('pending');
    // A request from before the rule has no time to compare.
    expect(verifyBtcProof({ found: true, received: 10_000n, confirmed: true }, { ...btc, notBefore: undefined }).status).toBe('verified');
  });

  it('bounds a Sepolia block time from its confirmations: at most one block per 12 s slot', () => {
    expect(latestSepoliaBlockTimeMs(1, NOW)).toBe(NOW);
    expect(latestSepoliaBlockTimeMs(301, NOW)).toBe(NOW - 3_600_000);
    expect(latestSepoliaBlockTimeMs(0, NOW)).toBe(NOW);
  });
});
