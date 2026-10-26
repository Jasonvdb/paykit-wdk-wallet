// You tab: profile, your pubky and QR, what you publish publicly, recovery
// phrase, test funds, network details, sync status and log.
//
// Phase 1 shows your identity and the Paykit sync status and event log, so
// developers can watch the loop work. The loop never signs in by itself
// (staging rate-limits sign-ins), so when a round fails, "Reconnect" builds
// a fresh connection: saved session first, then sign-in.
//
// TODO(Phase 3 — Identity): profile (name, photo) editing, pay-me QR,
// public endpoint toggles (BTC / USD₮), network details ("Paykit" and
// "Noise" may appear here, nowhere else).
// TODO(Phase 2 — Wallet): recovery phrase reveal, "Get test USD₮"
// (useUsdtFaucet), collect BTC from contact accounts.
import { StyleSheet, View } from 'react-native';

import { STAGING_HOMESERVER } from '../../config/paykit';
import type { MainTabScreenProps } from '../../navigation/types';
import { usePaykit, useSyncLog, useSyncStatus, type SyncStatus } from '../../paykit';
import { Button, Divider, KeyText, Screen, Seal, Text, relativeTime, space } from '../../ui';

/** "Idle. 12 rounds, the last took 340 ms." */
function describeLoop(status: SyncStatus): string {
  const phase = status.phase === 'syncing' ? 'Syncing' : status.phase === 'paused' ? 'Paused while the app is in the background' : 'Idle';
  const rounds = `${status.rounds} ${status.rounds === 1 ? 'round' : 'rounds'}`;
  const last = status.lastRoundMs !== undefined ? `, the last took ${status.lastRoundMs} ms` : '';
  return `${phase}. ${rounds}${last}.`;
}

export function YouScreen(_props: MainTabScreenProps<'You'>) {
  const { service, connection, connect } = usePaykit();
  const reconnect = () => connect().catch(() => undefined);
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
          <Text color="alert">{connection.message}</Text>
          <Button label="Reconnect" variant="secondary" compact onPress={reconnect} testID="reconnect" />
        </View>
      ) : !status ? (
        <Text color="graphite">{connection.status === 'connecting' ? 'Connecting…' : 'Not connected'}</Text>
      ) : (
        <View style={styles.block} testID="sync-status">
          <Text>{describeLoop(status)}</Text>
          <Text color="graphite" variant="secondary">
            {status.linkedCount} linked, {status.linkingCount} connecting, {status.pendingOutboundCount} waiting to send
          </Text>
          {status.lastError ? (
            <>
              <Text color="alert" variant="secondary">
                The last round failed: {status.lastError}
              </Text>
              <Button label="Reconnect" variant="secondary" compact onPress={reconnect} testID="reconnect" />
            </>
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
            <Text variant="caption" color="graphite">
              {relativeTime(entry.at)}
            </Text>
            <Text variant="caption" color={entry.level === 'error' ? 'alert' : entry.level === 'warn' ? 'ink' : 'graphite'}>
              {entry.message}
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
