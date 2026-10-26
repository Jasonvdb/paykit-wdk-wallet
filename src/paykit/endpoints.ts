// Payment endpoint payloads for our two rails, as plain data.
//
// Paykit treats a payload as opaque UTF-8 text; the meaning is agreed between
// wallets per Payment Endpoint Identifier. Ours (see src/config/paykit.ts):
//
//   btc-mutinynet-p2wpkh   {"value":"tb1q..."}
//   usdt-sepolia-address   {"value":"0x...","chain_id":"11155111","token":"0xaA8E..."}
//
// Keep payloads compact: every private message, including a whole Private
// Payment List, must fit in 1000 bytes. Both payloads together are about
// 160 bytes.
//
// Incoming payloads come from other people, so they are parsed defensively:
// a USD₮ endpoint must name Sepolia and the exact token contract we hold,
// otherwise we refuse to pay it. This file has no native imports and is
// unit tested.
import { SEPOLIA_CHAIN_ID, SEPOLIA_USDT } from '../config/chains';
import { ENDPOINT_BTC, ENDPOINT_USDT, SUPPORTED_ENDPOINTS } from '../config/paykit';
import { isBtcTestnetAddress, isEvmAddress, sameEvmAddress } from '../wallet/addressFormat';

/** Paykit's limit for one private message (a whole Private Payment List included). */
export const PRIVATE_MESSAGE_LIMIT_BYTES = 1000;

/** An endpoint to publish or share: identifier plus payload text. */
export type ReceivingDetail = { identifier: string; payload: string };

/** A payable endpoint we understood. */
export type ParsedEndpoint =
  | { identifier: typeof ENDPOINT_BTC; asset: 'btc'; address: string }
  | { identifier: typeof ENDPOINT_USDT; asset: 'usdt'; address: string; chainId: string; token: string };

export function btcReceivingDetail(address: string): ReceivingDetail {
  return { identifier: ENDPOINT_BTC, payload: JSON.stringify({ value: address }) };
}

export function usdtReceivingDetail(address: string): ReceivingDetail {
  return {
    identifier: ENDPOINT_USDT,
    payload: JSON.stringify({ value: address, chain_id: String(SEPOLIA_CHAIN_ID), token: SEPOLIA_USDT }),
  };
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Parse and check a payload for one of our identifiers. Undefined means "cannot pay this". */
export function parseEndpoint(identifier: string, payloadText: string): ParsedEndpoint | undefined {
  const json = parseJsonObject(payloadText);
  if (!json || typeof json.value !== 'string') return undefined;
  if (identifier === ENDPOINT_BTC) {
    return isBtcTestnetAddress(json.value) ? { identifier, asset: 'btc', address: json.value } : undefined;
  }
  if (identifier === ENDPOINT_USDT) {
    const chainId = String(json.chain_id ?? '');
    const token = typeof json.token === 'string' ? json.token : '';
    const ok =
      isEvmAddress(json.value) && chainId === String(SEPOLIA_CHAIN_ID) && isEvmAddress(token) && sameEvmAddress(token, SEPOLIA_USDT);
    return ok ? { identifier, asset: 'usdt', address: json.value, chainId, token } : undefined;
  }
  return undefined;
}

/** The canonical payload text for a parsed endpoint (what we hand back to Paykit as a payment target). */
export function canonicalPayload(endpoint: ParsedEndpoint): string {
  return endpoint.asset === 'btc'
    ? btcReceivingDetail(endpoint.address).payload
    : JSON.stringify({ value: endpoint.address, chain_id: endpoint.chainId, token: SEPOLIA_USDT });
}

/**
 * From a peer's endpoint candidates, the ids we can pay, in our preference
 * order (USD₮ first, then BTC). Candidates with payloads we do not accept
 * are dropped.
 */
export function payableCandidateIds(
  candidates: readonly { candidateId: string; identifier: string; payloadText: string }[],
): string[] {
  return SUPPORTED_ENDPOINTS.flatMap((identifier) =>
    candidates
      .filter((c) => c.identifier === identifier && parseEndpoint(c.identifier, c.payloadText) !== undefined)
      .map((c) => c.candidateId),
  );
}

/** UTF-8 byte length, to check payloads against PRIVATE_MESSAGE_LIMIT_BYTES. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
