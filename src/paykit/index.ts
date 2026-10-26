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
