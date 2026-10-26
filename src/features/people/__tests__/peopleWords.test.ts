// The People list order and the sentences on a person's page.
import { sortContacts } from '../contactOrder';
import { incomingListWords, outgoingListWords, publicAcceptsWords } from '../person/personWords';

describe('sortContacts', () => {
  it('puts private connections first, then by name', () => {
    const sorted = sortContacts([
      { name: 'zed', linkState: 'waiting' as const },
      { name: 'Bea', linkState: 'linked' as const },
      { name: 'amy', linkState: 'linked' as const },
      { name: 'Cal', linkState: 'connecting' as const },
      { name: 'Dee', linkState: 'unreachable' as const },
    ]);
    expect(sorted.map((c) => c.name)).toEqual(['amy', 'Bea', 'Cal', 'zed', 'Dee']);
  });
});

describe('person words', () => {
  const options = { publicKey: 'k', status: 'payable' as const, hasPaymentApp: true, addresses: { btc: 'tb1q', usdt: '0x' }, failedApps: 0 };

  it('says what they accept publicly', () => {
    expect(publicAcceptsWords(options, 'Ben')).toBe('Accepts Bitcoin and USD₮ from anyone, by pubky.');
    expect(publicAcceptsWords({ ...options, addresses: {}, hasPaymentApp: false }, 'Ben')).toBe("Ben hasn't set up a wallet that takes payments by pubky yet.");
    expect(publicAcceptsWords({ ...options, addresses: {}, status: 'no-endpoint' }, 'Ben')).toBe("Ben doesn't publish payment addresses for everyone.");
  });

  it('describes private lists both ways', () => {
    expect(incomingListWords('waiting', undefined, 'Ben').text).toBe('Shared once you are connected privately.');
    expect(incomingListWords('linked', undefined, 'Ben').text).toBe('Checking…');
    expect(incomingListWords('linked', { addresses: { btc: 'tb1q' }, loadedAt: 1 }, 'Ben')).toMatchObject({ text: 'Bitcoin, only for you.', ready: true });
    expect(incomingListWords('linked', { addresses: {}, loadedAt: 1 }, 'Ben').text).toBe("Ben hasn't shared any yet.");

    expect(outgoingListWords('linked', { state: 'shared', at: 1, assets: ['btc', 'usdt'] })).toMatchObject({ text: 'Bitcoin and USD₮, only for them.', ready: true });
    expect(outgoingListWords('linked', { state: 'waiting-for-address' }).text).toBe('Preparing your Bitcoin address for them…');
    expect(outgoingListWords('linked', { state: 'failed', at: 1 }).text).toBe("Couldn't share them yet. We'll keep trying.");
    expect(outgoingListWords('connecting', undefined).text).toBe('Shared once you are connected privately.');
  });
});
