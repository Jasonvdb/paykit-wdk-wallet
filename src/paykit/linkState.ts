// A contact's private connection state, in this app's terms.
//
// Paykit reports each peer's Encrypted Link as an FfiLinkedPeerState
// (NotLinked, Linking, Linked, RecoveryRequired, Blocked). Screens need a
// little more: whether the peer is a saved contact, and whether a link that
// keeps failing should count as unreachable. linkStateOf does that mapping.
// The words and seal ring for each state live in the UI
// (src/ui/seal/linkStatePresentation.ts).
import { FfiLinkedPeerState, type FfiLinkedPeerRecord } from '@synonymdev/react-native-paykit';

export type LinkState =
  /** Not a contact. */
  | 'none'
  /** Saved, but no handshake could start yet: they have not added us or set up Paykit. */
  | 'waiting'
  /** Handshake in progress; both sides keep advancing it. */
  | 'connecting'
  /** Encrypted Link established: private lists, requests and receipts can flow. */
  | 'linked'
  /** The link needs recovery (e.g. one side restored from backup). */
  | 'recovery'
  /** Messages failed repeatedly. */
  | 'unreachable'
  | 'blocked';

/** Repeated failures before a not-yet-linked peer counts as unreachable. */
const UNREACHABLE_AFTER_FAILURES = 3;

export function linkStateOf(record: FfiLinkedPeerRecord | undefined, isContact: boolean): LinkState {
  if (!record) return isContact ? 'waiting' : 'none';
  switch (record.state) {
    case FfiLinkedPeerState.Linked:
      return 'linked';
    case FfiLinkedPeerState.Blocked:
      return 'blocked';
    case FfiLinkedPeerState.RecoveryRequired:
      return 'recovery';
    case FfiLinkedPeerState.Linking:
      return record.failureCount >= UNREACHABLE_AFTER_FAILURES ? 'unreachable' : 'connecting';
    default:
      return isContact ? 'waiting' : 'none';
  }
}
