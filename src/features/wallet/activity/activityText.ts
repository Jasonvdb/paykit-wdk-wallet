// Words for an on-chain activity item, shared by the Wallet tab's rows and
// Activity detail. Pure, unit tested.
//
// People: an item that involves a contact reads "Ben paid you" or "You
// paid Ben" instead of "Received" / "Sent". Who it involves is worked out
// in ./activityPeople.ts from Paykit data (the contact's own BTC account on
// our side, the private addresses they shared with us); this file only
// words it.
import type { ActivityItem } from '../../../wallet';

const ZERO_ADDRESS = /^0x0{40}$/i;

/** A USD₮ transfer from the zero address is a mint: the Aave faucet. */
export function isFaucetMint(item: ActivityItem): boolean {
  return (
    item.asset === 'usdt' &&
    item.direction === 'in' &&
    (item.id.endsWith(':local:faucet') || (item.counterpartyAddress !== undefined && ZERO_ADDRESS.test(item.counterpartyAddress)))
  );
}

/** "Sent", "Received", "Moved to main account", "Test USD₮ minted". */
export function activityTitle(item: ActivityItem): string {
  if (isFaucetMint(item)) return 'Test USD₮ minted';
  if ((item.direction === 'out' && item.accountIndex > 0) || item.movedFromAccount !== undefined) return 'Moved to main account';
  return item.direction === 'in' ? 'Received' : 'Sent';
}

/** The title with the person in it, when there is one: "Ben paid you", "You paid Ben". */
export function activityTitleWithPerson(item: ActivityItem, person: { role: 'paid-you' | 'you-paid' | 'moved'; name: string } | undefined): string {
  switch (person?.role) {
    case 'paid-you':
      return `${person.name} paid you`;
    case 'you-paid':
      return `You paid ${person.name}`;
    default:
      return activityTitle(item);
  }
}

/**
 * Activity detail's line under the person: which of their addresses the
 * money went to. Only Bitcoin addresses are private (one per contact); a
 * contact's USD₮ or ETH goes to their one Ethereum address, which everyone
 * pays, so saying "shared only with you" there would be false. A payment
 * that paid a request gets no line: the request section below says what
 * it paid.
 */
export function activityPersonHint(item: ActivityItem, role: 'paid-you' | 'you-paid' | 'moved', paidARequest: boolean): string | undefined {
  if (item.accountIndex > 0 && item.direction === 'in') return 'Paid to the private address you gave them';
  if (role !== 'you-paid' || paidARequest) return undefined;
  return item.chain === 'bitcoin'
    ? 'Paid to a Bitcoin address they shared only with you'
    : 'Paid to their Ethereum address, the same one everyone pays';
}

/** "Pending", "Confirmed", "Failed". */
export function activityStatusWords(item: ActivityItem): string {
  if (item.status === 'pending') return 'Pending';
  if (item.status === 'failed') return 'Failed';
  return 'Confirmed';
}

export function networkName(item: ActivityItem): string {
  return item.chain === 'bitcoin' ? 'Bitcoin (Mutinynet)' : 'Ethereum (Sepolia)';
}
