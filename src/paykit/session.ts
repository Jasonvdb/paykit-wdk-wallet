// Getting a Pubky session for the Paykit SDK, and handing it to the SDK.
//
// The app holds the root Pubky key (derived from the wallet mnemonic), so it
// is its own authorizer: it asks for `paykitAuthorizerSessionCapabilities()`
// so the SDK can publish the Paykit Noise key authorization.
//
// Order of attempts (connectSession):
// 1. importSession with the secret saved by the last launch. No network
//    sign-in, so it does not count against staging's 20 sign-ins per minute.
// 2. signIn with the root key. Works for any identity that already has an
//    account on the homeserver (a restored wallet, an expired grant).
// 3. signUp with an invite code, but only during onboarding and only when
//    sign-in failed for a reason other than the network. Codes are
//    single-use and a failed sign-up may consume one.
// The new session secret is saved for the next launch.
//
// Never call this inside a loop: the sync loop reports session errors and a
// human reconnects (You > Sync status).
import {
  FfiPubkySessionBootstrap,
  paykitAuthorizerSessionCapabilities,
  type FfiPubkyClientConfig,
  type FfiPubkyLocalSecretKeyInterface,
  type FfiPubkySessionAccessInterface,
  type FfiPubkySessionBootstrapResult,
  type FfiSdkPubkySessionProvider,
} from '@synonymdev/react-native-paykit';

import { PUBKY_CLIENT_ID, STAGING_HOMESERVER } from '../config/paykit';
import { describeError, isTransportError } from './errors';
import { loadSessionSecret, saveSessionSecret } from './secureStorage';

/**
 * Hands the SDK the live session. The three methods are synchronous
 * callbacks, called on the JS thread while a Rust worker waits.
 */
export class AppSessionProvider implements FfiSdkPubkySessionProvider {
  constructor(private access: FfiPubkySessionAccessInterface | undefined) {}

  loadSessionAccess(): FfiPubkySessionAccessInterface | undefined {
    return this.access;
  }

  publicStorageAvailable(): boolean {
    return true;
  }

  /** Called by the SDK on sign-out. The saved secret is cleared by the caller. */
  clearSessionAccess(): void {
    this.access = undefined;
  }
}

export type SessionOrigin = 'import' | 'signIn' | 'signUp';

export type ConnectedSession = {
  publicKey: string;
  provider: AppSessionProvider;
  origin: SessionOrigin;
};

export type ConnectSessionOptions = {
  secretKey: FfiPubkyLocalSecretKeyInterface;
  /** The public key derived from `secretKey`, used to find the saved secret. */
  publicKey: string;
  pubkyClient: FfiPubkyClientConfig;
  /** Only onboarding passes a code. */
  signupCode?: string;
  log: (message: string) => void;
};

export async function connectSession(options: ConnectSessionOptions): Promise<ConnectedSession> {
  const bootstrap = FfiPubkySessionBootstrap.withPubkyClientConfig(PUBKY_CLIENT_ID, options.pubkyClient);
  const capabilities = paykitAuthorizerSessionCapabilities();

  const finish = async (result: FfiPubkySessionBootstrapResult, origin: SessionOrigin): Promise<ConnectedSession> => {
    if (result.publicKey !== options.publicKey) {
      throw new Error('Session belongs to a different identity');
    }
    await saveSessionSecret(result.publicKey, result.sessionAccess.exportSessionSecret());
    options.log(`session ready (${origin})`);
    return { publicKey: result.publicKey, provider: new AppSessionProvider(result.sessionAccess), origin };
  };

  const saved = await loadSessionSecret(options.publicKey);
  if (saved) {
    try {
      return await finish(await bootstrap.importSession(saved, options.secretKey, capabilities), 'import');
    } catch (error) {
      options.log(`saved session not usable: ${describeError(error)}`);
    }
  }

  try {
    return await finish(await bootstrap.signIn(options.secretKey, capabilities), 'signIn');
  } catch (error) {
    options.log(`sign-in failed: ${describeError(error)}`);
    // A transport error says nothing about whether the account exists.
    // Never spend a single-use code on it.
    if (isTransportError(error) || !options.signupCode) throw error;
  }

  options.log('signing up on the staging homeserver with an invite code');
  return finish(
    await bootstrap.signUp(options.secretKey, STAGING_HOMESERVER, options.signupCode, capabilities),
    'signUp',
  );
}
