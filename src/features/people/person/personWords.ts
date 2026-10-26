// Sentences for a person's page and the Add person preview: what they
// accept publicly, and the state of the private lists in each direction.
// Pure; unit tested.
import type { IncomingList, LinkState, OutgoingListStatus, PayeeAddresses, PublicPaymentOptions } from '../../../paykit';
import { ASSETS } from '../../../wallet/assets';

function assetList(addresses: PayeeAddresses): string {
  return (['btc', 'usdt'] as const)
    .filter((asset) => addresses[asset] !== undefined)
    .map((asset) => ASSETS[asset].displayName)
    .join(' and ');
}

/** What anyone can pay them in, by their pubky. */
export function publicAcceptsWords(options: PublicPaymentOptions, name: string): string {
  const assets = assetList(options.addresses);
  if (assets) return `Accepts ${assets} from anyone, by pubky.`;
  if (!options.hasPaymentApp) return `${name} hasn't set up a wallet that takes payments by pubky yet.`;
  if (options.status === 'unavailable') return `Couldn't load what ${name} accepts right now.`;
  return `${name} doesn't publish payment addresses for everyone.`;
}

export type ListWords = { text: string; hint?: string; ready: boolean };

/** "Private addresses shared with you": what they sent us over the link. */
export function incomingListWords(linkState: LinkState, incoming: IncomingList | undefined, name: string): ListWords {
  if (linkState !== 'linked') return { text: 'Shared once you are connected privately.', ready: false };
  const assets = incoming ? assetList(incoming.addresses) : '';
  if (assets) return { text: `${assets}, only for you.`, hint: `${name} can see which payments came from you.`, ready: true };
  return { text: incoming ? `${name} hasn't shared any yet.` : 'Checking…', ready: false };
}

/** "Your private addresses shared with them": whether our list reached them. */
export function outgoingListWords(linkState: LinkState, outgoing: OutgoingListStatus | undefined): ListWords {
  if (linkState !== 'linked') return { text: 'Shared once you are connected privately.', ready: false };
  switch (outgoing?.state) {
    case 'shared':
      return {
        text: `${outgoing.assets.map((asset) => ASSETS[asset].displayName).join(' and ')}, only for them.`,
        hint: 'Their payments to you land in your own Bitcoin account for them.',
        ready: true,
      };
    case 'failed':
      return { text: "Couldn't share them yet. We'll keep trying.", ready: false };
    case 'waiting-for-address':
      return { text: 'Preparing your Bitcoin address for them…', ready: false };
    default:
      return { text: 'Sharing…', ready: false };
  }
}
