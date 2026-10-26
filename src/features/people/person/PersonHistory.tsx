// History with one person: the activity rows that involve them
// (src/features/wallet/activity/activityPeople.ts): what they paid into
// your Bitcoin account for them, what you paid to an address they shared
// with you, and USD₮ between your two accounts.
import { StyleSheet, View } from 'react-native';

import { Divider, EmptyState, Text, space } from '../../../ui';
import { useActivity } from '../../../wallet';
import { ActivityRow } from '../../wallet/activity/ActivityRow';
import { useActivityPeople } from '../../wallet/activity/useActivityPeople';

const SHOWN = 10;

export function PersonHistory({ publicKey, name, onOpen, onPay }: { publicKey: string; name: string; onOpen: (activityId: string) => void; onPay: () => void }) {
  const activity = useActivity();
  const personFor = useActivityPeople();
  const items = activity.items
    .map((item) => ({ item, person: personFor(item) }))
    .filter(({ person }) => person?.publicKey === publicKey)
    .slice(0, SHOWN);

  if (items.length === 0) {
    return activity.isLoading ? (
      <Text color="graphite">Loading…</Text>
    ) : (
      <EmptyState title={`No payments with ${name} yet`} message="Payments between you show up here." action={{ label: `Pay ${name}`, onPress: onPay }} />
    );
  }
  return (
    <View style={styles.root} testID="person-history">
      {items.map(({ item, person }, index) => (
        <View key={item.id}>
          {index > 0 ? <Divider /> : null}
          <ActivityRow item={item} person={person} onPress={() => onOpen(item.id)} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.xs },
});
