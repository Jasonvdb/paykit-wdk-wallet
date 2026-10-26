// You tab: profile, your pubky and QR, what you publish publicly, recovery
// phrase, test funds, network details, sync status and log.
//
// Phase 1 shows your identity and the Paykit sync status and event log, so
// developers can watch the loop work.
//
// TODO(Phase 3 — Identity): profile (name, photo) editing, pay-me QR,
// public endpoint toggles (BTC / USD₮), network details ("Paykit" and
// "Noise" may appear here, nowhere else).
// TODO(Phase 2 — Wallet): recovery phrase reveal, "Get test USD₮"
// (useUsdtFaucet), collect BTC from contact accounts.
import { StyleSheet, View } from 'react-native';

import { STAGING_HOMESERVER } from '../../config/paykit';
import type { MainTabScreenProps } from '../../navigation/types';
import { usePaykit, useSyncLog, useSyncStatus } from '../../paykit';
import { Button, Divider, KeyText, Screen, Seal, Text, relativeTime, space } from '../../ui';

export function YouScreen(_props: MainTabScreenProps<'You'>) {
  const { service, connection, connect } = usePaykit();
  const status = useSyncStatus();
  const log = useSyncLog();

  return (
    <Screen scroll title="You" edges={['top']} testID="you-screen">
      {service ? (
        <View style={styles.identity}>
          <Seal pubky={service.publicKey} size={72} />
          <KeyText value={service.publicKey} full small testID="own-pubky" />
        </View>
      ) : null}

      <Text variant="heading" style={styles.section}>
        Sync status
      </Text>
      {connection.status === 'error' ? (
        <View style={styles.block}>
          <Text color="alert">Couldn’t connect: {connection.message}</Text>
          <Button label="Try again" variant="secondary" compact onPress={() => connect().catch(() => undefined)} />
        </View>
      ) : !status ? (
        <Text color="graphite">{connection.status === 'connecting' ? 'Connecting…' : 'Not connected'}</Text>
      ) : (
        <View style={styles.block} testID="sync-status">
          <Text>
            {status.phase === 'syncing' ? 'Syncing…' : status.phase === 'paused' ? 'Paused (app in background)' : 'Idle'} ·{' '}
            {status.rounds} rounds
            {status.lastRoundMs !== undefined ? ` · last ${status.lastRoundMs} ms` : ''}
          </Text>
          <Text color="graphite" variant="secondary">
            {status.linkedCount} linked · {status.linkingCount} connecting · {status.pendingOutboundCount} waiting to send
          </Text>
          {status.lastError ? (
            <Text color="alert" variant="secondary">
              {status.lastError}
            </Text>
          ) : null}
          <Button label="Sync now" variant="secondary" compact onPress={() => service?.syncLoop.flush()} />
        </View>
      )}

      <Text variant="caption" color="graphite" style={styles.section}>
        Homeserver (staging)
      </Text>
      <KeyText value={STAGING_HOMESERVER} small />

      <Text variant="heading" style={styles.section}>
        Event log
      </Text>
      {log.slice(0, 40).map((entry, index) => (
        <View key={entry.id}>
          {index > 0 ? <Divider /> : null}
          <View style={styles.logRow}>
            <Text variant="caption" color={entry.level === 'error' ? 'alert' : entry.level === 'warn' ? 'ink' : 'graphite'}>
              {relativeTime(entry.at)} · {entry.message}
            </Text>
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { gap: space.m, alignItems: 'flex-start' },
  section: { marginTop: space.xl, marginBottom: space.s },
  block: { gap: space.s, alignItems: 'flex-start' },
  logRow: { paddingVertical: space.s },
});
