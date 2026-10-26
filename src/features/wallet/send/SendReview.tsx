// Review before sending: the amount as the headline, where it goes, and the
// network fee WDK quoted. The button names the action ("Send 12 USD₮").
//
// If the fee does not fit (BTC: amount + fee above the balance; USD₮: not
// enough ETH for gas) the problem replaces the button's promise: it is shown
// in Alert and the button is disabled, so nothing is broadcast that would
// fail.
//
// If a send failed in a way that may still have reached the network
// (`outcomeUnknown`), Send stays disabled for good and the only way on is
// to close and check Activity: a second tap could pay twice.
//
// Paying a payment request (src/features/requests/PayRequestScreen.tsx)
// uses this same review with the amount and recipient locked: no "Change"
// button (`onEdit` left out), its own button label and a line saying which
// request it pays.
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AssetAmount, Button, DetailRow, Divider, KeyText, Text, space } from '../../../ui';
import { CONFIRMATION_TIME, formatAssetAmount, formatFee, type FeeQuote, type SendProblem } from '../../../wallet';
import type { PayableAsset } from '../AssetPicker';
import { PersonRecipient } from './PersonRecipient';
import type { SendRecipient } from './recipient';

export type SendReviewProps = {
  asset: PayableAsset;
  amount: bigint;
  recipient: SendRecipient;
  address: string;
  quote: FeeQuote;
  problem?: SendProblem;
  sending: boolean;
  /** The last send may have been broadcast: never offer Send again. */
  outcomeUnknown?: boolean;
  error?: string;
  onSend: () => void;
  /** Left out when the amount and recipient are fixed (paying a request). */
  onEdit?: () => void;
  onClose: () => void;
  /** Replaces "Send 12 USD₮" ("Pay 12 USD₮"). */
  sendLabel?: string;
  /** Shown under the amount: what this payment is for. */
  context?: ReactNode;
};

const NETWORK: Record<PayableAsset, string> = {
  btc: `Bitcoin (Mutinynet). Confirms in ${CONFIRMATION_TIME.bitcoin}.`,
  usdt: `Ethereum Sepolia. Confirms in ${CONFIRMATION_TIME.ethereum}.`,
};

export function SendReview({ asset, amount, recipient, address, quote, problem, sending, outcomeUnknown, error, onSend, onEdit, onClose, sendLabel, context }: SendReviewProps) {
  const amountText = formatAssetAmount(amount, asset, { withSymbol: true });
  return (
    <View style={styles.root} testID="send-review">
      <View>
        <Text variant="secondary" color="graphite">
          You send
        </Text>
        <AssetAmount value={amount} asset={asset} size="hero" />
        {context}
      </View>

      <View>
        <DetailRow
          label="To"
          value={
            recipient.kind === 'address' ? <KeyText value={address} full small copyable={false} /> : <PersonRecipient recipient={recipient} address={address} />
          }
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
        {outcomeUnknown ? (
          <Button label="Close and check Activity" onPress={onClose} testID="send-check-activity" />
        ) : (
          <>
            <Button
              label={sending ? 'Sending…' : (sendLabel ?? `Send ${amountText}`)}
              onPress={onSend}
              loading={sending}
              disabled={!!problem}
              testID="send-confirm"
            />
            {onEdit ? <Button label="Change amount or recipient" variant="secondary" onPress={onEdit} disabled={sending} testID="send-edit" /> : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.xl },
  actions: { gap: space.s },
});
