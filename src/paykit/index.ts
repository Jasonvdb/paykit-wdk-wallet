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
export {
  useContactAccounts,
  usePrivateAddressOwners,
  usePrivateListSummary,
  usePrivateLists,
  type ContactAccount,
  type PrivateListsWithPerson,
} from './hooks';
export { loadReceivedPrivateList } from './privatePayments';
export { addressKey, assetsOf, type IncomingList, type OutgoingListStatus, type PayeeAddresses } from './privatePaymentLists';
// Payment requests and receipts (Phase 5)
export {
  acceptRequest,
  cancelRequest,
  declineRequest,
  deferPayment,
  finishPayment,
  paymentRequestsOf,
  preparePayment,
  requestMoney,
  startPayment,
  type PaymentChain,
  type PreparedPayment,
  type ProofView,
  type RequestMoneyInput,
  type RequestView,
} from './requests';
export { usePaymentRequest, usePaymentRequests, useRequestBook, useRequestFacts, useRequestLinks } from './hooks';
export type { RequestLink } from './requestLinks';
export {
  EXPIRY_CHOICES,
  NOTE_MAX_CHARS,
  PAYMENT_COUNT_CHOICES,
  REPEAT_CHOICES,
  recurringScheduleWords,
  type ExpiryChoice,
  type RepeatChoice,
  type RequestAsset,
  type RequestTermsView,
} from './requestTerms';
export { isPaymentHandled, isPaymentMade, isPaymentSettled, isTerminal, paymentWords, requestStatusWords, requestTimeline, type PaymentFacts, type RequestFacts, type TimelineStep } from './requestStatus';
export { intervalWords, scheduleWords, nextPeriodAfter, paymentCount, periodKey, unpaidPeriods, parseTime, type BillingPeriod, type Recurrence } from './recurrence';
export { paymentKey } from './requestBook';
// Backup and restore (Phase 6)
export { backupSummaryWords, checkBackup, exportBackup, readBackupStatus, type BackupStatus, type BackupSummary } from './backup';
export { backupOpenMessage, looksLikeBackup } from './backupCrypto';
// Automatic payments under an Allowance (Phase 6)
export {
  acceptAutomaticPayments,
  declineAutomaticPayments,
  endAutomaticPayments,
  offerAutomaticPayments,
  requestKey,
  type AllowanceLedger,
  type AllowanceView,
} from './allowances';
export {
  allowanceCovers,
  allowanceTermsWords,
  allowanceUsage,
  allowanceUsageWords,
  buildAllowanceTerms,
  DEFAULT_DURATION,
  DEFAULT_PER_PAYMENT,
  DURATION_CHOICES,
  PER_PAYMENT_CHOICES,
  readAllowanceTerms,
  type DurationChoice,
} from './allowanceTerms';
export { useAllowanceLedger, useAllowancesWith, useAutomaticPaymentNote } from './hooks';
