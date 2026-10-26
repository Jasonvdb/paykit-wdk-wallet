import { AAVE_SEPOLIA_FAUCET, SEPOLIA_USDT } from '../../config/chains';
import { addressFromPaymentText, checkRecipientAddress } from '../addressFormat';
import { parseRecommendedFeeRate, parseTransactionStatus } from '../mutinynet';
import { checkAffordable, formatFee, sendErrorMessage } from '../sendChecks';

const TB1 = 'tb1qh3z4yzs97s9sq9awmgm55t3auxjuc4j5srz0pg';
const EVM = '0x83A881Ddad0F675A3d57d306F3F4E6b352b95CD0';
const OTHER_TOKEN = '0x1111111111111111111111111111111111111111';
const PUBKY = 'pubky5fpe1iozempar1row5gyyn51y4i1sir7r7eu9krab1x3i5oen1gy';

describe('checkRecipientAddress', () => {
  it('accepts a testnet address for its chain', () => {
    expect(checkRecipientAddress(` ${TB1} `, 'bitcoin')).toEqual({ ok: true, address: TB1 });
    expect(checkRecipientAddress(EVM, 'ethereum')).toEqual({ ok: true, address: EVM });
  });

  it('strips payment URIs people paste', () => {
    expect(addressFromPaymentText(`bitcoin:${TB1}?amount=0.001`)).toBe(TB1);
    expect(addressFromPaymentText(`ethereum:${EVM}@11155111`)).toBe(EVM);
    expect(checkRecipientAddress(`bitcoin:${TB1}`, 'bitcoin')).toEqual({ ok: true, address: TB1 });
  });

  it('pays the payee of an EIP-681 USD₮ transfer, never the token contract', () => {
    const transfer = `ethereum:${SEPOLIA_USDT}@11155111/transfer?address=${EVM}&uint256=1000000`;
    expect(checkRecipientAddress(transfer, 'ethereum')).toEqual({ ok: true, address: EVM });
    expect(addressFromPaymentText(transfer)).toBe(EVM);
    expect(checkRecipientAddress(`ethereum:${SEPOLIA_USDT}/transfer?uint256=1`, 'ethereum')).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  it('refuses EIP-681 codes for other networks, tokens or functions', () => {
    expect(checkRecipientAddress(`ethereum:${EVM}@1`, 'ethereum')).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(checkRecipientAddress(`ethereum:${OTHER_TOKEN}@11155111/transfer?address=${EVM}`, 'ethereum')).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(checkRecipientAddress(`ethereum:${SEPOLIA_USDT}/approve?address=${EVM}`, 'ethereum')).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  it('refuses the token and faucet contracts as recipients', () => {
    expect(checkRecipientAddress(SEPOLIA_USDT, 'ethereum')).toMatchObject({ ok: false, reason: 'contract' });
    expect(checkRecipientAddress(SEPOLIA_USDT.toLowerCase(), 'ethereum')).toMatchObject({ ok: false, reason: 'contract' });
    expect(checkRecipientAddress(`ethereum:${AAVE_SEPOLIA_FAUCET}`, 'ethereum')).toMatchObject({ ok: false, reason: 'contract' });
  });

  it('refuses mainnet Bitcoin addresses', () => {
    for (const mainnet of ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy']) {
      expect(checkRecipientAddress(mainnet, 'bitcoin')).toMatchObject({ ok: false, reason: 'mainnet' });
    }
  });

  it('names the right asset when the address is for the other chain', () => {
    expect(checkRecipientAddress(EVM, 'bitcoin')).toMatchObject({ ok: false, reason: 'wrong-chain', message: expect.stringContaining('USD₮') });
    expect(checkRecipientAddress(TB1, 'ethereum')).toMatchObject({ ok: false, reason: 'wrong-chain', message: expect.stringContaining('Bitcoin') });
  });

  it('explains other inputs', () => {
    expect(checkRecipientAddress('', 'bitcoin')).toMatchObject({ ok: false, reason: 'empty' });
    expect(checkRecipientAddress(PUBKY, 'ethereum')).toMatchObject({ ok: false, reason: 'pubky' });
    expect(checkRecipientAddress('bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', 'bitcoin')).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(checkRecipientAddress('0x123', 'ethereum')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkRecipientAddress('hello', 'bitcoin')).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('checkAffordable', () => {
  it('flags an amount above the balance', () => {
    expect(checkAffordable({ asset: 'usdt', amount: 5_000_000n, balances: { usdt: 4_200_000n, eth: 10n ** 15n } })).toEqual({
      kind: 'balance',
      message: 'Not enough USD₮. You have 4.20 USD₮.',
    });
  });

  it('flags a BTC amount that fits only without the fee', () => {
    const problem = checkAffordable({ asset: 'btc', amount: 9_900n, fee: 141n, balances: { btc: 10_000n } });
    expect(problem?.kind).toBe('balance');
    expect(problem?.message).toContain('141 sats');
  });

  it('says "Not enough ETH for gas" for a USD₮ send with no ETH', () => {
    const problem = checkAffordable({ asset: 'usdt', amount: 1_000_000n, balances: { usdt: 5_000_000n, eth: 0n } });
    expect(problem).toEqual({ kind: 'gas', message: expect.stringMatching(/^Not enough ETH for gas\. You have 0 ETH\./) });
  });

  it('says "Not enough ETH for gas" when the quoted fee is above the ETH balance', () => {
    const problem = checkAffordable({ asset: 'usdt', amount: 1_000_000n, fee: 2_000n, balances: { usdt: 5_000_000n, eth: 1_000n } });
    expect(problem?.kind).toBe('gas');
    expect(problem?.message).toContain('The network fee is less than 0.000001 ETH');
  });

  it('passes a send that fits, including while balances are still loading', () => {
    expect(checkAffordable({ asset: 'usdt', amount: 1n, fee: 10n, balances: { usdt: 1n, eth: 10n } })).toBeUndefined();
    expect(checkAffordable({ asset: 'btc', amount: 1_000n, balances: {} })).toBeUndefined();
    expect(checkAffordable({ asset: 'btc', amount: 0n, balances: {} })?.kind).toBe('amount');
  });
});

describe('formatFee', () => {
  it('shows BTC fees in sats and tiny ETH fees as "less than"', () => {
    expect(formatFee(141n, 'btc')).toBe('141 sats');
    expect(formatFee(1n, 'btc')).toBe('1 sat');
    expect(formatFee(1_045_000n, 'eth')).toBe('less than 0.000001 ETH');
    expect(formatFee(2_100_000_000_000n, 'eth')).toBe('0.000002 ETH');
    expect(formatFee(0n, 'eth')).toBe('0 ETH');
  });
});

describe('sendErrorMessage', () => {
  it('maps WDK errors to plain words and never echoes them', () => {
    expect(sendErrorMessage(new Error('The amount must be bigger than the dust limit (= 294).'), 'btc')).toBe(
      'That amount is too small to send. Send at least 295 sats.',
    );
    expect(sendErrorMessage(new Error('No unspent outputs available.'), 'btc')).toContain('Not enough BTC');
    expect(sendErrorMessage(new Error('insufficient funds for intrinsic transaction cost'), 'usdt')).toBe('Not enough ETH for gas.');
    expect(sendErrorMessage(new Error('execution reverted: ERC20: transfer amount exceeds balance'), 'usdt')).toBe('Not enough USD₮.');
    expect(sendErrorMessage(new Error('bad address checksum'), 'usdt')).toContain('checksum');
    expect(sendErrorMessage(new Error('CALL_EXCEPTION 0xdeadbeef'), 'usdt')).not.toContain('CALL_EXCEPTION');
  });
});

describe('Mutinynet API parsing', () => {
  it('reads the next-block fee rate, at least 1 sat/vB', () => {
    expect(parseRecommendedFeeRate({ fastestFee: 3, halfHourFee: 2 })).toBe(3n);
    expect(parseRecommendedFeeRate({ fastestFee: 1.03 })).toBe(2n);
    expect(parseRecommendedFeeRate({ fastestFee: 0 })).toBeUndefined();
    expect(parseRecommendedFeeRate(null)).toBeUndefined();
  });

  it('reads a transaction status with its block time in ms', () => {
    expect(parseTransactionStatus({ confirmed: true, block_height: 10, block_time: 1_700_000_000 })).toEqual({
      confirmed: true,
      blockHeight: 10,
      blockTime: 1_700_000_000_000,
    });
    expect(parseTransactionStatus({ confirmed: false })).toEqual({ confirmed: false, blockHeight: undefined, blockTime: undefined });
    expect(parseTransactionStatus('nope')).toBeUndefined();
  });
});
