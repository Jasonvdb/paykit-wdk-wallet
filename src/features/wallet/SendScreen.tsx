// Send (modal): To -> asset -> amount -> review fee -> sent.
//
// Three steps in one screen:
//   compose  recipient field, asset picker, amount (with Max)
//   review   WDK's fee quote, affordability check, "Send 12 USD₮"
//   sent     hash, explorer link; the send is already in Activity as pending
//
// Checks happen as early as they can: the recipient field refuses mainnet
// and wrong-chain addresses, the amount is checked against the balance
// before asking for a fee, and the review checks amount + fee (BTC) or ETH
// for gas (USD₮) before the Send button is enabled.
//
// Recipients plug in through ./send/recipient.ts: each way of choosing who
// to pay is a field component that reports a SendRecipient.
// TODO(Phase 3 — Public payments): when `to` is a pubky, render a pubky
// recipient field (send/PubkyRecipientField.tsx) that resolves it with
// PaykitService.resolvePeer() and reports its public endpoints.
// TODO(Phase 4 — Private payments): for linked contacts, a contact field
// that reports their private endpoints (src/paykit/privatePayments.ts).
import * as Haptics from 'expo-haptics';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RootScreenProps } from '../../navigation/types';
import { Button, SheetScreen, Text, space } from '../../ui';
import {
  checkAffordable,
  fetchBtcFeeRate,
  formatUnits,
  parseAssetAmount,
  sendErrorMessage,
  useSend,
  useWalletBalances,
  ASSETS,
  type FeeQuote,
  type SendResult,
} from '../../wallet';
import { AssetPicker, isPayableAsset, type PayableAsset } from './AssetPicker';
import { AddressRecipientField } from './send/AddressRecipientField';
import { AmountField } from './send/AmountField';
import type { SendRecipient } from './send/recipient';
import { SendReview } from './send/SendReview';
import { SendSuccess } from './send/SendSuccess';

type Step = { name: 'compose' } | { name: 'review'; quote: FeeQuote } | { name: 'sent'; result: SendResult };

const PARSE_ERRORS = {
  empty: undefined,
  invalid: 'Enter a number, like 0.0005 or 12.50.',
  'too-many-decimals': 'That has more decimal places than this asset allows.',
} as const;

export function SendScreen({ navigation, route }: RootScreenProps<'Send'>) {
  const wallet = useSend();
  const { balances, refresh } = useWalletBalances();

  const initialAsset = route.params?.asset;
  const [asset, setAsset] = useState<PayableAsset>(isPayableAsset(initialAsset) ? initialAsset : 'btc');
  const [recipient, setRecipient] = useState<SendRecipient>();
  const [amountText, setAmountText] = useState('');
  const [step, setStep] = useState<Step>({ name: 'compose' });
  const [busy, setBusy] = useState<'max' | 'quote' | 'send' | null>(null);
  const [error, setError] = useState<string>();

  const parsed = parseAssetAmount(amountText, asset);
  const amount = parsed.ok ? parsed.value : undefined;
  const address = recipient?.addresses[asset];
  const preQuoteProblem = amount !== undefined ? checkAffordable({ asset, amount, balances }) : undefined;
  const reviewProblem =
    step.name === 'review' && amount !== undefined ? checkAffordable({ asset, amount, balances, fee: step.quote.fee }) : undefined;

  // Stable, so recipient fields can report from an effect without looping.
  const onRecipientChange = useCallback((next: SendRecipient | undefined) => setRecipient(next), []);

  const changeAsset = (next: PayableAsset) => {
    setAsset(next);
    setError(undefined);
  };

  const onMax = async () => {
    setError(undefined);
    if (asset === 'usdt') {
      if (balances.usdt !== undefined) setAmountText(formatUnits(balances.usdt, ASSETS.usdt.decimals));
      return;
    }
    setBusy('max');
    try {
      const rate = await fetchBtcFeeRate().catch(() => undefined);
      const max = await wallet.maxBtcAmount(rate);
      setAmountText(max > 0n ? formatUnits(max, ASSETS.btc.decimals) : '0');
    } catch (e) {
      setError(sendErrorMessage(e, 'btc'));
    } finally {
      setBusy(null);
    }
  };

  const onReview = async () => {
    if (!address || amount === undefined) return;
    setBusy('quote');
    setError(undefined);
    try {
      const quote = await wallet.quote({ asset, to: address, amount });
      setStep({ name: 'review', quote });
    } catch (e) {
      setError(sendErrorMessage(e, asset));
    } finally {
      setBusy(null);
    }
  };

  const onSend = async () => {
    if (step.name !== 'review' || !address || amount === undefined) return;
    setBusy('send');
    setError(undefined);
    try {
      const result = await wallet.send({ asset, to: address, amount, feeRate: step.quote.feeRate });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep({ name: 'sent', result });
      void refresh();
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(sendErrorMessage(e, asset));
    } finally {
      setBusy(null);
    }
  };

  // "Enter an amount above zero" would nag while someone types "0.0…"; the
  // disabled Review button says enough for that case.
  const amountError = parsed.ok
    ? preQuoteProblem?.kind === 'amount' || preQuoteProblem?.kind === 'gas'
      ? undefined
      : preQuoteProblem?.message
    : PARSE_ERRORS[parsed.reason];
  // USD₮ pays its network fee in ETH. Say so before anything is typed, so a
  // wallet with USD₮ but no ETH learns why it cannot send.
  const noGas = asset === 'usdt' && balances.eth === 0n;

  const close = () => navigation.goBack();

  if (step.name === 'sent' && amount !== undefined) {
    return (
      <SheetScreen title="Send" onClose={close} testID="send-screen">
        <SendSuccess asset={asset} amount={amount} toLabel={recipient?.label ?? address ?? ''} result={step.result} onDone={close} />
      </SheetScreen>
    );
  }

  if (step.name === 'review' && recipient && address && amount !== undefined) {
    return (
      <SheetScreen title="Review" onClose={close} testID="send-screen">
        <SendReview
          asset={asset}
          amount={amount}
          recipient={recipient}
          address={address}
          quote={step.quote}
          problem={reviewProblem}
          sending={busy === 'send'}
          error={error}
          onSend={onSend}
          onEdit={() => {
            setError(undefined);
            setStep({ name: 'compose' });
          }}
        />
      </SheetScreen>
    );
  }

  const canReview = !!address && amount !== undefined && amount > 0n && !preQuoteProblem && busy === null;
  return (
    <SheetScreen
      title="Send"
      onClose={close}
      testID="send-screen"
      footer={
        <Button
          label={busy === 'quote' ? 'Getting the network fee…' : 'Review'}
          onPress={onReview}
          loading={busy === 'quote'}
          disabled={!canReview}
          testID="send-review-button"
        />
      }
    >
      <View style={styles.body}>
        <AddressRecipientField asset={asset} initialText={route.params?.to} onChange={onRecipientChange} />
        <AssetPicker value={asset} onChange={changeAsset} />
        <AmountField
          asset={asset}
          text={amountText}
          onChangeText={(text) => {
            // Decimal keypads in many locales type "," for the decimal
            // point. parseAssetAmount reads "," as a thousands separator, so
            // "0,5" would become 5: treat a typed comma as the decimal point.
            setAmountText(text.replace(/,/g, '.'));
            setError(undefined);
          }}
          balance={balances[asset]}
          onMax={onMax}
          maxLoading={busy === 'max'}
          error={amountError ?? error}
        />
        {noGas ? (
          <Text color="alert" testID="send-no-gas">
            Not enough ETH for gas. USD₮ transfers pay their network fee in Sepolia ETH, and this wallet has none. Send a little to your
            USD₮ address first.
          </Text>
        ) : null}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
});
