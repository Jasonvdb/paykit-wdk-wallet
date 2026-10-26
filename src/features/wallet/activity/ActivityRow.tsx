// One activity row: what happened in words, the asset and when, and the
// signed amount. When the transaction involves a contact (./activityPeople.ts)
// the row leads with their seal and names them: "Ben paid you", "You paid
// Ben". A transaction that paid a payment request says so instead of the
// asset ("Paid Ana's request", "Receipt from Ana"). Shared by the Wallet tab
// and a Person's history.
import { AssetAmount, Row, relativeTime } from '../../../ui';
import { ASSETS, type ActivityItem } from '../../../wallet';
import { PersonSeal } from '../../people/PersonSeal';
import { usePersonName } from '../../people/usePersonName';
import { requestLinkWords, useRequestLinkFor } from './ActivityPaykitLinks';
import type { ActivityPerson } from './activityPeople';
import { activityStatusWords, activityTitleWithPerson } from './activityText';

export function ActivityRow({ item, person, onPress }: { item: ActivityItem; person?: ActivityPerson; onPress: () => void }) {
  const { name } = usePersonName(person?.publicKey);
  const link = useRequestLinkFor(item);
  const linkName = usePersonName(link?.counterparty).name;
  const when = item.status !== 'pending' && item.timestamp ? relativeTime(item.timestamp) : activityStatusWords(item);
  const asset = ASSETS[item.asset].displayName;
  const from = person?.role === 'moved' ? `, from ${name}'s account` : '';
  return (
    <Row
      title={activityTitleWithPerson(item, person ? { role: person.role, name } : undefined)}
      subtitle={`${link ? requestLinkWords(link, linkName) : `${asset}${from}`}, ${when.charAt(0).toLowerCase()}${when.slice(1)}`}
      leading={person ? <PersonSeal pubky={person.publicKey} size={36} /> : undefined}
      testID={`activity-${item.hash.slice(0, 10)}`}
      onPress={onPress}
      trailing={<AssetAmount value={item.direction === 'in' ? item.amount : -item.amount} asset={item.asset} size="small" signed />}
    />
  );
}
