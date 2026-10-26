// After a broadcast: what was sent, to whom, and the transaction hash with
// an explorer link. The send is "pending" in Activity until it is in a
// block; the screen says how long that usually takes.
import { Linking, StyleSheet, View } from 'react-native';

import { AssetAmount, Button, DetailRow, Divider, KeyText, Text, space } from '../../../ui';
import { CONFIRMATION_TIME, formatFee, type SendResult } from '../../../wallet';
import type { PayableAsset } from '../AssetPicker';

export type SendSuccessProps = {
  asset: PayableAsset;
  amount: bigint;
  toLabel: string;
  /** True when `toLabel` is a person's name, not an address. */
  toIsName?: boolean;
  result: SendResult;
  onDone: () => void;
  /** What happens next, for a payment that is part of something (a request). */
  next?: string;
};

export function SendSuccess({ asset, amount, toLabel, toIsName, result, onDone, next }: SendSuccessProps) {
  return (
    <View style={styles.root} testID="send-success">
      <View style={styles.headline}>
        <Text variant="title">Sent</Text>
        <AssetAmount value={amount} asset={asset} size="hero" />
        <Text color="graphite">
          {asset === 'btc'
            ? `It shows as pending in Activity until the next Mutinynet block, in ${CONFIRMATION_TIME.bitcoin}.`
            : `It shows as pending in Activity until the next Sepolia block, in ${CONFIRMATION_TIME.ethereum}.`}
        </Text>
        {next ? (
          <Text color="seal" testID="send-next">
            {next}
          </Text>
        ) : null}
      </View>
      <View>
        <DetailRow label="To" value={toIsName ? toLabel : <KeyText value={toLabel} full small copyable={false} />} />
        {result.fee !== undefined ? (
          <>
            <Divider />
            <DetailRow label="Network fee" value={formatFee(result.fee, asset === 'btc' ? 'btc' : 'eth')} />
          </>
        ) : null}
        <Divider />
        <DetailRow label="Transaction" value={<KeyText value={result.hash} small testID="send-hash" />} />
      </View>
      <View style={styles.actions}>
        <Button label="View on explorer" variant="secondary" onPress={() => void Linking.openURL(result.explorerUrl)} />
        <Button label="Done" onPress={onDone} testID="send-done" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.xl },
  headline: { gap: space.s },
  actions: { gap: space.s },
});
