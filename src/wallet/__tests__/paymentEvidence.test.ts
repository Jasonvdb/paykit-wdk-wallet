// Reading payments back from what WDK returns over its RPC bridge.
import { SEPOLIA_USDT } from '../../config/chains';
import { ERC20_TRANSFER_TOPIC } from '../erc20PaymentProof';
import { btcReceiptFromTransfers, btcSendStatus, erc20TransferFromLog, evmTransactionFrom, findErc20TransferLog, matchSentTransfer } from '../paymentEvidence';
import type { ActivityItem } from '../activity';

const TXID = 'ab'.repeat(32);
const ADDRESS = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const FROM = '0x83a881ddad0f675a3d57d306f3f4e6b352b95cd0';
const TO = '0x6620afba9eb4ae3ca540ce715420ffeb70ba3b0a';
const pad = (a: string) => `0x${'0'.repeat(24)}${a.slice(2)}`;

describe('btcReceiptFromTransfers', () => {
  const row = (overrides: object = {}) => ({ txid: TXID, address: ADDRESS, vout: 0, height: 120, value: '6000', direction: 'incoming', ...overrides });

  it('sums the outputs one transaction paid into the account', () => {
    expect(btcReceiptFromTransfers([row(), row({ vout: 2, value: 4000 })], TXID.toUpperCase(), ADDRESS)).toEqual({ found: true, received: 10_000n, confirmed: true });
  });

  it('is unconfirmed while any output is at height 0', () => {
    expect(btcReceiptFromTransfers([row({ height: 0 })], TXID, ADDRESS).confirmed).toBe(false);
  });

  it('ignores other transactions, outgoing rows and other addresses', () => {
    expect(btcReceiptFromTransfers([row({ txid: 'cd'.repeat(32) }), row({ direction: 'outgoing' }), row({ address: 'tb1qother' })], TXID, ADDRESS)).toEqual({
      found: false,
      received: 0n,
      confirmed: false,
    });
    expect(btcReceiptFromTransfers('junk', TXID, ADDRESS).found).toBe(false);
  });
});

it('reads our own Bitcoin send status', () => {
  expect(btcSendStatus({ finality: 'pending' })).toEqual({ found: true, confirmed: false });
  expect(btcSendStatus({ finality: 'confirmed' })).toEqual({ found: true, confirmed: true });
  expect(btcSendStatus(null)).toEqual({ found: false, confirmed: false });
});

describe('evmTransactionFrom', () => {
  const log = { address: SEPOLIA_USDT, topics: [ERC20_TRANSFER_TOPIC, pad(FROM), pad(TO)], data: `0x${(5_000_000).toString(16).padStart(64, '0')}` };

  it('reads a mined transaction with its logs', () => {
    expect(evmTransactionFrom({ finality: 'confirmed', success: true, confirmations: 2, receipt: { status: 1, logs: [log] } })).toEqual({
      state: 'succeeded',
      confirmations: 2,
      logs: [log],
    });
  });

  it('tells pending, dropped, failed and unknown apart', () => {
    expect(evmTransactionFrom({ finality: 'pending', receipt: null })).toEqual({ state: 'pending' });
    expect(evmTransactionFrom({ finality: 'dropped' })).toEqual({ state: 'dropped' });
    expect(evmTransactionFrom({ finality: 'confirmed', success: false, confirmations: 1, receipt: { status: 0, logs: [] } })).toEqual({ state: 'failed', confirmations: 1 });
    expect(evmTransactionFrom(undefined)).toEqual({ state: 'unknown' });
  });

  it('reads a Transfer event and finds ours by its receipt position', () => {
    expect(erc20TransferFromLog(log)).toEqual({ token: SEPOLIA_USDT.toLowerCase(), from: FROM, to: TO, amount: 5_000_000n });
    expect(erc20TransferFromLog({ ...log, topics: [log.topics[0]!] })).toBeUndefined();
    const approval = { ...log, topics: ['0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925', pad(FROM), pad(TO)] };
    expect(findErc20TransferLog([approval, log], { token: SEPOLIA_USDT, from: FROM, to: TO, amount: 5_000_000n })).toBe(1);
    expect(findErc20TransferLog([log], { token: SEPOLIA_USDT, from: FROM, to: TO, amount: 1n })).toBeUndefined();
  });
});

describe('matchSentTransfer (a payment that lost its hash)', () => {
  const sent = (overrides: Partial<ActivityItem>): ActivityItem => ({
    id: 'i',
    chain: 'bitcoin',
    asset: 'btc',
    direction: 'out',
    amount: 10_000n,
    hash: 'a'.repeat(64),
    counterpartyAddress: 'tb1qpayee',
    status: 'confirmed',
    timestamp: 2_000_000,
    accountIndex: 0,
    ...overrides,
  });
  const query = { asset: 'btc' as const, to: 'tb1qpayee', amount: 10_000n, notBeforeMs: 1_000_000, exclude: new Set<string>() };

  it('finds an exact transfer sent after the payment started, or still unconfirmed', () => {
    expect(matchSentTransfer([sent({})], query)).toEqual({ state: 'found', hash: 'a'.repeat(64) });
    expect(matchSentTransfer([sent({ status: 'pending', timestamp: undefined })], query).state).toBe('found');
  });

  it('ignores other amounts, addresses, receives, older transfers and hashes other payments use', () => {
    expect(matchSentTransfer([sent({ amount: 9_999n })], query).state).toBe('none');
    expect(matchSentTransfer([sent({ counterpartyAddress: 'tb1qother' })], query).state).toBe('none');
    expect(matchSentTransfer([sent({ direction: 'in' })], query).state).toBe('none');
    expect(matchSentTransfer([sent({ timestamp: 999_999 })], query).state).toBe('none');
    expect(matchSentTransfer([sent({})], { ...query, exclude: new Set(['a'.repeat(64)]) }).state).toBe('none');
  });

  it('is unsure about a confirmed match whose time it could not read', () => {
    expect(matchSentTransfer([sent({ timestamp: undefined })], query).state).toBe('unsure');
  });

  it('compares EVM addresses in any letter case', () => {
    const usdt = sent({ chain: 'ethereum', asset: 'usdt', counterpartyAddress: '0xABCDEF' });
    expect(matchSentTransfer([usdt], { ...query, asset: 'usdt', to: '0xabcdef' }).state).toBe('found');
  });
});
