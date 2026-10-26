// Public payments: pay anyone by their pubky, through the payment
// endpoints they publish for everyone.
//
//   resolvePublicPaymentOptions(service, text)
//     normalizes the key, reads their app registry, public endpoints and
//     profile (PaykitService.resolvePeer, through the call queue), and
//     returns what they accept as checked plain data
//     (./publicPaymentOptions.ts). The wallet then sends on chain to the
//     address for the chosen asset with useSend.
//
// Public endpoints are the same for every payer and anyone can read them.
// A linked contact also shares private, per-contact addresses; Send
// prefers those (see `privatePaymentAddressesFor` in ./privatePayments.ts,
// which the Send screen asks first).
import { FfiPublicPaymentResolutionStatus } from '@synonymdev/react-native-paykit';

import type { PeerOverview, PaykitService } from './PaykitService';
import type { PersonProfile } from './profiles';
import { publicPaymentOptionsFrom, type PublicPaymentOptions, type PublicPaymentStatus } from './publicPaymentOptions';

function statusOf(status: FfiPublicPaymentResolutionStatus): PublicPaymentStatus {
  switch (status) {
    case FfiPublicPaymentResolutionStatus.Payable:
      return 'payable';
    case FfiPublicPaymentResolutionStatus.UnsupportedEndpoint:
      return 'unsupported';
    case FfiPublicPaymentResolutionStatus.Unavailable:
      return 'unavailable';
    default:
      return 'no-endpoint';
  }
}

/** Plain, checked data from the SDK's answer about one peer. */
export function publicPaymentOptionsForPeer(peer: PeerOverview): PublicPaymentOptions {
  return publicPaymentOptionsFrom({
    publicKey: peer.publicKey,
    status: statusOf(peer.publicPayment.status),
    hasPaymentApp: peer.registry !== undefined && peer.registry.apps.length > 0,
    endpoints: peer.publicPayment.payableEndpoints.map((endpoint) => ({
      counterparty: endpoint.counterparty,
      identifier: endpoint.identifier,
      payloadText: endpoint.target.payload.exportText(),
    })),
    failedApps: peer.publicPayment.failures.length,
  });
}

export type PublicPayee = {
  options: PublicPaymentOptions;
  profile?: PersonProfile;
};

/**
 * Look a person up by pubky (pasted, scanned or linked text): what they
 * accept publicly and their profile. Throws if the text is not a pubky or
 * their homeserver can't be reached; screens show userMessageFor(error).
 */
export async function resolvePublicPaymentOptions(service: PaykitService, text: string): Promise<PublicPayee> {
  const peer = await service.resolvePeer(text);
  const profile = peer.profile ? { displayName: peer.profile.displayName, imageUri: peer.profile.imageUri } : undefined;
  // Share the fresh profile with every seal on screen.
  if (profile) service.profiles.setProfile(peer.publicKey, profile);
  return { options: publicPaymentOptionsForPeer(peer), profile };
}
