// One payment request in a list: the other person's seal and name, the
// status in words, and the amount. A recurring request adds its schedule
// and, for the payer, whether a payment is due now (requestRowSubtitle).
import { AssetAmount, Row, Text } from '../../ui';
import { paymentKey, requestStatusWords, useRequestBook, useRequestFacts, type RequestView } from '../../paykit';
import { PersonSeal } from '../people/PersonSeal';
import { usePersonName } from '../people/usePersonName';
import { requestRowSubtitle, scheduleStatus } from './requestSchedule';

export function RequestRow({ view, nowMs, onPress }: { view: RequestView; nowMs: number; onPress: () => void }) {
  const { name } = usePersonName(view.counterparty);
  const facts = useRequestFacts(view, name);
  const book = useRequestBook();
  const recurrence = view.terms?.recurrence;
  const isDeferred = (period: Parameters<typeof paymentKey>[2]) => !!book?.isDeferred(paymentKey(view.counterparty, view.requestId, period));
  const schedule = facts && (view.state === 'active' || view.state === 'accepted') ? scheduleStatus(recurrence, facts, nowMs, isDeferred) : undefined;
  return (
    <Row
      title={name}
      subtitle={
        facts ? requestRowSubtitle({ status: requestStatusWords(facts), recurrence, schedule, payer: view.role === 'payer', note: view.terms?.note, nowMs }) : undefined
      }
      leading={<PersonSeal pubky={view.counterparty} size={40} />}
      onPress={onPress}
      testID={`request-row-${view.requestId.slice(0, 8)}`}
      trailing={
        view.terms?.amount !== undefined && view.terms.asset ? (
          <AssetAmount value={view.terms.amount} asset={view.terms.asset} size="small" />
        ) : (
          <Text variant="secondary" color="graphite">
            {view.terms?.rawAmount ?? ''}
          </Text>
        )
      }
    />
  );
}
