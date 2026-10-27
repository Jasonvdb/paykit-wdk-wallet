// What the indexers leave out of activity: Bitcoin block times and the fee
// of a USD₮ send.
import { SEPOLIA_USDT } from '../../config/chains';
import { blockscoutSentFees, mergeActivity, missingBlockTimes, parseBlockscoutTokenTransfers, withBlockTimes, type ActivityItem } from '../activity';

const ME = '0x00000000000000000000000000000000000000aa';

const btc: ActivityItem = {
  id: 'bitcoin:aa:out:0:0',
  chain: 'bitcoin',
  asset: 'btc',
  direction: 'out',
  amount: 10_000n,
  hash: 'aa',
  blockHeight: 100,
  status: 'confirmed',
  accountIndex: 0,
};

const usdtIn: ActivityItem = {
  id: 'ethereum:0x2:usdt:0',
  chain: 'ethereum',
  asset: 'usdt',
  direction: 'in',
  amount: 2_000_000n,
  hash: '0x2',
  timestamp: 1_000,
  status: 'confirmed',
  accountIndex: 0,
};

describe('Bitcoin block times', () => {
  it('sorts a confirmed Bitcoin item by its block time once known', () => {
    // Without a time, the newer Bitcoin send sorts below the older USD₮ receive.
    expect(mergeActivity([[btc], [usdtIn]], []).map((item) => item.hash)).toEqual(['0x2', 'aa']);
    const times = new Map([['aa', 2_000]]);
    expect(mergeActivity([withBlockTimes([btc], times), [usdtIn]], []).map((item) => item.hash)).toEqual(['aa', '0x2']);
  });

  it('asks only for confirmed Bitcoin items it has no time for, once each', () => {
    const pending = { ...btc, id: 'p', hash: 'bb', status: 'pending' as const, blockHeight: 0 };
    const twice = { ...btc, id: 'second-output' };
    expect(missingBlockTimes([btc, twice, pending, usdtIn], new Map())).toEqual(['aa']);
    expect(missingBlockTimes([btc], new Map([['aa', 1]]))).toEqual([]);
  });

  it('leaves pending and Ethereum items alone', () => {
    const pending = { ...btc, status: 'pending' as const };
    const times = new Map([['aa', 5], ['0x2', 7]]);
    expect(withBlockTimes([pending, usdtIn], times)).toEqual([pending, usdtIn]);
  });
});

describe('what a local send record adds to the indexed item', () => {
  const localBtc: ActivityItem = { ...btc, id: 'bitcoin:aa:local:btc', status: 'pending', fee: 141n, timestamp: 3_000, blockHeight: undefined };

  it('keeps the send time and fee until the indexer reports them', () => {
    const [merged] = mergeActivity([[btc]], [localBtc]);
    expect(merged).toMatchObject({ id: btc.id, status: 'confirmed', timestamp: 3_000, fee: 141n });
  });

  it("prefers the indexer's own values", () => {
    const [merged] = mergeActivity([[{ ...btc, timestamp: 2_500, fee: 150n }]], [localBtc]);
    expect(merged).toMatchObject({ timestamp: 2_500, fee: 150n });
  });

  it('puts no fee on the receiving side of the same transaction (a Collect)', () => {
    const received = { ...btc, id: 'bitcoin:aa:in:0:0', direction: 'in' as const };
    const merged = mergeActivity([[received]], [localBtc]);
    expect(merged[0].fee).toBeUndefined();
    expect(merged[0].timestamp).toBe(3_000);
  });
});

describe('USD₮ send fees from Blockscout', () => {
  const transactions = {
    items: [
      { hash: '0xAB', from: { hash: ME }, to: { hash: SEPOLIA_USDT }, value: '0', fee: { value: '129966' } },
      { hash: '0xcd', from: { hash: '0xother' }, to: { hash: ME }, value: '5', fee: { value: '1' } },
    ],
  };

  it('collects the fee of each transaction the owner sent', () => {
    expect(blockscoutSentFees(transactions, ME)).toEqual(new Map([['0xab', 129_966n]]));
    expect(blockscoutSentFees(null, ME).size).toBe(0);
  });

  it('puts it on the USD₮ transfer the owner sent', () => {
    const items = parseBlockscoutTokenTransfers(
      {
        items: [
          { transaction_hash: '0xab', from: { hash: ME }, to: { hash: '0xbb' }, total: { value: '2000000' }, token: { address_hash: SEPOLIA_USDT } },
          { transaction_hash: '0xcd', from: { hash: '0xother' }, to: { hash: ME }, total: { value: '1' }, token: { address_hash: SEPOLIA_USDT } },
        ],
      },
      ME,
      blockscoutSentFees(transactions, ME),
    );
    expect(items.map((item) => item.fee)).toEqual([129_966n, undefined]);
  });
});
