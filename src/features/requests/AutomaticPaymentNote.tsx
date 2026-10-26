// Request detail: a note when automatic payments (an Allowance) cover this
// request, and why the last automatic try didn't pay, if it didn't.
//
//   payer, chosen      the request uses one of your Allowances with them
//                      (the ledger's association): "Paid automatically,
//                      within your limits for Ben."
//   payer, covered     still proposed, and an accepted Allowance covers it:
//                      it is accepted and paid in a moment
//   payee              they pay your requests automatically, and this one
//                      is within their limits
//   either             the reason the last automatic try stopped (over a
//                      limit, not enough money ...), from the round hook
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
  type BillingPeriod,
  type RequestView,
} from '../../paykit';
import { Text, space } from '../../ui';

export function AutomaticPaymentNote({ view, name, duePeriod }: { view: RequestView; name: string; duePeriod?: BillingPeriod }) {
  const allowances = useAllowancesWith(view.counterparty).filter((a) => a.state === 'accepted' && a.healthy);
  const ledger = useAllowanceLedger();
  const rkey = requestKey(view.counterparty, view.requestId);
  const requestNote = useAutomaticPaymentNote(rkey);
  // One-time: the request's payment. Recurring: the period due now, if any.
  const occurrenceKey = view.terms?.recurrence ? (duePeriod ? paymentKey(view.counterparty, view.requestId, duePeriod) : undefined) : paymentKey(view.counterparty, view.requestId);
  const periodNote = useAutomaticPaymentNote(occurrenceKey);
  const terms = view.terms;
  if (!terms) return null;
  const now = Date.now();

  let line: string | undefined;
  if (view.role === 'payer') {
    const chosen = ledger?.associations.get(rkey);
    const manual = ledger?.manualRequests.has(rkey);
    if (chosen && allowances.some((a) => a.allowanceId === chosen.allowanceId && a.role === 'allower')) {
      line = `Paid automatically, within your limits for ${name}.`;
    } else if (chosen) {
      line = `Your automatic payments for ${name} have ended. Pay what is due yourself.`;
    } else if (!manual && view.state === 'proposed' && allowances.some((a) => a.role === 'allower' && a.terms && allowanceCovers(a.terms, terms, now))) {
      line = requestNote ? 'Within your limits for automatic payments.' : 'Within your limits for automatic payments: it is accepted and paid in a moment.';
    }
  } else if (view.role === 'payee' && allowances.some((a) => a.role === 'allowee' && a.terms && allowanceCovers(a.terms, terms, now))) {
    line = `${name} pays requests like this automatically.`;
  }
  const problem = view.role === 'payer' ? (periodNote ?? requestNote) : undefined;
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
