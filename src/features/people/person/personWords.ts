// Sentences for a person's page, the Add person preview and the Send
// review: what they accept publicly, and the private lists each way.
//
// Only Bitcoin is private. Each contact gets their own Bitcoin account, so
// an address in a private list is known to that one person. USD₮ has one
// EVM account, the same address everyone pays (src/paykit/addressCache.ts),
// so the words never call a USD₮ address private.
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

/** Which assets a private list carries, in words that keep Bitcoin (private) and USD₮ (one address for everyone) apart. */
function privateListText(assets: readonly ('btc' | 'usdt')[], whose: 'their' | 'your', who: 'you' | 'them'): string {
  const btc = assets.includes('btc') ? `${ASSETS.btc.displayName}, only for ${who}.` : '';
  const usdt = assets.includes('usdt') ? `${ASSETS.usdt.displayName} at ${whose} one address for everyone.` : '';
  return [btc, usdt].filter(Boolean).join(' ');
}

function assetsIn(addresses: PayeeAddresses): ('btc' | 'usdt')[] {
  return (['btc', 'usdt'] as const).filter((asset) => addresses[asset] !== undefined);
}

/** "Private addresses shared with you": what they sent us over the link. */
export function incomingListWords(linkState: LinkState, incoming: IncomingList | undefined, name: string): ListWords {
  if (linkState !== 'linked') return { text: 'Shared once you are connected privately.', ready: false };
  const assets = incoming ? assetsIn(incoming.addresses) : [];
  if (assets.length > 0) {
    return {
      text: privateListText(assets, 'their', 'you'),
      hint: assets.includes('btc') ? `${name} can see which Bitcoin payments came from you.` : undefined,
      ready: true,
    };
  }
  return { text: incoming ? `None from ${name} right now.` : 'Checking…', ready: false };
}

/** The Send review's line for an address from their private list. */
export function privateAddressWords(asset: string, name: string): string {
  if (asset === 'btc') return `A Bitcoin address ${name} shared only with you. Nobody else knows it is theirs.`;
  return `${name}'s ${ASSETS.usdt.displayName} address. It is the same one everyone pays, so this payment is not private.`;
}

/** Pay by pubky, private route: what their list lets you pay. */
export function privateRouteWords(assets: readonly ('btc' | 'usdt')[], name: string): string {
  const btc = assets.includes('btc');
  const usdt = assets.includes('usdt');
  if (btc && usdt) return `${name} shared a Bitcoin address only with you, and their ${ASSETS.usdt.displayName} address, which is the same for everyone.`;
  if (btc) return `${name} shared a Bitcoin address only with you.`;
  if (usdt) return `${name} shared their ${ASSETS.usdt.displayName} address, which is the same for everyone.`;
  return 'Accepts nothing by pubky';
}

/** "Your private addresses shared with them": whether our list reached them. */
export function outgoingListWords(linkState: LinkState, outgoing: OutgoingListStatus | undefined): ListWords {
  if (linkState !== 'linked') return { text: 'Shared once you are connected privately.', ready: false };
  switch (outgoing?.state) {
    case 'shared':
      return {
        text: privateListText(outgoing.assets, 'your', 'them'),
        hint: outgoing.assets.includes('btc') ? 'Their Bitcoin payments to you land in your own Bitcoin account for them.' : undefined,
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
