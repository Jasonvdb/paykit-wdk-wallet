// Wallet tab: your seal, balances (BTC, USD₮, ETH as gas), the three
// actions, and recent activity.
//
// Phase 1 shows live balances (polled every ~15 s, pull to refresh) and the
// raw on-chain activity list, so later phases start from working data.
//
// TODO(Phase 2 — Wallet): final layout per docs/DESIGN.md wireframe,
// activity rows with people (seal + name) once Paykit attribution exists,
// "Get test USD₮" entry point when the balance is empty, error states.
import { StyleSheet, View } from 'react-native';

import type { MainTabScreenProps } from '../../navigation/types';
import { useConnectionNotice, usePaykitService } from '../../paykit';
import { ASSET_DOT_SIZE, AssetAmount, AssetDot, Button, Divider, EmptyState, Row, Screen, Seal, Text, relativeTime, space } from '../../ui';
import { formatAssetAmount, useActivity, useWalletBalances, type ActivityItem } from '../../wallet';

export function WalletScreen({ navigation }: MainTabScreenProps<'Wallet'>) {
  const service = usePaykitService();
  const notice = useConnectionNotice();
  const { balances, isRefreshing, refresh, error } = useWalletBalances();
  const activity = useActivity();

  return (
    <Screen
      scroll
      edges={['top']}
      refreshing={isRefreshing}
      onRefresh={() => {
        void refresh();
        void activity.refresh();
      }}
      headerLeft={
        service ? (
          <View style={styles.identity}>
            <Seal pubky={service.publicKey} size={36} />
            <Text variant="bodyStrong">You</Text>
          </View>
        ) : (
          <Text color="graphite">{notice?.label}</Text>
        )
      }
      testID="wallet-screen"
    >
      <View style={styles.balances}>
        <Row title="Bitcoin" leading={<AssetDot asset="btc" />} trailing={<AssetAmount value={balances.btc} asset="btc" />} testID="balance-btc" />
        <Divider />
        <Row title="Tether" leading={<AssetDot asset="usdt" />} trailing={<AssetAmount value={balances.usdt} asset="usdt" />} testID="balance-usdt" />
        <Text variant="caption" color="graphite" style={styles.gas} testID="balance-eth">
          gas {balances.eth === undefined ? '—' : formatAssetAmount(balances.eth, 'eth', { withSymbol: true })}
        </Text>
        {error ? (
          <Text variant="caption" color="alert">
            {error}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Button label="Send" onPress={() => navigation.navigate('Send')} style={styles.action} />
        <Button label="Receive" variant="secondary" onPress={() => navigation.navigate('Receive')} style={styles.action} />
        <Button label="Request" variant="secondary" onPress={() => navigation.navigate('RequestMoney')} style={styles.action} />
      </View>

      <Text variant="heading" style={styles.sectionTitle}>
        Activity
      </Text>
      {activity.items.length === 0 ? (
        <EmptyState
          title={activity.isLoading ? 'Loading activity…' : 'No activity yet'}
          message={activity.isLoading ? undefined : 'Receive some test funds to get started.'}
          action={activity.isLoading ? undefined : { label: 'Receive', onPress: () => navigation.navigate('Receive') }}
        />
      ) : (
        activity.items.slice(0, 20).map((item, index) => (
          <View key={item.id}>
            {index > 0 ? <Divider /> : null}
            <ActivityRow item={item} onPress={() => navigation.navigate('ActivityDetail', { activityId: item.id })} />
          </View>
        ))
      )}
    </Screen>
  );
}

function ActivityRow({ item, onPress }: { item: ActivityItem; onPress: () => void }) {
  const title = item.direction === 'in' ? 'Received' : 'Sent';
  const when = item.status === 'pending' ? 'Pending' : item.timestamp ? relativeTime(item.timestamp) : 'Confirmed';
  return (
    <Row
      title={title}
      subtitle={when}
      onPress={onPress}
      trailing={<AssetAmount value={item.direction === 'in' ? item.amount : -item.amount} asset={item.asset} size="small" signed />}
    />
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  balances: { gap: 0 },
  // Line up with the asset names: dot width plus the Row's gap.
  gas: { marginLeft: ASSET_DOT_SIZE + space.m, marginTop: -space.s },
  actions: { flexDirection: 'row', gap: space.s, marginTop: space.xl },
  action: { flex: 1, paddingHorizontal: space.s },
  sectionTitle: { marginTop: space.xxl, marginBottom: space.s },
});
