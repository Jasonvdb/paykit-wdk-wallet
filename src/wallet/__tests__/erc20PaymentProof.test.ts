// The EIP-712 proof encoding, against the vectors published with the spec
// (paykit-rs specs/fixtures/erc20-payment-proofs.json, public test data
// signed with the secp256k1 scalar 1) and against ethers.
import { TypedDataEncoder, Wallet, verifyTypedData } from 'ethers';

import fixtures from './fixtures/erc20-payment-proofs.json';
import {
  ERC20_PAYMENT_TYPES,
  ERC20_TRANSFER_TOPIC,
  erc20PaymentDigest,
  erc20PaymentSigner,
  erc20PaymentTypedData,
  isCanonicalLogIndex,
  isErc20PaymentTypedData,
  type Erc20PaymentMessage,
} from '../erc20PaymentProof';

type Vector = (typeof fixtures.vectors)[number];

function typedDataOf(vector: Vector) {
  return erc20PaymentTypedData(vector.typed_data.domain.chainId, vector.typed_data.message as Erc20PaymentMessage);
}

describe('erc20PaymentDigest', () => {
  it.each(fixtures.vectors.map((v) => [v.name, v] as const))('matches the spec digest for %s', (_name, vector) => {
    expect(erc20PaymentDigest(typedDataOf(vector))).toBe(vector.digest);
  });

  it('changes when the payment reference changes', () => {
    for (const vector of fixtures.vectors) {
      const typed = typedDataOf(vector);
      const changed = { ...typed, message: { ...typed.message, request: { ...typed.message.request, paymentReference: vector.changed_reference } } };
      expect(erc20PaymentDigest(changed)).toBe(vector.changed_reference_digest);
    }
  });

  it('agrees with ethers', () => {
    const typed = typedDataOf(fixtures.vectors[2]!);
    expect(erc20PaymentDigest(typed)).toBe(TypedDataEncoder.hash(typed.domain, ERC20_PAYMENT_TYPES, typed.message));
  });
});

describe('erc20PaymentSigner', () => {
  it.each(fixtures.vectors.map((v) => [v.name, v] as const))('recovers the spec signer for %s', (_name, vector) => {
    expect(erc20PaymentSigner(typedDataOf(vector), vector.signature)).toBe(vector.signer.toLowerCase());
  });

  it('recovers what an ethers wallet signed (as WDK signs it)', async () => {
    const wallet = Wallet.createRandom();
    const typed = erc20PaymentTypedData(11155111, {
      transactionHash: `0x${'ab'.repeat(32)}`,
      receiptLogIndex: '0',
      request: {
        payer: 'payer-key',
        payee: 'payee-key',
        paymentAppId: 'wdk-paykit-demo',
        paymentRequestId: 'b7f9c2a1-6d43-4b0e-a8d4-0fe2c712ab33',
        paymentReference: 'pkw-1',
        paymentEndpointIdentifier: 'usdt-sepolia-address',
        periodStartsAt: '',
        periodEndsAt: '',
        conversionQuoteId: '',
      },
    });
    const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);
    expect(erc20PaymentSigner(typed, signature)).toBe(wallet.address.toLowerCase());
    expect(verifyTypedData(typed.domain, typed.types, typed.message, signature).toLowerCase()).toBe(wallet.address.toLowerCase());
  });

  it('does not recover the signer when the context differs (another request, chain or log)', () => {
    const vector = fixtures.vectors[2]!;
    const typed = typedDataOf(vector);
    const signer = vector.signer.toLowerCase();
    expect(erc20PaymentSigner({ ...typed, domain: { ...typed.domain, chainId: 11155111 } }, vector.signature)).not.toBe(signer);
    expect(erc20PaymentSigner({ ...typed, message: { ...typed.message, receiptLogIndex: '3' } }, vector.signature)).not.toBe(signer);
    expect(
      erc20PaymentSigner({ ...typed, message: { ...typed.message, request: { ...typed.message.request, paymentRequestId: 'other' } } }, vector.signature),
    ).not.toBe(signer);
  });

  it('refuses malformed and high-s signatures', () => {
    const vector = fixtures.vectors[0]!;
    const typed = typedDataOf(vector);
    expect(erc20PaymentSigner(typed, vector.signature.toUpperCase())).toBeUndefined();
    expect(erc20PaymentSigner(typed, vector.signature.slice(0, -2))).toBeUndefined();
    expect(erc20PaymentSigner(typed, `${vector.signature.slice(0, -2)}1d`)).toBeUndefined();
    // s' = n - s is the same point's other signature: valid ECDSA, but not low-s.
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const s = BigInt(`0x${vector.signature.slice(66, 130)}`);
    const highS = (n - s).toString(16).padStart(64, '0');
    const flippedV = vector.signature.endsWith('1b') ? '1c' : '1b';
    expect(erc20PaymentSigner(typed, `${vector.signature.slice(0, 66)}${highS}${flippedV}`)).toBeUndefined();
  });
});

describe('isErc20PaymentTypedData (the signing guard)', () => {
  const typed = typedDataOf(fixtures.vectors[2]!);

  it('accepts exactly our domain on the expected chain', () => {
    expect(isErc20PaymentTypedData(typed, 1)).toBe(true);
    expect(isErc20PaymentTypedData(typed, 11155111)).toBe(false);
  });

  it('refuses other domains, extra domain fields and other types', () => {
    expect(isErc20PaymentTypedData({ ...typed, domain: { ...typed.domain, name: 'USDT' } }, 1)).toBe(false);
    expect(isErc20PaymentTypedData({ ...typed, domain: { ...typed.domain, verifyingContract: `0x${'1'.repeat(40)}` } }, 1)).toBe(false);
    expect(isErc20PaymentTypedData({ ...typed, types: { Permit: [{ name: 'owner', type: 'address' }] } }, 1)).toBe(false);
    expect(isErc20PaymentTypedData({ ...typed, message: { ...typed.message, receiptLogIndex: '01' } }, 1)).toBe(false);
  });
});

describe('isCanonicalLogIndex', () => {
  it('follows the spec', () => {
    expect(isCanonicalLogIndex('0')).toBe(true);
    expect(isCanonicalLogIndex('17')).toBe(true);
    for (const bad of ['', '01', '-1', '1e3', ' 1', '1.0', (2n ** 256n).toString()]) expect(isCanonicalLogIndex(bad)).toBe(false);
  });
});

it('knows the ERC-20 Transfer topic', () => {
  expect(ERC20_TRANSFER_TOPIC).toBe('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
});
