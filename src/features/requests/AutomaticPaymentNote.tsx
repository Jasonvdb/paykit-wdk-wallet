// Request detail: a note when automatic payments (an Allowance) cover this
// request, and why the last automatic try didn't pay, if it didn't. The
// words follow what actually happened, from the payment ledger, never
// just from the request being tied to an Allowance.
//
//   payer, restored    it came back with a backup: paid by hand, after
//                      checking Activity (src/paykit/restoreReview.ts)
//   payer, chosen      the ledger ties the request to one of your
//                      Allowances with them (the association, written when
//                      it was accepted automatically):
//                        one-time   "Paid automatically, within your
//                                   limits" once an automatic payment is
//                                   recorded; "Accepted automatically. It
//                                   is paid in a moment." before that
//                        recurring  "Paid automatically within your limits
//                                   for Ben as payments come due."
//                        ended      "...have ended. Pay what is due
//                                   yourself.", only when something is due
//   payer, covered     still proposed, and an accepted Allowance covers it:
//                      it is accepted and paid in a moment
//   payer, too large   outside the amount allowed for one automatic payment
//   payee              they pay your requests automatically, and this one
//                      is within their limits
//   payer              the reason the last automatic try stopped (over a
//                      limit, not enough money ...), from the round hook;
//                      while there is one, no "paid" or "in a moment" line
//
// Display only: the SDK decides each payment (src/paykit/automaticPayments.ts).
import { StyleSheet, View } from 'react-native';

import {
  allowanceCovers,
  paymentKey,
  requestKey,
  useAllowanceLedger,
  useAllowancesWith,
  useAutomaticPaymentNote,
  useRestoreReview,
  type AllowanceView,
  type BillingPeriod,
  type RequestView,
} from '../../paykit';
import { Text, formatDateTime, space } from '../../ui';

export function AutomaticPaymentNote({ view, name, duePeriod }: { view: RequestView; name: string; duePeriod?: BillingPeriod }) {
  const withThem = useAllowancesWith(view.counterparty);
  const ledger = useAllowanceLedger();
  const rkey = requestKey(view.counterparty, view.requestId);
  const requestNote = useAutomaticPaymentNote(rkey);
  // One-time: the request's payment. Recurring: the period due now, if any.
  const occurrenceKey = view.terms?.recurrence ? (duePeriod ? paymentKey(view.counterparty, view.requestId, duePeriod) : undefined) : paymentKey(view.counterparty, view.requestId);
  const periodNote = useAutomaticPaymentNote(occurrenceKey);
  const review = useRestoreReview();
  const terms = view.terms;
  if (!terms) return null;
  const now = Date.now();

  // Came back with a backup: it may have been paid after the backup was made (src/paykit/restoreReview.ts).
  if (view.role === 'payer' && review?.requestKeys.includes(rkey)) {
    const made = review.backupCreatedAtMs !== undefined ? ` made ${formatDateTime(review.backupCreatedAtMs)}` : '';
    return (
      <View style={styles.root} testID="automatic-payment-note">
        <Text color="graphite" testID="automatic-payment-restored">
          {`This request came back with a backup${made}. Payments made after that aren't in the backup, so check Activity before you pay. It is never paid automatically.`}
        </Text>
      </View>
    );
  }

  const problem = view.role === 'payer' ? (periodNote ?? requestNote) : undefined;
  const usable = (a: AllowanceView) => a.state === 'accepted' && a.healthy && !a.stoppedHere && (a.terms?.expiresAtMs === undefined || a.terms.expiresAtMs > now);

  let line: string | undefined;
  if (view.role === 'payer') {
    const chosen = ledger?.associations.get(rkey);
    const chosenAllowance = chosen ? withThem.find((a) => a.allowanceId === chosen.allowanceId && a.role === 'allower') : undefined;
    const manual = ledger?.manualRequests.has(rkey);
    if (chosen) {
      const stillPays = !!chosenAllowance && usable(chosenAllowance);
      if (terms.recurrence) {
        if (!stillPays && duePeriod) line = `Your automatic payments for ${name} have ended. Pay what is due yourself.`;
        else if (stillPays && !problem && view.state === 'active') line = `Paid automatically within your limits for ${name} as payments come due.`;
      } else {
        const occurrence = ledger?.occurrences.get(paymentKey(view.counterparty, view.requestId));
        const paidByUs = view.proofs.some((p) => p.ours) || !!occurrence?.live;
        if (occurrence?.live && occurrence.automatic) line = `Paid automatically, within your limits for ${name}.`;
        else if (!paidByUs && !stillPays && view.state === 'accepted') line = `Your automatic payments for ${name} have ended. Pay it yourself.`;
        else if (!paidByUs && stillPays && !problem && view.state === 'accepted') line = 'Accepted automatically. It is paid in a moment.';
      }
    } else if (!manual && view.state === 'proposed') {
      const ours = withThem.filter((a) => a.role === 'allower' && usable(a) && a.terms);
      if (ours.some((a) => allowanceCovers(a.terms!, terms, now))) {
        line = problem ? 'Within your limits for automatic payments.' : 'Within your limits for automatic payments: it is accepted and paid in a moment.';
      } else if (ours.some((a) => allowanceCovers({ ...a.terms!, perPaymentMin: undefined, perPaymentMax: undefined }, terms, now))) {
        // Same asset and method, but too much (or too little) for one automatic payment.
        line = 'Outside the amount you allowed for one automatic payment, so it waits for you.';
      }
    }
  } else if (view.role === 'payee' && withThem.some((a) => a.role === 'allowee' && usable(a) && a.terms && allowanceCovers(a.terms, terms, now))) {
    line = `${name} pays requests like this automatically.`;
  }
  if (!line && !problem) return null;

  return (
    <View style={styles.root} testID="automatic-payment-note">
      {line ? <Text color="seal">{line}</Text> : null}
      {problem ? (
        <Text variant="secondary" color="graphite" testID="automatic-payment-problem">
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: space.l, gap: space.xs },
});
