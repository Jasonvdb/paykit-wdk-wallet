// The order of the People list: who you can pay privately first.
//
//   1. Private connection ready
//   2. Connecting (or reconnecting)
//   3. They haven't added you yet
//   4. Can't reach them, blocked
// then by name, ignoring case. Pure; unit tested.
import type { LinkState } from '../../paykit/linkState';

const RANK: Record<LinkState, number> = {
  linked: 0,
  connecting: 1,
  recovery: 1,
  waiting: 2,
  unreachable: 3,
  blocked: 4,
  none: 5,
};

export function sortContacts<T extends { linkState: LinkState; name: string }>(contacts: readonly T[]): T[] {
  return [...contacts].sort(
    (a, b) => RANK[a.linkState] - RANK[b.linkState] || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}
