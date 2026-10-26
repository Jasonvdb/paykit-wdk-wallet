// Wallet tab: your seal (with your photo) and published name, balances
// (BTC, USD₮, ETH as gas), the three actions, and recent activity. Tapping
// your name opens the You tab, where you edit your profile.
//
// Balances are polled every ~15 s while the app is active (pull to
// refresh). An empty USD₮ balance offers "Get test USD₮" right here, since
// that is the first thing a new demo wallet needs. Activity rows open
// Activity detail.
//
// TODO(Phase 4 — Contacts): activity rows with people (seal + name) once
// Paykit attribution exists.
import { Pressable, StyleSheet, View } from 'react-native';

import type { MainTabScreenProps } from '../../navigation/types';
import { useConnectionNotice, useOwnProfile, usePaykitService } from '../../paykit';
import { ASSET_DOT_SIZE, AssetAmount, AssetDot, Button, Divider, EmptyState, Row, Screen, Text, relativeTime, space } from '../../ui';
import { formatAssetAmount, useActivity, useWalletBalances, type ActivityItem } from '../../wallet';
import { activityStatusWords, activityTitle } from './activity/activityText';
import { PersonSeal } from '../people/PersonSeal';
import { GetTestUsdtButton } from './GetTestUsdtButton';

export function WalletScreen({ navigation }: MainTabScreenProps<'Wallet'>) {
  const service = usePaykitService();
  const ownProfile = useOwnProfile();
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
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the You tab"
            onPress={() => navigation.navigate('Main', { screen: 'You' })}
            style={styles.identity}
            testID="wallet-identity"
          >
            <PersonSeal pubky={service.publicKey} size={36} />
            <Text variant="bodyStrong" numberOfLines={1} style={styles.name}>
              {ownProfile.displayName ?? 'You'}
            </Text>
          </Pressable>
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
        {balances.usdt === 0n ? (
          <View style={styles.faucet}>
            <GetTestUsdtButton compact />
          </View>
        ) : null}
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
  const when = item.status !== 'pending' && item.timestamp ? relativeTime(item.timestamp) : activityStatusWords(item);
  const asset = item.asset === 'btc' ? 'Bitcoin' : item.asset === 'usdt' ? 'USD₮' : 'ETH';
  return (
    <Row
      title={activityTitle(item)}
      subtitle={`${asset}, ${when.charAt(0).toLowerCase()}${when.slice(1)}`}
      testID={`activity-${item.hash.slice(0, 10)}`}
      onPress={onPress}
      trailing={<AssetAmount value={item.direction === 'in' ? item.amount : -item.amount} asset={item.asset} size="small" signed />}
    />
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.s, flexShrink: 1 },
  name: { flexShrink: 1 },
  balances: { gap: 0 },
  // Line up with the asset names: dot width plus the Row's gap.
  gas: { marginLeft: ASSET_DOT_SIZE + space.m, marginTop: -space.s },
  faucet: { marginLeft: ASSET_DOT_SIZE + space.m, marginTop: space.m },
  actions: { flexDirection: 'row', gap: space.s, marginTop: space.xl },
  action: { flex: 1, paddingHorizontal: space.s },
  sectionTitle: { marginTop: space.xxl, marginBottom: space.s },
});
