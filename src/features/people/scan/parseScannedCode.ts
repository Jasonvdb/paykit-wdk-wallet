// What a scanned (or pasted) code means, and where it should take you.
//
//   pubky, pk:<key>, paykitwdk://contact?pubky=<key>   -> Add person
//   tb1… or bitcoin:tb1…?amount=…                       -> Send Bitcoin
//   0x… or ethereum:0x…[@11155111]                      -> Send USD₮
//   ethereum:<USD₮ token>@11155111/transfer?address=0x… -> Send USD₮ to that address
//   paykitwdk://send?to=<pubky or address>&asset=…     -> Send
//
// A QR code is untrusted input: anyone can print one. So this parser
// accepts only those shapes, refuses everything else with a plain message,
// caps the length, and never treats a token contract as a recipient (an
// EIP-681 token transfer names the token first and the payee in
// `address=`). Amounts in payment URIs are ignored: the person types the
// amount and reviews the fee before anything is sent.
//
// It only checks shapes. A pubky is validated for real by the SDK
// (PaykitService.normalizeKey) before Add person, and Send re-checks
// addresses against the chosen asset. Pure; unit tested.
import { SEPOLIA_CHAIN_ID, SEPOLIA_USDT } from '../../../config/chains';
import { pubkyFromText } from '../../../paykit/keys';
import { checkRecipientAddress, isBtcTestnetAddress, isEvmAddress, sameEvmAddress } from '../../../wallet/addressFormat';

export type ScannedAsset = 'btc' | 'usdt';

export type ScannedCode =
  /** A person: open Add person. `pubky` is shape-checked only. */
  | { kind: 'person'; pubky: string }
  /** Pay: open Send with `to` (an address or a pubky) filled in. */
  | { kind: 'pay'; to: string; asset?: ScannedAsset }
  | { kind: 'unsupported'; message: string };

/** Longer than any pubky link or payment URI this app reads. */
export const MAX_CODE_LENGTH = 2048;

const NOT_SUPPORTED = "This code isn't a pubky or a test-network payment address.";

function unsupported(message = NOT_SUPPORTED): ScannedCode {
  return { kind: 'unsupported', message };
}

/** Query parameters of `a=1&b=2`, decoded. Repeated keys keep the first value. */
function queryParams(query: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const part of query.split('&')) {
    const [rawKey, ...rest] = part.split('=');
    if (!rawKey) continue;
    try {
      const key = decodeURIComponent(rawKey);
      if (!params.has(key)) params.set(key, decodeURIComponent(rest.join('=')));
    } catch {
      // Malformed percent-encoding: skip the parameter.
    }
  }
  return params;
}

function assetParam(value: string | undefined): ScannedAsset | undefined {
  return value === 'btc' || value === 'usdt' ? value : undefined;
}

/** A paykitwdk://send link: `to` must be a pubky or one of our addresses. */
function parseSendLink(query: string): ScannedCode {
  const params = queryParams(query);
  const to = params.get('to')?.trim() ?? '';
  const asset = assetParam(params.get('asset'));
  const pubky = pubkyFromText(to);
  if (pubky) return { kind: 'pay', to: pubky, asset };
  if (isBtcTestnetAddress(to)) return asset === 'usdt' ? unsupported('That link asks for USD₮ but holds a Bitcoin address.') : { kind: 'pay', to, asset: 'btc' };
  if (isEvmAddress(to)) return asset === 'btc' ? unsupported('That link asks for Bitcoin but holds an Ethereum address.') : { kind: 'pay', to, asset: 'usdt' };
  return unsupported('That payment link has no pubky or address in it.');
}

/** ethereum:… (EIP-681): a plain address, or a token transfer of our USD₮. */
function parseEthereumUri(rest: string): ScannedCode {
  // ethereum:<target>[@chainId][/function][?params]
  const match = /^(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:\/([A-Za-z]+))?(?:\?(.*))?$/.exec(rest);
  if (!match) return unsupported('That Ethereum code is not an address this wallet can pay.');
  const [, target = '', chainId, fn, query = ''] = match;
  if (chainId !== undefined && chainId !== String(SEPOLIA_CHAIN_ID)) {
    return unsupported('That code is for another Ethereum network. This wallet pays on Sepolia only.');
  }
  if (fn === undefined) return { kind: 'pay', to: target, asset: 'usdt' };
  if (fn !== 'transfer' || !sameEvmAddress(target, SEPOLIA_USDT)) {
    return unsupported('That code asks for a token this wallet does not hold. It pays test USD₮ only.');
  }
  const payee = queryParams(query).get('address') ?? '';
  return isEvmAddress(payee) ? { kind: 'pay', to: payee, asset: 'usdt' } : unsupported('That USD₮ request has no address to pay.');
}

export function parseScannedCode(raw: string): ScannedCode {
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (text === '') return unsupported('That code is empty.');
  if (text.length > MAX_CODE_LENGTH) return unsupported('That code is too long to be a pubky or an address.');

  const link = /^paykitwdk:\/\/([a-z]+)\??(.*)$/i.exec(text);
  if (link) {
    const [, route = '', query = ''] = link;
    if (route.toLowerCase() === 'contact') {
      const pubky = pubkyFromText(text);
      return pubky ? { kind: 'person', pubky } : unsupported('That contact link has no valid pubky in it.');
    }
    if (route.toLowerCase() === 'send') return parseSendLink(query);
    return unsupported('That link is not a pay-me code or a payment link.');
  }

  const pubky = pubkyFromText(text);
  if (pubky) return { kind: 'person', pubky };

  const ethereum = /^ethereum:(.*)$/i.exec(text);
  if (ethereum) return parseEthereumUri(ethereum[1] ?? '');

  // bitcoin:… (BIP-21) and bare addresses. checkRecipientAddress strips the
  // URI and says why mainnet or other networks are refused.
  if (isEvmAddress(text)) return { kind: 'pay', to: text, asset: 'usdt' };
  const btc = checkRecipientAddress(text, 'bitcoin');
  if (btc.ok) return { kind: 'pay', to: btc.address, asset: 'btc' };
  if (btc.reason === 'mainnet' || btc.reason === 'unsupported') return unsupported(btc.message);
  return unsupported();
}
