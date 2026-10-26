// You > What you publish: switch public payment addresses on or off per
// asset, see whether the last publish worked, and check what other people
// see when they look up your pubky.
//
// Public endpoints are your account-0 addresses, published on your
// homeserver for anyone. Switching one off removes it there; people who
// try to pay you that asset by pubky are told you don't accept it.
// Contacts are not affected: they get private, per-contact addresses.
import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import {
  acceptedAssets,
  describeError,
  resolvePublicPaymentOptions,
  usePaykit,
  usePublicEndpointStatus,
  userMessageFor,
  type PayeeAsset,
  type PublicEndpointChoice,
  type PublicEndpointStatus,
} from '../../paykit';
import { AssetDot, Button, Divider, Text, colors, middleEllipsis, relativeTime, space } from '../../ui';
import { ASSETS, useWalletAddresses } from '../../wallet';


function statusWords(status: PublicEndpointStatus | undefined): string {
  switch (status?.state) {
    case 'publishing':
      return 'Publishing…';
    case 'published':
      return `Up to date${status.at ? `, published ${relativeTime(status.at).toLowerCase()}` : ''}.`;
    case 'failed':
      return "Couldn't publish the last change. It is retried every few seconds while the app is open.";
    default:
      return 'Waiting for your addresses…';
  }
}

export function PublicEndpointsSection() {
  const { service, log } = usePaykit();
  const addresses = useWalletAddresses();
  const status = usePublicEndpointStatus();
  const [choice, setChoice] = useState<PublicEndpointChoice | undefined>(() => service?.publicEndpointChoice());
  const [check, setCheck] = useState<{ busy: boolean; result?: string; error?: string }>({ busy: false });

  if (!service) return <Text color="graphite">Connecting…</Text>;
  const current = choice ?? service.publicEndpointChoice();

  const toggle = (asset: PayeeAsset, on: boolean) => {
    const next = { ...current, [asset]: on };
    setChoice(next);
    setCheck({ busy: false });
    void service.setPublicEndpointChoice(next);
  };

  const onCheck = async () => {
    setCheck({ busy: true });
    try {
      const { options } = await resolvePublicPaymentOptions(service, service.publicKey);
      const seen = acceptedAssets(options).map((asset) => ASSETS[asset].displayName);
      setCheck({
        busy: false,
        result: seen.length > 0 ? `Anyone who looks up your pubky can pay you in ${seen.join(' and ')}.` : 'Your pubky shows no payment addresses.',
      });
    } catch (e) {
      log.warn(`check public endpoints: ${describeError(e)}`);
      setCheck({ busy: false, error: userMessageFor(e, "Couldn't look up your pubky. Try again.") });
    }
  };

  const rows: { asset: PayeeAsset; address?: string }[] = [
    { asset: 'btc', address: addresses.btc },
    { asset: 'usdt', address: addresses.evm },
  ];

  return (
    <View style={styles.root} testID="public-endpoints">
      <Text color="graphite">
        Public addresses let anyone pay you by your pubky. Contacts get their own private addresses either way.
      </Text>
      <View>
        {rows.map(({ asset, address }, index) => (
          <View key={asset}>
            {index > 0 ? <Divider /> : null}
            <View style={styles.row}>
              <AssetDot asset={asset} />
              <View style={styles.rowText}>
                <Text>{ASSETS[asset].displayName}</Text>
                <Text variant="monoSmall" color="graphite">
                  {address ? middleEllipsis(address) : '—'}
                </Text>
              </View>
              <Switch
                value={current[asset]}
                onValueChange={(on) => toggle(asset, on)}
                disabled={status?.state === 'publishing'}
                trackColor={{ true: colors.seal, false: colors.rule }}
                thumbColor={colors.sheet}
                accessibilityLabel={`Publish my ${ASSETS[asset].displayName} address`}
                testID={`publish-${asset}`}
              />
            </View>
          </View>
        ))}
      </View>
      <Text variant="secondary" color={status?.state === 'failed' ? 'alert' : 'graphite'} testID="public-endpoints-status">
        {statusWords(status)}
      </Text>
      <Button label="Check what others see" variant="secondary" compact onPress={onCheck} loading={check.busy} testID="public-endpoints-check" />
      {check.result ? (
        <Text variant="secondary" testID="public-endpoints-check-result">
          {check.result}
        </Text>
      ) : null}
      {check.error ? (
        <Text variant="secondary" color="alert">
          {check.error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.m },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m },
  rowText: { flex: 1, gap: 2 },
});
