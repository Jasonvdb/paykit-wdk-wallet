import type { ActivityItem } from '../../../wallet';
import { activityStatusWords, activityTitle, isFaucetMint } from '../activity/activityText';

const base: ActivityItem = {
  id: 'ethereum:0x1:usdt:0',
  chain: 'ethereum',
  asset: 'usdt',
  direction: 'in',
  amount: 1n,
  hash: '0x1',
  status: 'confirmed',
  accountIndex: 0,
};

describe('activity words', () => {
  it('recognises faucet mints, local or indexed', () => {
    expect(isFaucetMint({ ...base, counterpartyAddress: '0x0000000000000000000000000000000000000000' })).toBe(true);
    expect(isFaucetMint({ ...base, id: 'ethereum:0x1:local:faucet' })).toBe(true);
    expect(isFaucetMint({ ...base, counterpartyAddress: '0x83A881Ddad0F675A3d57d306F3F4E6b352b95CD0' })).toBe(false);
    expect(activityTitle({ ...base, id: 'ethereum:0x1:local:faucet' })).toBe('Test USD₮ minted');
  });

  it('names sends, receipts and collects', () => {
    expect(activityTitle({ ...base, counterpartyAddress: '0xabc' })).toBe('Received');
    expect(activityTitle({ ...base, direction: 'out' })).toBe('Sent');
    expect(activityTitle({ ...base, chain: 'bitcoin', asset: 'btc', direction: 'out', accountIndex: 2 })).toBe('Moved to main account');
  });

  it('describes status', () => {
    expect(activityStatusWords({ ...base, status: 'pending' })).toBe('Pending');
    expect(activityStatusWords(base)).toBe('Confirmed');
    expect(activityStatusWords({ ...base, status: 'failed' })).toBe('Failed');
  });
});
