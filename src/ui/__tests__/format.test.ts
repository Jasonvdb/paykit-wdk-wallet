import { formatDateTime, middleEllipsis } from '../format';

describe('middleEllipsis', () => {
  it('shortens long keys in the middle', () => {
    expect(middleEllipsis('pubky8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo')).toBe('pubky8pinx…435ewo');
    expect(middleEllipsis('short')).toBe('short');
  });
});

describe('formatDateTime', () => {
  it('shows month, day, year and a 24-hour time', () => {
    const text = formatDateTime(Date.UTC(2026, 9, 26, 12, 0));
    expect(text).toMatch(/^Oct 2[5-7], 2026, \d{2}:\d{2}$/);
  });
});
