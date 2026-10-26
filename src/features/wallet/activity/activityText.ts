// Words for an on-chain activity item, shared by the Wallet tab's rows and
// Activity detail. Pure, unit tested.
//
// Phase 4 adds people: an item whose address belongs to a contact reads
// "Ben paid you" instead of "Received". That attribution comes from Paykit
// (the contact's private BTC account, or a receipt), not from here.
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
  if (item.direction === 'out' && item.accountIndex > 0) return 'Moved to main account';
  return item.direction === 'in' ? 'Received' : 'Sent';
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
