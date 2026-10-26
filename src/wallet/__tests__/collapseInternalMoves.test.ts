// A Collect is one transaction seen from two accounts; Activity shows it once.
import { collapseInternalMoves, type ActivityItem } from '../activity';

const item = (patch: Partial<ActivityItem>): ActivityItem => ({
  id: `bitcoin:${patch.hash}:${patch.direction}:0:${patch.accountIndex}`,
  chain: 'bitcoin',
  asset: 'btc',
  direction: 'in',
  amount: 1000n,
  hash: 'h1',
  status: 'confirmed',
  accountIndex: 0,
  ...patch,
});

describe('collapseInternalMoves', () => {
  it('keeps the account-0 receive and marks where it came from', () => {
    const out = item({ hash: 'h1', direction: 'out', accountIndex: 2 });
    const into = item({ hash: 'h1', direction: 'in', accountIndex: 0 });
    const other = item({ hash: 'h2', direction: 'in', accountIndex: 2 });
    const result = collapseInternalMoves([out, into, other]);
    expect(result).toHaveLength(2);
    expect(result.find((i) => i.hash === 'h1')).toMatchObject({ direction: 'in', accountIndex: 0, movedFromAccount: 2 });
    expect(result.find((i) => i.hash === 'h2')?.movedFromAccount).toBeUndefined();
  });

  it('leaves a move whose receive is not listed yet', () => {
    const out = item({ hash: 'h1', direction: 'out', accountIndex: 2 });
    expect(collapseInternalMoves([out])).toEqual([out]);
  });
});
