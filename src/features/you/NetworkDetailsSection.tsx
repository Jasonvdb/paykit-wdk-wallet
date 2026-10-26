// You > Network details: the developer view of what this wallet talks to.
// It is the one place in the main UI (besides Welcome) where the words
// "Paykit" and "Noise" appear (docs/DESIGN.md), because this app is a
// reference for developers. "Homeserver" is fine elsewhere: DESIGN's own
// example error says "Couldn't reach Ana's homeserver".
//
//   Identity  your pubky, the homeserver, how the session started, the
//             Pubky capability, the Paykit app id and registry (Noise key,
//             key generation, registered apps)
//   Payments  the public endpoint ids you publish now, and how many
//             contacts have your Private Payment List (and you theirs)
//   Links     each contact's Encrypted Link recovery markers (ours and
//             theirs, by attempt id), and the backup revisions
//             (src/paykit/backup.ts)
//   Chains    Electrum (Mutinynet), Sepolia RPC, chain id, USD₮ contract,
//             explorer APIs
//   SDKs      WDK and Paykit package versions
//
// Everything shown is public or a status. The registry is read live (two
// SDK calls) when the section first renders, and on "Refresh".
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  MUTINYNET_API,
  MUTINYNET_ELECTRUM,
  SEPOLIA_BLOCKSCOUT_API,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_RPC,
  SEPOLIA_USDT,
} from '../../config/chains';
import { PAYKIT_APP_ID, PUBKY_CLIENT_ID, STAGING_HOMESERVER } from '../../config/paykit';
import { PAYKIT_PACKAGE, WDK_PACKAGES } from '../../config/versions';
import {
  describeError,
  loadNetworkDetails,
  usePaykit,
  usePrivateListSummary,
  usePublicEndpointStatus,
  userMessageFor,
  readBackupStatus,
  type BackupStatus,
  type NetworkDetails,
} from '../../paykit';
import { Button, DetailRow, Divider, KeyText, Text, formatDateTime, space } from '../../ui';
import { usePersonName } from '../people/usePersonName';

const SESSION_ORIGIN_WORDS = {
  import: 'Saved session, imported at launch',
  signIn: 'Signed in at launch',
  signUp: 'Signed up on this device',
} as const;

function countWords(count: number): string {
  return `${count} ${count === 1 ? 'contact' : 'contacts'}`;
}

export function NetworkDetailsSection() {
  const { service, log } = usePaykit();
  const endpointStatus = usePublicEndpointStatus();
  const privateLists = usePrivateListSummary();
  const [details, setDetails] = useState<NetworkDetails>();
  const [backup, setBackup] = useState<BackupStatus>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    setError(undefined);
    try {
      setDetails(await loadNetworkDetails(service));
      setBackup(await readBackupStatus(service));
    } catch (e) {
      log.warn(`network details: ${describeError(e)}`);
      setError(userMessageFor(e, "Couldn't read your Paykit registry. Try again."));
    } finally {
      setLoading(false);
    }
  }, [service, log]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows: { label: string; value: ReactNode; hint?: string }[] = [
    { label: 'Your pubky', value: service ? <KeyText value={service.publicKey} small /> : '—' },
    { label: 'Homeserver (Pubky staging)', value: <KeyText value={STAGING_HOMESERVER} small /> },
    { label: 'Session', value: service ? SESSION_ORIGIN_WORDS[service.sessionOrigin] : 'Not connected' },
    { label: 'Identity status', value: details?.capability ?? (loading ? 'Loading…' : '—') },
    { label: 'Paykit app id', value: PAYKIT_APP_ID, hint: `Pubky client id ${PUBKY_CLIENT_ID}` },
    {
      label: 'Paykit app registry',
      value: details ? (details.apps.map((app) => `${app.appId} (${app.displayName})`).join(', ') || 'No apps registered') : '—',
      hint: [details?.defaultAppId ? `Default app ${details.defaultAppId}` : undefined, details?.apps.map((app) => `${app.appId}: ${app.capabilities}`).join('; ')]
        .filter(Boolean)
        .join('. ') || undefined,
    },
    {
      label: 'Noise public key',
      value: details?.noisePublicKey ? <KeyText value={details.noisePublicKey} small /> : '—',
      hint: details?.keyGeneration !== undefined ? `Key generation ${details.keyGeneration}` : undefined,
    },
    {
      label: 'Published public endpoints',
      value: endpointStatus && endpointStatus.published.length > 0 ? endpointStatus.published.join('\n') : 'None',
      hint: endpointStatus?.failed.length ? `Failed: ${endpointStatus.failed.join(', ')}` : undefined,
    },
    {
      label: 'Private Payment Lists',
      value: privateLists ? `Yours shared with ${countWords(privateLists.sharedWith)}; received from ${countWords(privateLists.receivedFrom)}` : '—',
      hint: 'Sent over each Encrypted Link: that contact’s own Bitcoin address plus your USD₮ address.',
    },
    ...(details?.recoveryMarkers ?? []).map((marker) => ({
      label: `Encrypted Link recovery markers`,
      value: <MarkerWords counterparty={marker.counterparty} ours={marker.ours} theirs={marker.theirs} />,
      hint: [
        marker.oursAt ? `Ours published ${formatDateTime(Date.parse(marker.oursAt))}` : undefined,
        marker.theirsAt ? `theirs seen ${formatDateTime(Date.parse(marker.theirsAt))}` : undefined,
        marker.problem ? 'the last publish failed' : undefined,
      ]
        .filter(Boolean)
        .join(', ') || undefined,
    })),
    {
      label: 'Backup revision',
      value: backup ? backup.revision.slice(0, 16) : '—',
      hint: `backupStateRevision. observedBackupStateRevision: ${backup?.observedRevision ?? 'none'} (it is only kept in the SDK's shared-state storage mode; this app stores state on the phone).`,
    },
    {
      label: 'Bitcoin (Mutinynet signet)',
      value: `Electrum ${MUTINYNET_ELECTRUM.protocol}://${MUTINYNET_ELECTRUM.host}:${MUTINYNET_ELECTRUM.port}`,
      hint: `Fee rates and block times: ${MUTINYNET_API}`,
    },
    {
      label: `Ethereum Sepolia (chain id ${SEPOLIA_CHAIN_ID})`,
      value: `RPC ${SEPOLIA_RPC}`,
      hint: `History: ${SEPOLIA_BLOCKSCOUT_API}`,
    },
    { label: 'USD₮ token (Aave test USDT)', value: <KeyText value={SEPOLIA_USDT} small /> },
    {
      label: 'Paykit SDK',
      value: `${PAYKIT_PACKAGE.name} ${PAYKIT_PACKAGE.version}`,
      hint: `Built from ${PAYKIT_PACKAGE.source} at ${PAYKIT_PACKAGE.commit}`,
    },
    { label: 'WDK', value: WDK_PACKAGES.map((p) => `${p.name} ${p.version}`).join('\n') },
  ];

  return (
    <View testID="network-details">
      {rows.map((row, index) => (
        <View key={`${row.label}-${index}`}>
          {index > 0 ? <Divider /> : null}
          <DetailRow label={row.label} value={row.value} hint={row.hint} />
        </View>
      ))}
      {error ? (
        <Text variant="secondary" color="alert">
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button label="Refresh" variant="secondary" compact onPress={() => void load()} loading={loading} disabled={!service} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { marginTop: space.s, alignItems: 'flex-start' },
});

/** "Ben: ours 1a2b3c4d, theirs 5e6f7a8b" (attempt ids name a link's stream generation). */
function MarkerWords({ counterparty, ours, theirs }: { counterparty: string; ours?: string; theirs?: string }) {
  const { name } = usePersonName(counterparty);
  return <Text>{`${name}: ours ${ours ?? 'none'}, theirs ${theirs ?? 'none'}`}</Text>;
}
