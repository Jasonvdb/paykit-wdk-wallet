// How a contact's private connection (LinkState, src/paykit/linkState.ts)
// is shown: the words (docs/DESIGN.md, "Writing") and the seal ring.
import type { LinkState } from '../../paykit/linkState';
import type { SealRing } from './types';

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
