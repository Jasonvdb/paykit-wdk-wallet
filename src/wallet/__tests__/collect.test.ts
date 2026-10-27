// Collect sends the whole contact-account balance, less the fee.
import { collectAmount, isCollectable, MIN_COLLECTABLE_SATS } from '../collect';

describe('collectAmount', () => {
  it('adds the dust change WDK planned to keep back, so nothing stays behind', () => {
    // The first real collect: 10,000 sats, WDK planned 9,559 + 294 change at
    // 1 sat/vB, and the change came back as an uncollectable 300 sats.
    expect(collectAmount({ amount: '9559', fee: '147', changeValue: '294' })).toBe(9853n);
  });

  it('keeps a one-output plan as it is', () => {
    expect(collectAmount({ amount: '459', fee: '141', changeValue: '0' })).toBe(459n);
    expect(collectAmount({ amount: '459' })).toBe(459n);
  });

  it('has nothing to move when WDK reports nothing spendable', () => {
    expect(collectAmount({ amount: '0', fee: '0', changeValue: '0' })).toBeUndefined();
    expect(collectAmount(undefined)).toBeUndefined();
    expect(collectAmount({ amount: 'oops' })).toBeUndefined();
  });
});

describe('isCollectable', () => {
  it('needs more than the dust limit after the minimum fee', () => {
    expect(MIN_COLLECTABLE_SATS).toBe(436n);
    expect(isCollectable(300n)).toBe(false);
    expect(isCollectable(435n)).toBe(false);
    expect(isCollectable(436n)).toBe(true);
    expect(isCollectable(5_000n)).toBe(true);
    expect(isCollectable(undefined)).toBe(false);
  });
});
