// Activity detail (pushed): one on-chain transaction. Direction and amount
// as the headline, its status, the other side's address, the network fee,
// when it happened and a link to the public explorer.
//
// The item comes from useActivity() by id (route params carry ids, never
// records). BTC transfers from WDK carry only a block height, so for a
// confirmed BTC item the block time is read from Mutinynet's API.
//
// TODO(Phase 5 — Requests): link to the payment request and receipt. Put
// that in its own component (activity/ActivityPaykitLinks.tsx) and render
// it in the slot below the details.
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import type { RootScreenProps } from '../../navigation/types';
import { AssetAmount, Button, Chip, DetailRow, Divider, EmptyState, KeyText, PushedScreen, Text, formatDateTime, relativeTime, space } from '../../ui';
import { fetchBtcTransactionStatus, formatFee, transactionUrl, useActivity, type ActivityItem } from '../../wallet';
import { activityStatusWords, activityTitle, isFaucetMint, networkName } from './activity/activityText';

/** Block time for a confirmed BTC item (WDK only reports the height). */
function useBtcBlockTime(item: ActivityItem | undefined): number | undefined {
  const [blockTime, setBlockTime] = useState<number>();
  const hash = item?.chain === 'bitcoin' && item.status === 'confirmed' && item.timestamp === undefined ? item.hash : undefined;
  useEffect(() => {
    if (!hash) return;
    let cancelled = false;
    fetchBtcTransactionStatus(hash)
      .then((status) => !cancelled && setBlockTime(status?.blockTime))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hash]);
  return blockTime;
}

export function ActivityDetailScreen({ navigation, route }: RootScreenProps<'ActivityDetail'>) {
  const activity = useActivity();
  const item = activity.items.find((candidate) => candidate.id === route.params.activityId);
  const blockTime = useBtcBlockTime(item);
  const back = () => navigation.goBack();

  if (!item) {
    return (
      <PushedScreen title="Activity" onBack={back} testID="activity-detail">
        {activity.isLoading ? (
          <Text color="graphite">Loading…</Text>
        ) : (
          <EmptyState title="Not in recent activity" message="This transaction is no longer in the recent list." action={{ label: 'Back', onPress: back }} />
        )}
      </PushedScreen>
    );
  }

  const time = item.timestamp ?? blockTime;
  const counterpartyLabel = item.direction === 'in' ? 'From' : 'To';
  const feeAsset = item.chain === 'bitcoin' ? 'btc' : 'eth';

  return (
    <PushedScreen title={activityTitle(item)} onBack={back} testID="activity-detail">
      <View style={styles.headline}>
        <AssetAmount value={item.direction === 'in' ? item.amount : -item.amount} asset={item.asset} size="hero" signed />
        <Chip label={activityStatusWords(item)} tone={item.status === 'failed' ? 'alert' : 'neutral'} />
      </View>

      <View style={styles.details}>
        {isFaucetMint(item) ? (
          <DetailRow label="From" value="Aave’s Sepolia test-token faucet" />
        ) : item.counterpartyAddress ? (
          <DetailRow label={counterpartyLabel} value={<KeyText value={item.counterpartyAddress} full small testID="activity-counterparty" />} />
        ) : (
          <DetailRow label={counterpartyLabel} value="Not reported by the network" />
        )}
        <Divider />
        {item.fee !== undefined ? (
          <>
            <DetailRow label="Network fee" value={formatFee(item.fee, feeAsset)} />
            <Divider />
          </>
        ) : null}
        <DetailRow
          label="Time"
          value={time !== undefined ? formatDateTime(time) : item.status === 'pending' ? 'Waiting for the next block' : '—'}
          hint={time !== undefined ? relativeTime(time) : item.blockHeight ? `Block ${item.blockHeight.toLocaleString('en-US')}` : undefined}
        />
        <Divider />
        <DetailRow label="Network" value={networkName(item)} hint={item.accountIndex > 0 ? `Contact account ${item.accountIndex}` : undefined} />
        <Divider />
        <DetailRow label="Transaction" value={<KeyText value={item.hash} small />} />
      </View>

      {/* Phase 5: links to the payment request and receipt render here. */}

      <Button label="View on explorer" variant="secondary" onPress={() => void Linking.openURL(transactionUrl(item.chain, item.hash))} style={styles.explorer} />
    </PushedScreen>
  );
}

const styles = StyleSheet.create({
  headline: { gap: space.m, alignItems: 'flex-start', marginBottom: space.xl },
  details: { marginBottom: space.xl },
  explorer: { marginBottom: space.xl },
});
