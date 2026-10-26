// How a contact's private connection is described to people.
//
// Paykit's FfiLinkedPeerState (NotLinked, Linking, Linked, RecoveryRequired,
// Blocked) is mapped to this app's LinkState in ./hooks.ts. This file holds
// the words (docs/DESIGN.md, "Writing") and the seal ring for each state,
// with no native imports.
import type { SealRing } from '../ui/seal/types';

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

export function linkStateWords(state: LinkState): string {
  switch (state) {
    case 'none':
      return 'Not a contact';
    case 'waiting':
      return "They haven't added you yet";
    case 'connecting':
      return 'Connecting privately…';
    case 'linked':
      return 'Private connection ready';
    case 'recovery':
      return 'Reconnecting privately…';
    case 'unreachable':
      return "Can't reach them right now";
    case 'blocked':
      return 'Blocked';
  }
}

export function sealRingFor(state: LinkState): SealRing {
  switch (state) {
    case 'none':
      return 'none';
    case 'waiting':
    case 'connecting':
    case 'recovery':
      return 'linking';
    case 'linked':
      return 'linked';
    case 'unreachable':
    case 'blocked':
      return 'unreachable';
  }
}
