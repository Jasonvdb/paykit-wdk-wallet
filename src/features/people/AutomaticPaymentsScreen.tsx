// Set up automatic payments (modal): offer a contact to pay their payment
// requests without a tap each time, within limits.
//
//   asset        Bitcoin or USD₮ (one Allowance covers one asset)
//   per payment  the most one request may ask for
//   ends after   1 hour, 1 day or 1 week
//   summary      every limit in words (src/paykit/allowanceTerms.ts): the
//                demo also caps 10 payments and 4 payments' worth an hour,
//                and 10 payments' worth in all
//
// "Offer to Ben" proposes the Allowance (offerAutomaticPayments, as the
// payer). Nothing is paid until Ben's wallet accepts; the Person page then
// shows the limits and what has been used, with "Stop automatic payments".
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RootScreenProps } from '../../navigation/types';
import {
  allowanceTermsWords,
  buildAllowanceTerms,
  DEFAULT_DURATION,
  DEFAULT_PER_PAYMENT,
  describeError,
  DURATION_CHOICES,
  offerAutomaticPayments,
  PER_PAYMENT_CHOICES,
  readAllowanceTerms,
  useLinkState,
  usePaykit,
  userMessageFor,
  type DurationChoice,
} from '../../paykit';
import { Button, SegmentedControl, SheetScreen, Text, formatDateTime, linkStateWords, space } from '../../ui';
import { formatAssetAmount } from '../../wallet';
import { AssetPicker, type PayableAsset } from '../wallet/AssetPicker';
import { PersonHeader } from '../wallet/send/PersonRecipient';
import { usePersonName } from './usePersonName';

export function AutomaticPaymentsScreen({ navigation, route }: RootScreenProps<'AutomaticPayments'>) {
  const { pubky } = route.params;
  const { service, log } = usePaykit();
  const { name } = usePersonName(pubky);
  const linkState = useLinkState(pubky);
  const [asset, setAsset] = useState<PayableAsset>('usdt');
  const [perPayment, setPerPayment] = useState<bigint>(DEFAULT_PER_PAYMENT.usdt);
  const [duration, setDuration] = useState<DurationChoice>(DEFAULT_DURATION);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const close = () => navigation.goBack();

  // Recomputed on every change; the time is taken when the summary is shown and again when sent.
  const terms = useMemo(() => buildAllowanceTerms({ asset, perPayment, duration, nowMs: Date.now() }), [asset, perPayment, duration]);
  const summary = allowanceTermsWords(readAllowanceTerms(terms), formatDateTime);

  const chooseAsset = (next: PayableAsset) => {
    setAsset(next);
    setPerPayment(DEFAULT_PER_PAYMENT[next]);
  };

  const offer = async () => {
    if (!service || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await offerAutomaticPayments(service, pubky, buildAllowanceTerms({ asset, perPayment, duration, nowMs: Date.now() }));
      close();
    } catch (e) {
      log.warn(`offer automatic payments: ${describeError(e)}`);
      setError(userMessageFor(e, "Couldn't send the offer. Try again."));
      setSending(false);
    }
  };

  const linked = linkState === 'linked';
  return (
    <SheetScreen
      title="Automatic payments"
      onClose={close}
      testID="automatic-payments-screen"
      footer={<Button label={`Offer to ${name}`} onPress={() => void offer()} loading={sending} disabled={!service || !linked} testID="automatic-payments-offer" />}
    >
      <View style={styles.body}>
        <PersonHeader publicKey={pubky} sealSize={44} />
        <Text color="graphite">
          {`${name}'s payment requests within these limits are accepted and paid without asking you each time. Anything over a limit waits for you, as now. You can stop it at any time.`}
        </Text>
        {!linked ? (
          <Text color="graphite" testID="automatic-payments-not-linked">
            {`You can set this up once your private connection with ${name} is ready (${linkStateWords(linkState).toLowerCase()}).`}
          </Text>
        ) : null}
        <AssetPicker value={asset} onChange={chooseAsset} />
        <View style={styles.group}>
          <Text variant="secondary" color="graphite">
            Up to, for each payment
          </Text>
          <SegmentedControl
            accessibilityLabel="Most for one payment"
            value={perPayment.toString()}
            onChange={(value) => setPerPayment(BigInt(value))}
            options={PER_PAYMENT_CHOICES[asset].map((amount) => ({
              value: amount.toString(),
              label: formatAssetAmount(amount, asset, { withSymbol: asset === 'usdt' }),
              testID: `automatic-per-payment-${amount}`,
            }))}
          />
        </View>
        <View style={styles.group}>
          <Text variant="secondary" color="graphite">
            Ends after
          </Text>
          <SegmentedControl
            accessibilityLabel="Ends after"
            value={duration}
            onChange={setDuration}
            options={DURATION_CHOICES.map((choice) => ({ value: choice.id, label: choice.label, testID: `automatic-duration-${choice.id}` }))}
          />
        </View>
        <View style={styles.group}>
          <Text variant="heading">Your limits</Text>
          <Text testID="automatic-payments-summary">{summary}</Text>
          <Text variant="caption" color="graphite">
            {`${name} has to accept before anything is paid.`}
          </Text>
        </View>
        {error ? (
          <Text color="alert" testID="automatic-payments-error">
            {error}
          </Text>
        ) : null}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.l },
  group: { gap: space.s },
});
