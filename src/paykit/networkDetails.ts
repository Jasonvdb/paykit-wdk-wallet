// What You > Network details shows about this identity, read live from the
// SDK: the Pubky capability of the current session and our own Paykit app
// registry as peers see it (registered apps, the Noise key and its
// generation). This is the developer view, so Paykit's own words are fine
// here (docs/DESIGN.md, "Writing").
//
// Everything here is public (the registry is published for anyone) or a
// status, never a secret. The Noise key shown is the PUBLIC key.
import { FfiPubkyIdentityCapability, type FfiPaykitAppCapabilities } from '@synonymdev/react-native-paykit';

import type { PaykitService } from './PaykitService';

export type NetworkDetails = {
  /** Pubky capability of the current session, in words. */
  capability: string;
  /** Advertised Noise key generation (rotations bump it). */
  keyGeneration?: string;
  /** Our identity-wide Noise public key, as published in the registry. */
  noisePublicKey?: string;
  apps: { appId: string; displayName: string; capabilities: string }[];
  defaultAppId?: string;
};

function capabilityWords(capability: FfiPubkyIdentityCapability | undefined): string {
  switch (capability) {
    case FfiPubkyIdentityCapability.PrivateLinkCapable:
      return 'Signed in: public data and Encrypted Links';
    case FfiPubkyIdentityCapability.PublicOnly:
      return 'Public only: Encrypted Links unavailable';
    case FfiPubkyIdentityCapability.SignedOut:
      return 'Signed out';
    default:
      return 'Unknown';
  }
}

function capabilityList(c: FfiPaykitAppCapabilities): string {
  const names = [
    c.privatePayments && 'private payments',
    c.paymentRequests && 'payment requests',
    c.receipts && 'receipts',
    c.outgoingPayments && 'outgoing payments',
  ].filter(Boolean);
  return names.length > 0 ? names.join(', ') : 'none';
}

/** Two SDK calls through the queue: identityStatus and our own paykitAppRegistry. */
export async function loadNetworkDetails(service: PaykitService): Promise<NetworkDetails> {
  const identity = await service.call('identityStatus', (sdk, signal) => sdk.identityStatus({ signal }));
  const registry = await service.call('paykitAppRegistry', (sdk, signal) => sdk.paykitAppRegistry(service.publicKey, { signal }));
  return {
    capability: capabilityWords(identity?.capability),
    keyGeneration: registry ? String(registry.keyGeneration) : undefined,
    noisePublicKey: registry?.noisePublicKey,
    apps: (registry?.apps ?? []).map((app) => ({
      appId: app.appId,
      displayName: app.displayName,
      capabilities: capabilityList(app.capabilities),
    })),
    defaultAppId: registry?.defaultAppId,
  };
}
