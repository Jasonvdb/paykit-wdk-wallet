// The `erc20-transfer-eip712` payment proof: an EIP-712 signature that ties
// one ERC-20 Transfer to one Paykit payment request.
//
// Why a signature at all: our USD₮ address is public (it is published as a
// public endpoint and shared with every contact), so anyone can see a
// Transfer to it and claim "that was me". The payer therefore signs a
// statement with the account that sent the tokens: "the Transfer at
// receipt log N of transaction T paid request R from payer P to payee Q".
// The payee recovers the signer and requires it to equal the Transfer's
// `from`. Spec: paykit-rs specs/erc20-payment-proofs.md.
//
// Who does what:
//   payer  builds the typed data here, WDK signs it in its worklet
//          (`signTypedData`, allowed in wdk.config.js for this one domain;
//          `isErc20PaymentTypedData` is the guard every signing call goes
//          through, because an EIP-712 signature over another domain could
//          authorize spending, e.g. an ERC-20 permit)
//   payee  rebuilds the typed data from the request it knows (never from
//          the proof), hashes it and recovers the signer with
//          `erc20PaymentSigner`
//
// The hashing is the standard EIP-712 encoding of these two fixed structs,
// on audited primitives (@noble/hashes keccak, @noble/secp256k1 recovery).
// It is checked against the spec's own test vectors and against ethers in
// src/wallet/__tests__/erc20PaymentProof.test.ts. Pure: no native imports.
import { keccak_256 } from '@noble/hashes/sha3';
import { Signature } from '@noble/secp256k1';

export const ERC20_PROOF_TYPE = 'erc20-transfer-eip712';
export const ERC20_PROOF_DOMAIN_NAME = 'Paykit ERC20 Payment';
export const ERC20_PROOF_DOMAIN_VERSION = '1';

/** The request context the signature binds, from the authenticated link and the immutable request. */
export type Erc20RequestBinding = {
  /** Bare pubky of the payer and payee (no `pubky` prefix). */
  payer: string;
  payee: string;
  paymentAppId: string;
  paymentRequestId: string;
  paymentReference: string;
  paymentEndpointIdentifier: string;
  /** The billing period strings of a recurring proof, or '' for a one-time request. */
  periodStartsAt: string;
  periodEndsAt: string;
  /** '' when no conversion quote was used (this app never uses one). */
  conversionQuoteId: string;
};

export type Erc20PaymentMessage = {
  transactionHash: string;
  /** Position in the transaction receipt's whole `logs` array, as a decimal string. */
  receiptLogIndex: string;
  request: Erc20RequestBinding;
};

/** The typed data in the shape WDK's `signTypedData({ domain, types, message })` takes (ethers style: no EIP712Domain in `types`). */
export type Erc20PaymentTypedData = {
  domain: { name: string; version: string; chainId: number };
  types: typeof ERC20_PAYMENT_TYPES;
  message: Erc20PaymentMessage;
};

export const ERC20_PAYMENT_TYPES = {
  Erc20Payment: [
    { name: 'transactionHash', type: 'bytes32' },
    { name: 'receiptLogIndex', type: 'uint256' },
    { name: 'request', type: 'RequestBinding' },
  ],
  RequestBinding: [
    { name: 'payer', type: 'string' },
    { name: 'payee', type: 'string' },
    { name: 'paymentAppId', type: 'string' },
    { name: 'paymentRequestId', type: 'string' },
    { name: 'paymentReference', type: 'string' },
    { name: 'paymentEndpointIdentifier', type: 'string' },
    { name: 'periodStartsAt', type: 'string' },
    { name: 'periodEndsAt', type: 'string' },
    { name: 'conversionQuoteId', type: 'string' },
  ],
};

const BINDING_FIELDS = ERC20_PAYMENT_TYPES.RequestBinding.map((field) => field.name) as (keyof Erc20RequestBinding)[];

const TX_HASH = /^0x[0-9a-f]{64}$/;
const SIGNATURE = /^0x[0-9a-f]{130}$/;
const UINT256_MAX = 2n ** 256n - 1n;

/** `receipt_log_index` rules: canonical base-10, no sign, no leading zeroes, at most 2^256 - 1. */
export function isCanonicalLogIndex(text: string): boolean {
  return /^(0|[1-9]\d*)$/.test(text) && BigInt(text) <= UINT256_MAX;
}

export function erc20PaymentTypedData(chainId: number, message: Erc20PaymentMessage): Erc20PaymentTypedData {
  return {
    domain: { name: ERC20_PROOF_DOMAIN_NAME, version: ERC20_PROOF_DOMAIN_VERSION, chainId },
    types: ERC20_PAYMENT_TYPES,
    message,
  };
}

/**
 * The signing guard: true only for exactly our proof's domain and types.
 * The wallet refuses to sign anything else with this method.
 */
export function isErc20PaymentTypedData(value: unknown, chainId: number): value is Erc20PaymentTypedData {
  if (!value || typeof value !== 'object') return false;
  const { domain, types, message } = value as Partial<Erc20PaymentTypedData>;
  if (!domain || !types || !message) return false;
  const domainKeys = Object.keys(domain).sort().join(',');
  if (domainKeys !== 'chainId,name,version') return false;
  if (domain.name !== ERC20_PROOF_DOMAIN_NAME || domain.version !== ERC20_PROOF_DOMAIN_VERSION || domain.chainId !== chainId) return false;
  if (JSON.stringify(types) !== JSON.stringify(ERC20_PAYMENT_TYPES)) return false;
  if (!TX_HASH.test(message.transactionHash) || !isCanonicalLogIndex(message.receiptLogIndex)) return false;
  const request = message.request as Record<string, unknown> | undefined;
  return !!request && BINDING_FIELDS.every((field) => typeof request[field] === 'string');
}

// EIP-712 encoding ---------------------------------------------------------------

const utf8 = (text: string) => new TextEncoder().encode(text);
const keccak = (bytes: Uint8Array) => keccak_256(bytes);

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function uint256(value: bigint): Uint8Array {
  return hexToBytes(value.toString(16).padStart(64, '0'));
}

// encodeType: the primary type, then referenced types in alphabetical order.
const REQUEST_BINDING_TYPE = `RequestBinding(${ERC20_PAYMENT_TYPES.RequestBinding.map((f) => `${f.type} ${f.name}`).join(',')})`;
const ERC20_PAYMENT_TYPE = `Erc20Payment(${ERC20_PAYMENT_TYPES.Erc20Payment.map((f) => `${f.type} ${f.name}`).join(',')})${REQUEST_BINDING_TYPE}`;
const DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId)';

function domainSeparator(chainId: number): Uint8Array {
  return keccak(
    concat(keccak(utf8(DOMAIN_TYPE)), keccak(utf8(ERC20_PROOF_DOMAIN_NAME)), keccak(utf8(ERC20_PROOF_DOMAIN_VERSION)), uint256(BigInt(chainId))),
  );
}

function bindingHash(binding: Erc20RequestBinding): Uint8Array {
  return keccak(concat(keccak(utf8(REQUEST_BINDING_TYPE)), ...BINDING_FIELDS.map((field) => keccak(utf8(binding[field])))));
}

function messageHash(message: Erc20PaymentMessage): Uint8Array {
  return keccak(
    concat(
      keccak(utf8(ERC20_PAYMENT_TYPE)),
      hexToBytes(message.transactionHash),
      uint256(BigInt(message.receiptLogIndex)),
      bindingHash(message.request),
    ),
  );
}

/** The 32-byte digest an EIP-712 signer signs: keccak256(0x1901 ‖ domainSeparator ‖ hashStruct(message)). */
export function erc20PaymentDigest(typedData: Erc20PaymentTypedData): string {
  return bytesToHex(keccak(concat(new Uint8Array([0x19, 0x01]), domainSeparator(typedData.domain.chainId), messageHash(typedData.message))));
}

/** The Ethereum address (lowercase) that made `signature` over the typed data, or undefined if it is not a valid proof signature. */
export function erc20PaymentSigner(typedData: Erc20PaymentTypedData, signature: string): string | undefined {
  // The spec fixes the format: lowercase 0x-hex r ‖ s ‖ v, v 27 or 28, low s.
  if (!SIGNATURE.test(signature)) return undefined;
  if (!TX_HASH.test(typedData.message.transactionHash) || !isCanonicalLogIndex(typedData.message.receiptLogIndex)) return undefined;
  const bytes = hexToBytes(signature);
  const v = bytes[64];
  if (v !== 27 && v !== 28) return undefined;
  try {
    const compact = Signature.fromCompact(bytes.slice(0, 64));
    if (compact.hasHighS()) return undefined;
    const point = compact.addRecoveryBit(v - 27).recoverPublicKey(erc20PaymentDigest(typedData).slice(2));
    const publicKey = point.toRawBytes(false).slice(1);
    return bytesToHex(keccak(publicKey).slice(12));
  } catch {
    return undefined;
  }
}

/** keccak256("Transfer(address,address,uint256)"): topic 0 of every ERC-20 Transfer log. */
export const ERC20_TRANSFER_TOPIC = bytesToHex(keccak(utf8('Transfer(address,address,uint256)')));
