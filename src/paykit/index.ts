// The Paykit service: everything screens need from Paykit, in one import.
//
//   UI -> these hooks -> PaykitService -> serialized call queue -> Paykit SDK (Rust, via JSI)
//                                         sync loop ------------^
//   Paykit SDK -> synchronous callbacks -> state store (MMKV) / session / payment adapter (address cache)
export { PaykitProvider, type PaykitConnection, type PaykitContextValue } from './PaykitProvider';
export { PaykitService, type PeerOverview, type ProfileInput } from './PaykitService';
export {
  useConnectionNotice,
  useContacts,
  useLinkState,
  usePaykit,
  usePaykitService,
  usePaykitState,
  useSyncLog,
  useSyncStatus,
  type ConnectionNotice,
  type ContactSummary,
} from './hooks';
export type { LinkState } from './linkState';
export { contactLinkFor, keyFromContactLink, shortKey } from './keys';
export { describeError, userMessageFor } from './errors';
export { clearSessionSecret } from './secureStorage';
export type { SyncStatus, SyncRoundHook, SyncRoundContext } from './syncLoop';
export type { SyncLogEntry } from './eventLog';
export { useOwnProfile, usePersonProfile, type DisplayProfile } from './hooks';
export type { PersonProfile } from './profiles';
export { usePublicEndpointStatus } from './hooks';
export type { PublicEndpointStatus } from './PaykitService';
export type { PublicEndpointChoice } from './addressCache';
export { resolvePublicPaymentOptions, type PublicPayee } from './publicPayments';
export { acceptedAssets, cannotPayReason, type PayeeAsset, type PublicPaymentOptions } from './publicPaymentOptions';
export { privatePaymentAddressesFor } from './privatePayments';
export { pubkyFromText } from './keys';
export { paykitErrorTag } from './errors';
export { loadNetworkDetails, type NetworkDetails } from './networkDetails';
