import { middleEllipsis } from '../format';

describe('middleEllipsis', () => {
  it('shortens long keys in the middle', () => {
    expect(middleEllipsis('pubky8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo')).toBe('pubky8pinx…435ewo');
    expect(middleEllipsis('short')).toBe('short');
  });
});
