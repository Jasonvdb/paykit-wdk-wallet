// You tab: profile, your pay-me code, what you publish publicly, test
// funds, Bitcoin from contacts, recovery phrase, contacts and requests
// backup, network details, sync status and log.
//
// The sync status and event log are here so developers can watch the loop
// work. The loop never signs in by itself (staging rate-limits sign-ins),
// so when a round fails, "Reconnect" builds a fresh connection: saved
// session first, then sign-in.
//
// Sections, each in its own file next to this screen:
//   identity  profile (name, photo; edited in the EditProfile modal), your
//             pay-me code and what you publish (public endpoint switches)
//   money     test funds ("Get test USD₮") and Bitcoin from contacts
//             (collect)
//   safety    recovery phrase, and the contacts and requests backup (make,
//             copy or share, check; resume automatic payments after a
//             restore)
//   network   network details ("Paykit" and "Noise" may appear there,
//             nowhere else in the main UI), sync status and log
import { StyleSheet, View } from 'react-native';

import type { MainTabScreenProps } from '../../navigation/types';
import { usePaykit, useSyncLog, useSyncStatus, type SyncStatus } from '../../paykit';
import { Button, Divider, Screen, Text, relativeTime, space } from '../../ui';
import { PayMeCode } from '../wallet/receive/PayMeCode';
import { BackupSection } from './BackupSection';
import { ContactAccountsSection } from './ContactAccountsSection';
import { NetworkDetailsSection } from './NetworkDetailsSection';
import { ProfileSection } from './ProfileSection';
import { PublicEndpointsSection } from './PublicEndpointsSection';
import { RecoveryPhraseSection } from './RecoveryPhraseSection';
import { TestFundsSection } from './TestFundsSection';

/** "Idle. 12 rounds, the last took 340 ms." */
function describeLoop(status: SyncStatus): string {
  const phase = status.phase === 'syncing' ? 'Syncing' : status.phase === 'paused' ? 'Paused while the app is in the background' : 'Idle';
  const rounds = `${status.rounds} ${status.rounds === 1 ? 'round' : 'rounds'}`;
  const last = status.lastRoundMs !== undefined ? `, the last took ${status.lastRoundMs} ms` : '';
  return `${phase}. ${rounds}${last}.`;
}

export function YouScreen({ navigation }: MainTabScreenProps<'You'>) {
  const { service, connection, connect } = usePaykit();
  const reconnect = () => connect().catch(() => undefined);
  const status = useSyncStatus();
  const log = useSyncLog();

  return (
    <Screen scroll title="You" edges={['top']} testID="you-screen">
      <ProfileSection onEdit={() => navigation.navigate('EditProfile')} />

      <Text variant="heading" style={styles.section}>
        Your pay-me code
      </Text>
      <PayMeCode qrSize={168} showHeading={false} />

      <Text variant="heading" style={styles.section}>
        What you publish
      </Text>
      <PublicEndpointsSection />

      <Text variant="heading" style={styles.section}>
        Test funds
      </Text>
      <TestFundsSection />

      <Text variant="heading" style={styles.section}>
        Bitcoin from contacts
      </Text>
      <ContactAccountsSection />

      <Text variant="heading" style={styles.section}>
        Recovery phrase
      </Text>
      <RecoveryPhraseSection />

      <Text variant="heading" style={styles.section}>
        Contacts and requests backup
      </Text>
      <BackupSection />

      <Text variant="heading" style={styles.section}>
        Network details
      </Text>
      <NetworkDetailsSection />

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
  section: { marginTop: space.xl, marginBottom: space.s },
  block: { gap: space.s, alignItems: 'flex-start' },
  logRow: { paddingVertical: space.s },
});
