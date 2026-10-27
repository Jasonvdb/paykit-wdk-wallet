// Collect: how much of a contact's Bitcoin account can move to account 0.
//
// WDK's getMaxSpendable plans a two-output transaction: the amount, plus a
// change output of exactly the dust limit (294 sats for P2WPKH) that goes
// back to the contact account. Sent as it is, a collect therefore leaves a
// few hundred sats behind, and that remainder can never be collected: on
// its own it is less than the dust limit plus the fee of moving it. The
// first real Collect on Mutinynet left 300 sats this way.
//
// So a collect sends the amount *plus* that planned change. WDK's spend
// planner (_planSpend, and coinselect under it) then finds that the
// leftover after the fee is dust and leaves the change output out: one
// output, nothing stays behind, and the few sats the second output would
// have cost go to the fee instead.
//
// Pure; unit tested.
import { parseBaseUnits } from './amounts';

/** WDK's dust limit for P2WPKH outputs (DUST_LIMIT[84] in @tetherto/wdk-wallet-btc). */
export const BTC_DUST_LIMIT_SATS = 294n;

/** WDK never pays less than this fee (MIN_TX_FEE_SATS in @tetherto/wdk-wallet-btc). */
export const BTC_MIN_TX_FEE_SATS = 141n;

/**
 * The smallest balance a collect can move at Mutinynet's usual 1 sat/vB:
 * what is left after WDK's minimum fee must be above the dust limit. At
 * higher fee rates more is needed; Collect then says it is too little.
 */
export const MIN_COLLECTABLE_SATS = BTC_DUST_LIMIT_SATS + BTC_MIN_TX_FEE_SATS + 1n;

/** True if a contact account holds enough to be worth a Collect. */
export function isCollectable(sats: bigint | undefined): boolean {
  return sats !== undefined && sats >= MIN_COLLECTABLE_SATS;
}

/**
 * The amount to send for a collect, from WDK's getMaxSpendable result (its
 * bigints arrive as strings over the worklet bridge): the spendable amount
 * plus the change it planned to keep back (see the header). Undefined if
 * there is nothing to move.
 */
export function collectAmount(maxSpendable: { amount?: unknown; fee?: unknown; changeValue?: unknown } | null | undefined): bigint | undefined {
  const amount = parseBaseUnits(String(maxSpendable?.amount ?? ''));
  if (amount === undefined || amount <= 0n) return undefined;
  const change = parseBaseUnits(String(maxSpendable?.changeValue ?? '0')) ?? 0n;
  return amount + change;
}
