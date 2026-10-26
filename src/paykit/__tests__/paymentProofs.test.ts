// Payment proofs: their JSON, and the payee's on-chain checks.
import { Wallet, type HDNodeWallet } from 'ethers';

import { SEPOLIA_CHAIN_ID, SEPOLIA_USDT } from '../../config/chains';
import { ERC20_TRANSFER_TOPIC, erc20PaymentTypedData, type Erc20RequestBinding } from '../../wallet/erc20PaymentProof';
import type { EvmTransaction } from '../../wallet/paymentEvidence';
import { btcProofJson, erc20ProofJson, parseProof, proofTransactionHash, transferKey, verifyBtcProof, verifyErc20Proof } from '../paymentProofs';

const TXID = 'ab'.repeat(32);
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
  const context = { amount: 10_000n, address: 'tb1q', paymentKey: 'k1' };
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

  it('waits while the transaction is not mined', async () => {
    expect(verifyErc20Proof({ state: 'pending' }, await context()).status).toBe('pending');
    expect(verifyErc20Proof({ state: 'unknown' }, await context()).status).toBe('pending');
  });

  it('rejects failed and dropped transactions', async () => {
    expect(verifyErc20Proof({ state: 'failed', confirmations: 1 }, await context()).status).toBe('rejected');
    expect(verifyErc20Proof({ state: 'dropped' }, await context()).status).toBe('rejected');
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
