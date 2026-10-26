import { AAVE_FAUCET_MINT_SELECTOR, AAVE_SEPOLIA_FAUCET, SEPOLIA_USDT } from '../../config/chains';
import { mergeActivity, newestItems, parseBlockscoutTokenTransfers, parseBtcTransfers, type ActivityItem } from '../activity';
import { chainOfAddress, isBtcTestnetAddress, isEvmAddress } from '../addressFormat';
import { encodeFaucetMint, isAllowedContractCall, usdtFaucetTransaction } from '../faucet';

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

  it('keeps the newest BTC transfers from the oldest-first WDK list', () => {
    // WDK order: confirmed by height (oldest first), then the mempool.
    const items = parseBtcTransfers(
      [
        { txid: 'old', address: 'tb1q', vout: 0, height: 5, value: '1', direction: 'incoming' },
        { txid: 'mid', address: 'tb1q', vout: 0, height: 9, value: '2', direction: 'incoming' },
        { txid: 'new', address: 'tb1q', vout: 0, height: 12, value: '3', direction: 'incoming' },
        { txid: 'mempool', address: 'tb1q', vout: 0, height: 0, value: '4', direction: 'incoming' },
      ],
      0,
    );
    expect(newestItems(items, 2).map((item) => item.hash)).toEqual(['mempool', 'new']);
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

describe('isAllowedContractCall', () => {
  const ME = '0x83A881Ddad0F675A3d57d306F3F4E6b352b95CD0';
  it('allows only the faucet mint with no ETH attached', () => {
    const mint = usdtFaucetTransaction(ME);
    expect(isAllowedContractCall(mint)).toBe(true);
    expect(isAllowedContractCall({ ...mint, value: '1' })).toBe(false);
    expect(isAllowedContractCall({ ...mint, to: ME })).toBe(false);
    // ERC-20 approve(spender, max) aimed at the faucet address: wrong selector.
    expect(isAllowedContractCall({ ...mint, data: `0x095ea7b3${'0'.repeat(128)}` })).toBe(false);
    expect(isAllowedContractCall({ ...mint, data: `${mint.data}00` })).toBe(false);
  });
});
