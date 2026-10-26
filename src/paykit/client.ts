// Build one Paykit SDK handle for the wallet's identity.
//
// Keep exactly one handle per identity alive: a second handle that restores
// the same Pubky grant replaces the first one's session.
import {
  FfiPaykitSdk,
  defaultConfig,
  defaultPubkyClientConfig,
  pubkyPublicKeyFromSecret,
  pubkySecretKeyFromBip39Mnemonic,
  type FfiPaykitSdkInterface,
} from '@synonymdev/react-native-paykit';

import { PAYKIT_APP_ID } from '../config/paykit';
import { signInOrSignUp } from './session';
import { WdkPaymentAdapter, type AddressCache } from './paymentAdapter';
import { openStateStore, type MmkvStateBlobStore } from './stateStore';

export type PaykitClient = {
  sdk: FfiPaykitSdkInterface;
  publicKey: string;
  adapter: WdkPaymentAdapter;
  store: MmkvStateBlobStore;
  how: 'signIn' | 'signUp';
};

/**
 * The Pubky key is derived from the wallet's BIP-39 mnemonic with Paykit's
 * own `pubkySecretKeyFromBip39Mnemonic` (first 32 bytes of the BIP-39 seed,
 * the convention Bitkit and Pubky Ring use). It is not domain-separated from
 * the wallet keys, which is acceptable for this testnet demo only.
 */
export function pubkyFromMnemonic(mnemonic: string): string {
  return pubkyPublicKeyFromSecret(pubkySecretKeyFromBip39Mnemonic(mnemonic));
}

export async function createPaykitClient(options: {
  mnemonic: string;
  signupCode: string | undefined;
  addresses: AddressCache;
  log: (line: string) => void;
}): Promise<PaykitClient> {
  // Staging uses the public DHT and the default pkarr relays.
  const pubkyClient = defaultPubkyClientConfig();
  const secret = pubkySecretKeyFromBip39Mnemonic(options.mnemonic);
  const session = await signInOrSignUp({
    secret,
    pubkyClient,
    signupCode: options.signupCode,
    log: options.log,
  });
  const store = await openStateStore(session.publicKey);
  const adapter = new WdkPaymentAdapter();
  adapter.setAddresses(options.addresses);
  const sdk = FfiPaykitSdk.withPaymentAdapterAndPubkyClientConfig(
    store,
    session.provider,
    adapter,
    defaultConfig(PAYKIT_APP_ID),
    pubkyClient,
  );
  return { sdk, publicKey: session.publicKey, adapter, store, how: session.how };
}
