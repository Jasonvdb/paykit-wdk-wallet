// Review before sending: the amount as the headline, where it goes, and the
// network fee WDK quoted. The button names the action ("Send 12 USD₮").
//
// If the fee does not fit (BTC: amount + fee above the balance; USD₮: not
// enough ETH for gas) the problem replaces the button's promise: it is shown
// in Alert and the button is disabled, so nothing is broadcast that would
// fail.
import { StyleSheet, View } from 'react-native';

import { AssetAmount, Button, DetailRow, Divider, KeyText, Text, space } from '../../../ui';
import { formatAssetAmount, formatFee, type FeeQuote, type SendProblem } from '../../../wallet';
import type { PayableAsset } from '../AssetPicker';
import type { SendRecipient } from './recipient';

export type SendReviewProps = {
  asset: PayableAsset;
  amount: bigint;
  recipient: SendRecipient;
  address: string;
  quote: FeeQuote;
  problem?: SendProblem;
  sending: boolean;
  error?: string;
  onSend: () => void;
  onEdit: () => void;
};

const NETWORK: Record<PayableAsset, string> = {
  btc: 'Bitcoin (Mutinynet). Confirms in about 30 seconds.',
  usdt: 'Ethereum Sepolia. Confirms in about 12 seconds.',
};

export function SendReview({ asset, amount, recipient, address, quote, problem, sending, error, onSend, onEdit }: SendReviewProps) {
  const amountText = formatAssetAmount(amount, asset, { withSymbol: true });
  return (
    <View style={styles.root} testID="send-review">
      <View>
        <Text variant="secondary" color="graphite">
          You send
        </Text>
        <AssetAmount value={amount} asset={asset} size="hero" />
      </View>

      <View>
        <DetailRow
          label="To"
          value={recipient.kind === 'address' ? <KeyText value={address} full small copyable={false} /> : <Text>{recipient.label}</Text>}
        />
        <Divider />
        <DetailRow
          label="Network fee"
          value={formatFee(quote.fee, quote.feeAsset)}
          hint={
            quote.feeRate !== undefined
              ? `${quote.feeRate} sat/vB, paid in BTC`
              : asset === 'usdt'
                ? 'Paid in Sepolia ETH: token transfers need gas.'
                : undefined
          }
          testID="send-fee"
        />
        {asset === 'btc' ? (
          <>
            <Divider />
            <DetailRow label="Total" value={formatAssetAmount(amount + quote.fee, 'btc', { withSymbol: true })} />
          </>
        ) : null}
        <Divider />
        <DetailRow label="Network" value={NETWORK[asset]} />
      </View>

      {problem ? (
        <Text color="alert" testID="send-problem">
          {problem.message}
        </Text>
      ) : null}
      {error ? (
        <Text color="alert" testID="send-error">
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={sending ? 'Sending…' : `Send ${amountText}`}
          onPress={onSend}
          loading={sending}
          disabled={!!problem}
          testID="send-confirm"
        />
        <Button label="Change" variant="secondary" onPress={onEdit} disabled={sending} testID="send-edit" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.xl },
  actions: { gap: space.s },
});
