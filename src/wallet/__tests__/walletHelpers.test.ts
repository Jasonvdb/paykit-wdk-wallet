import { AAVE_FAUCET_MINT_SELECTOR, AAVE_SEPOLIA_FAUCET, SEPOLIA_USDT } from '../../config/chains';
import { mergeActivity, parseBlockscoutTokenTransfers, parseBtcTransfers, type ActivityItem } from '../activity';
import { chainOfAddress, isBtcTestnetAddress, isEvmAddress } from '../addressFormat';
import { encodeFaucetMint, usdtFaucetTransaction } from '../faucet';
import { arrayBufferToBase64, base64ToArrayBuffer } from '../../paykit/bytes';
import { middleEllipsis } from '../../ui/format';

const ME = '0x00000000000000000000000000000000000000aa';

describe('address format checks', () => {
  it('accepts testnet bech32 and EVM addresses only', () => {
    expect(isBtcTestnetAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(true);
    expect(isBtcTestnetAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(false);
    expect(isEvmAddress(ME)).toBe(true);
    expect(isEvmAddress('0x123')).toBe(false);
    expect(chainOfAddress(ME)).toBe('ethereum');
    expect(chainOfAddress('hello')).toBeUndefined();
  });
});

describe('faucet call data', () => {
  it('encodes mint(token, to, amount) as selector + three words', () => {
    const data = encodeFaucetMint(SEPOLIA_USDT, ME, 1_000_000_000n);
    expect(data.startsWith(AAVE_FAUCET_MINT_SELECTOR)).toBe(true);
    expect(data).toHaveLength(10 + 3 * 64);
    expect(data.slice(10, 74)).toBe(SEPOLIA_USDT.slice(2).toLowerCase().padStart(64, '0'));
    expect(data.slice(74, 138)).toBe(ME.slice(2).padStart(64, '0'));
    expect(BigInt('0x' + data.slice(138))).toBe(1_000_000_000n);
  });

  it('refuses amounts above the faucet limit', () => {
    expect(() => encodeFaucetMint(SEPOLIA_USDT, ME, 10_001n * 10n ** 6n)).toThrow();
    expect(() => encodeFaucetMint(SEPOLIA_USDT, ME, 0n)).toThrow();
  });

  it('targets the Aave faucet with zero value', () => {
    expect(usdtFaucetTransaction(ME)).toMatchObject({ to: AAVE_SEPOLIA_FAUCET, value: '0' });
  });
});

describe('activity parsing', () => {
  it('parses WDK BTC transfers (bigints arrive as strings)', () => {
    const items = parseBtcTransfers(
      [
        { txid: 'aa', address: 'tb1q', vout: 0, height: 0, value: '1500', direction: 'incoming' },
        { txid: 'bb', address: 'tb1q', vout: 1, height: 10, value: '700', direction: 'outgoing', fee: '141', recipient: 'tb1qx' },
      ],
      0,
    );
    expect(items[0]).toMatchObject({ direction: 'in', amount: 1500n, status: 'pending' });
    expect(items[1]).toMatchObject({ direction: 'out', amount: 700n, fee: 141n, counterpartyAddress: 'tb1qx', status: 'confirmed' });
  });

  it('keeps only USD₮ token transfers and detects direction', () => {
    const items = parseBlockscoutTokenTransfers(
      {
        items: [
          { transaction_hash: '0x1', from: { hash: ME }, to: { hash: '0xbb' }, total: { value: '5000000' }, token: { address_hash: SEPOLIA_USDT } },
          { transaction_hash: '0x2', from: { hash: '0xcc' }, to: { hash: ME }, total: { value: '1' }, token: { address_hash: '0xother' } },
        ],
      },
      ME,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ asset: 'usdt', direction: 'out', amount: 5_000_000n });
  });

  it('merges local sends until an indexer reports the same hash', () => {
    const local: ActivityItem = {
      id: 'ethereum:0x1:local:usdt',
      chain: 'ethereum',
      asset: 'usdt',
      direction: 'out',
      amount: 1n,
      hash: '0x1',
      status: 'pending',
      accountIndex: 0,
      timestamp: 1,
    };
    expect(mergeActivity([[]], [local])).toEqual([local]);
    const indexed = { ...local, id: 'ethereum:0x1:usdt:0', status: 'confirmed' as const };
    expect(mergeActivity([[indexed]], [local])).toEqual([indexed]);
  });
});

describe('small helpers', () => {
  it('shortens long keys in the middle', () => {
    expect(middleEllipsis('pubky8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo')).toBe('pubky8pinx…435ewo');
    expect(middleEllipsis('short')).toBe('short');
  });

  it('round-trips base64', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'hello world!']) {
      const bytes = new TextEncoder().encode(text);
      const encoded = arrayBufferToBase64(bytes.buffer);
      expect(encoded).toBe(Buffer.from(text).toString('base64'));
      expect(new TextDecoder().decode(base64ToArrayBuffer(encoded))).toBe(text);
    }
  });
});
