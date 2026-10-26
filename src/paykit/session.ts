// Pubky session for the Paykit SDK.
//
// The app holds the root Pubky key (derived from the wallet mnemonic), so it
// is its own authorizer: it asks for `paykitAuthorizerSessionCapabilities()`
// so the SDK can publish the Paykit Noise key authorization.
//
// Sign-in comes first. A signup code is single-use and a failed sign-up may
// consume it, so we only sign up when sign-in shows the account does not exist.
import {
  FfiPubkySessionBootstrap,
  PaykitFfiError,
  PaykitFfiError_Tags,
  paykitAuthorizerSessionCapabilities,
  type FfiPubkyClientConfig,
  type FfiPubkyLocalSecretKeyInterface,
  type FfiPubkySessionAccessInterface,
  type FfiSdkPubkySessionProvider,
} from '@synonymdev/react-native-paykit';

import { PUBKY_CLIENT_ID, STAGING_HOMESERVER } from '../config/paykit';

/** Hands the SDK the live session from the bootstrap. Memory only for now. */
export class InMemorySessionProvider implements FfiSdkPubkySessionProvider {
  constructor(private access: FfiPubkySessionAccessInterface | undefined) {}

  loadSessionAccess(): FfiPubkySessionAccessInterface | undefined {
    return this.access;
  }

  publicStorageAvailable(): boolean {
    return true;
  }

  clearSessionAccess(): void {
    this.access = undefined;
  }
}

export type SessionResult = {
  publicKey: string;
  provider: InMemorySessionProvider;
  how: 'signIn' | 'signUp';
};

/** A short, secret-free description of an SDK error for logs. */
export function describeError(error: unknown): string {
  if (PaykitFfiError.instanceOf(error)) {
    return `${error.tag}/${error.inner.code}: ${error.inner.context}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function signInOrSignUp(options: {
  secret: FfiPubkyLocalSecretKeyInterface;
  pubkyClient: FfiPubkyClientConfig;
  signupCode: string | undefined;
  log: (line: string) => void;
}): Promise<SessionResult> {
  const bootstrap = FfiPubkySessionBootstrap.withPubkyClientConfig(
    PUBKY_CLIENT_ID,
    options.pubkyClient,
  );
  const capabilities = paykitAuthorizerSessionCapabilities();
  try {
    const result = await bootstrap.signIn(options.secret, capabilities);
    return {
      publicKey: result.publicKey,
      provider: new InMemorySessionProvider(result.sessionAccess),
      how: 'signIn',
    };
  } catch (error) {
    options.log(`signIn failed: ${describeError(error)}`);
    // A transport error says nothing about whether the account exists.
    // Do not spend the single-use code on it.
    if (PaykitFfiError.instanceOf(error) && error.tag === PaykitFfiError_Tags.Transport) throw error;
    if (!options.signupCode) throw error;
  }
  options.log('signing up on the staging homeserver with the signup code');
  const result = await bootstrap.signUp(
    options.secret,
    STAGING_HOMESERVER,
    options.signupCode,
    capabilities,
  );
  return {
    publicKey: result.publicKey,
    provider: new InMemorySessionProvider(result.sessionAccess),
    how: 'signUp',
  };
}
