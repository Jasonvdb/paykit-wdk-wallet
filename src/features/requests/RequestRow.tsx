// One payment request in a list: the other person's seal and name, the
// status in words, and the amount. A recurring request adds its schedule
// and, for the payer, whether a payment is due now.
import { AssetAmount, Row, Text } from '../../ui';
import { intervalWords, requestStatusWords, useRequestFacts, type RequestView } from '../../paykit';
import { PersonSeal } from '../people/PersonSeal';
import { usePersonName } from '../people/usePersonName';
import { scheduleStatus, whenWords } from './requestSchedule';

export function RequestRow({ view, nowMs, onPress }: { view: RequestView; nowMs: number; onPress: () => void }) {
  const { name } = usePersonName(view.counterparty);
  const facts = useRequestFacts(view, name);
  const recurrence = view.terms?.recurrence;
  const schedule = facts && (view.state === 'active' || view.state === 'accepted') ? scheduleStatus(recurrence, facts, nowMs) : undefined;
  const parts = [facts ? requestStatusWords(facts) : ''];
  if (recurrence) parts.push(intervalWords(recurrence));
  if (schedule && view.role === 'payer') {
    if (schedule.due.length > 0) parts.push(schedule.due.length > 1 ? `${schedule.due.length} payments due` : 'payment due now');
    else if (schedule.next) parts.push(`next ${whenWords(Date.parse(schedule.next.startsAt), nowMs)}`);
  }
  if (view.terms?.note) parts.push(`“${view.terms.note}”`);
  return (
    <Row
      title={name}
      subtitle={parts.filter(Boolean).join(' · ')}
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
