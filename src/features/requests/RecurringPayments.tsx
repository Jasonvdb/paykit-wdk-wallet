// The payments of a recurring request, one row per billing period: paid,
// checked, receipt, due now, or still to come. The payer pays the oldest
// due period with one tap ("Pay now") or puts it off ("Not now", which
// records deferPaymentOccurrence in the payment ledger).
import { StyleSheet, View } from 'react-native';

import { isPaymentMade, isScheduleComplete, paymentCount, paymentKey, paymentWords, periodKey, useRequestBook, type BillingPeriod, type RequestFacts, type RequestView } from '../../paykit';
import { Button, Divider, Text, formatDateTime, space } from '../../ui';
import { scheduleStatus, whenWords } from './requestSchedule';

export type RecurringPaymentsProps = {
  view: RequestView;
  facts: RequestFacts;
  nowMs: number;
  /** Payer, while the request is active: pay or put off the oldest due period. */
  onPay?: (period: BillingPeriod) => void;
  onDefer?: (period: BillingPeriod) => void;
  busy?: boolean;
};

export function RecurringPayments({ view, facts, nowMs, onPay, onDefer, busy }: RecurringPaymentsProps) {
  const book = useRequestBook();
  const recurrence = view.terms?.recurrence;
  if (!recurrence) return null;
  const isDeferred = (period: BillingPeriod) => !!book?.isDeferred(paymentKey(view.counterparty, view.requestId, period));
  const active = view.state === 'active' || view.state === 'accepted';
  const schedule = active ? scheduleStatus(recurrence, facts, nowMs) : undefined;
  const total = paymentCount(recurrence);
  const byPeriod = new Map(facts.payments.map((p) => [periodKey(p.period), p]));
  const firstDue = schedule?.due[0];

  const rows = facts.payments.filter((p) => p.period).map((p) => ({ period: p.period as BillingPeriod, words: paymentWords(p, facts) ?? 'In progress' }));
  for (const period of schedule?.due ?? []) {
    if (!byPeriod.has(periodKey(period))) {
      rows.push({ period, words: isDeferred(period) ? 'Put off for now' : facts.role === 'payer' ? 'Due now' : `Waiting for ${facts.name} to pay` });
    }
  }
  rows.sort((a, b) => Date.parse(a.period.startsAt) - Date.parse(b.period.startsAt));

  return (
    <View testID="recurring-payments">
      <Text variant="secondary" color="graphite">
        {isScheduleComplete(facts)
          ? `All ${total} paid.`
          : `${total ? `${facts.payments.filter(isPaymentMade).length} of ${total} paid` : 'Payments so far'}${
              schedule?.next ? `. Next one ${whenWords(Date.parse(schedule.next.startsAt), nowMs)}.` : schedule ? '. No more after these.' : ''
            }`}
      </Text>
      {rows.map((row, index) => (
        <View key={row.period.startsAt}>
          {index > 0 ? <Divider /> : null}
          <View style={styles.row} testID={`period-${index}`}>
            <Text>{formatDateTime(Date.parse(row.period.startsAt))}</Text>
            <Text variant="caption" color="graphite">
              {row.words}
            </Text>
          </View>
        </View>
      ))}
      {firstDue && onPay ? (
        <View style={styles.actions}>
          <Button label="Pay now" onPress={() => onPay(firstDue)} disabled={busy} testID="request-pay-period" />
          {onDefer && !isDeferred(firstDue) ? (
            <Button label="Not now" variant="secondary" onPress={() => onDefer(firstDue)} disabled={busy} testID="request-defer-period" />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: space.s, gap: 2 },
  actions: { gap: space.s, marginTop: space.m },
});
