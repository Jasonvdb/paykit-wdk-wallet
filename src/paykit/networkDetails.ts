// What You > Network details shows about this identity, read live from the
// SDK: the Pubky capability of the current session and our own Paykit app
// registry as peers see it (registered apps, the Noise key and its
// generation). This is the developer view, so Paykit's own words are fine
// here (docs/DESIGN.md, "Writing").
//
// Also, per contact, the Encrypted Link recovery markers as this phone
// tracks them (encryptedLinkRecoveryMarkerStatus, a local read). A marker
// is a small public file naming the attempt id of a link's stream
// generation: ensureLinkWithPeer publishes ours and reads theirs, and a
// changed one tells the other side to form the link again (after a
// restore, or a remove and re-add). The SDK's removeEncryptedLinkRecoveryMarker
// is only for blocked peers; this app leaves markers to the SDK.
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
  /** Per contact: our marker's attempt id (shortened) and theirs, as last seen. */
  recoveryMarkers: { counterparty: string; ours?: string; oursAt?: string; theirs?: string; theirsAt?: string; problem?: boolean }[];
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

/** SDK calls through the queue: identityStatus, our own paykitAppRegistry, and each contact's marker status. */
export async function loadNetworkDetails(service: PaykitService): Promise<NetworkDetails> {
  const identity = await service.call('identityStatus', (sdk, signal) => sdk.identityStatus({ signal }));
  const registry = await service.call('paykitAppRegistry', (sdk, signal) => sdk.paykitAppRegistry(service.publicKey, { signal }));
  const recoveryMarkers: NetworkDetails['recoveryMarkers'] = [];
  for (const contact of service.getState()?.contacts ?? []) {
    const report = await service.call('encryptedLinkRecoveryMarkerStatus', (sdk, signal) => sdk.encryptedLinkRecoveryMarkerStatus(contact.publicKey, { signal }));
    recoveryMarkers.push({
      counterparty: contact.publicKey,
      ours: report?.localAttemptId?.slice(0, 8),
      oursAt: report?.localMarkerCreatedAt,
      theirs: report?.remoteAttemptId?.slice(0, 8),
      theirsAt: report?.remoteMarkerObservedAt,
      problem: !!report?.localMarkerLastError,
    });
  }
  return {
    recoveryMarkers,
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
