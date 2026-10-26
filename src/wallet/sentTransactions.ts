// A local record of transactions this app sent, kept in memory.
//
// Blockscout needs a few seconds to index a new Sepolia transaction, and an
// unconfirmed BTC send may not be in Electrum's history immediately. The
// activity list merges these records in until the indexer has the same hash
// (see mergeActivity in ./activity.ts). Lost on restart, which is fine: by
// then the indexers have caught up.
import type { ActivityItem } from './activity';

type Listener = () => void;

let records: ActivityItem[] = [];
const listeners = new Set<Listener>();

export function recordSentTransaction(item: ActivityItem): void {
  records = [item, ...records.filter((r) => r.id !== item.id)].slice(0, 50);
  for (const listener of listeners) listener();
}

/** The array is replaced on every change, so it works as a React snapshot. */
export function sentTransactions(): ActivityItem[] {
  return records;
}

export function subscribeSentTransactions(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
