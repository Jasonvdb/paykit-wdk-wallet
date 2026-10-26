// Pay request (modal): the Send review for a payment request, with the
// amount and recipient locked.
//
//   preparing  preparePayment: claim the request for this app and resolve
//              the address it binds (src/paykit/requests.ts), then WDK's
//              fee quote. Nothing is accepted or reserved yet. Without the
//              balance (or ETH for gas) it stops here and says so, showing
//              who and how much.
//   review     the existing Send review (wallet/send/SendReview.tsx), with
//              "Pay 12 USD₮" and the request it pays; no way to change the
//              amount or address
//   sending    startPayment (accept if needed, ledger reserve + begin),
//              then WDK sends, then finishPayment (the hash goes into the
//              request book; Bitcoin's proof goes out right away, USD₮'s
//              after its block, signed by WDK)
//   sent       the hash, and what happens next (their check and receipt)
//
// Double payment: a ref guards the Pay handler, the ledger refuses a second
// attempt for the same request or period, and a send whose outcome is
// unclear leaves the review disabled ("Close and check Activity") and the
// payment reserved. A recurring request pays the period in `periodStart`,
// or the oldest one due.
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RootScreenProps } from '../../navigation/types';
import {
  describeError,
  finishPayment,
  preparePayment,
  startPayment,
  usePaykit,
  usePaymentRequest,
  useRequestFacts,
  userMessageFor,
  type BillingPeriod,
  type PreparedPayment,
} from '../../paykit';
import { AssetAmount, Button, SheetScreen, Text, formatDateTime, space } from '../../ui';
import { checkAffordable, formatAssetAmount, sendErrorMessage, sendFailureFor, useSend, useWalletBalances, type FeeQuote, type SendResult } from '../../wallet';
import { usePersonName } from '../people/usePersonName';
import { PersonRecipient } from '../wallet/send/PersonRecipient';
import { SendReview } from '../wallet/send/SendReview';
import { SendSuccess } from '../wallet/send/SendSuccess';
import { scheduleStatus } from './requestSchedule';

type Step =
  | { name: 'preparing' }
  | { name: 'cannot'; message: string }
  /** Prepared, but this wallet can't pay it now (balance, gas): the payment shown, with why. */
  | { name: 'blocked'; prepared: PreparedPayment; message: string }
  | { name: 'review'; prepared: PreparedPayment; quote: FeeQuote; outcomeUnknown?: boolean }
  | { name: 'sent'; prepared: PreparedPayment; result: SendResult };

export function PayRequestScreen({ navigation, route }: RootScreenProps<'PayRequest'>) {
  const { counterparty, requestId, periodStart } = route.params;
  const { service, log } = usePaykit();
  const wallet = useSend();
  const { balances, refresh } = useWalletBalances();
  const view = usePaymentRequest(counterparty, requestId);
  const { name } = usePersonName(counterparty);
  const facts = useRequestFacts(view, name);
  const [step, setStep] = useState<Step>({ name: 'preparing' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const started = useRef(false);
  const latestBalances = useRef(balances);
  latestBalances.current = balances;
  const close = () => navigation.goBack();

  // Prepare once, as soon as the request is loaded.
  useEffect(() => {
    if (started.current || !service || !view || !facts) return;
    started.current = true;
    void (async () => {
      try {
        let period: BillingPeriod | undefined;
        const recurrence = view.terms?.recurrence;
        if (recurrence) {
          const due = scheduleStatus(recurrence, facts, Date.now())?.due ?? [];
          period = periodStart ? due.find((p) => p.startsAt === periodStart) : due[0];
          if (!period) {
            setStep({ name: 'cannot', message: 'Nothing is due right now. The request page shows when the next payment is due.' });
            return;
          }
        }
        const prepared = await preparePayment(service, counterparty, requestId, period);
        // Like Send: say "Not enough USD₮" before asking WDK for a fee it can't quote.
        const problem = checkAffordable({ asset: prepared.asset, amount: prepared.amount, balances: latestBalances.current });
        if (problem) {
          setStep({ name: 'blocked', prepared, message: problem.message });
          return;
        }
        try {
          const quote = await wallet.quote({ asset: prepared.asset, to: prepared.address, amount: prepared.amount });
          setStep({ name: 'review', prepared, quote });
        } catch (e) {
          setStep({ name: 'blocked', prepared, message: sendErrorMessage(e, prepared.asset) });
        }
      } catch (e) {
        log.warn(`prepare request payment: ${describeError(e)}`);
        setStep({ name: 'cannot', message: userMessageFor(e, sendErrorMessage(e, view.terms?.asset ?? 'btc')) });
      }
    })();
  }, [service, view, facts, periodStart, counterparty, requestId, wallet, log]);

  const onPay = async () => {
    if (step.name !== 'review' || step.outcomeUnknown || !service || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(undefined);
    const { prepared, quote } = step;
    let attemptId: string;
    try {
      attemptId = await startPayment(service, prepared);
    } catch (e) {
      // Nothing was sent.
      log.warn(`start request payment: ${describeError(e)}`);
      setError(userMessageFor(e, "Couldn't start the payment. Try again."));
      inFlight.current = false;
      setSending(false);
      return;
    }
    try {
      const result = await wallet.send({ asset: prepared.asset, to: prepared.address, amount: prepared.amount, feeRate: quote.feeRate });
      await finishPayment(service, prepared, attemptId, { hash: result.hash }).catch((e) => log.warn(`finish request payment: ${describeError(e)}`));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep({ name: 'sent', prepared, result });
      void refresh();
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const failure = sendFailureFor(e, prepared.asset);
      await finishPayment(service, prepared, attemptId, { failure: failure.outcome }).catch((err) => log.warn(`record request payment failure: ${describeError(err)}`));
      setError(failure.message);
      if (failure.outcome === 'unknown') setStep({ ...step, outcomeUnknown: true });
      void refresh();
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  if (step.name === 'sent') {
    return (
      <SheetScreen title="Pay request" onClose={close} testID="pay-request-screen">
        <SendSuccess
          asset={step.prepared.asset}
          amount={step.prepared.amount}
          toLabel={name}
          toIsName
          result={step.result}
          onDone={close}
          next={
            step.prepared.asset === 'btc'
              ? `Your proof of payment is on its way to ${name}. They check it on chain and send you a receipt.`
              : `Once it is in a block, your wallet signs a proof of payment for ${name}. They check it on chain and send you a receipt.`
          }
        />
      </SheetScreen>
    );
  }

  if (step.name === 'review') {
    const { prepared, quote } = step;
    const amountText = formatAssetAmount(prepared.amount, prepared.asset, { withSymbol: true });
    return (
      <SheetScreen title="Pay request" onClose={close} testID="pay-request-screen">
        <SendReview
          asset={prepared.asset}
          amount={prepared.amount}
          recipient={{ kind: 'pubky', label: name, publicKey: counterparty, route: 'request', addresses: { [prepared.asset]: prepared.address } }}
          address={prepared.address}
          quote={quote}
          problem={checkAffordable({ asset: prepared.asset, amount: prepared.amount, balances, fee: quote.fee })}
          sending={sending}
          outcomeUnknown={step.outcomeUnknown}
          error={error}
          onSend={() => void onPay()}
          onClose={close}
          sendLabel={`Pay ${amountText}`}
          context={
            <Text color="graphite" testID="pay-request-context">
              {prepared.needsAcceptance ? `Paying accepts ${name}'s request` : `For ${name}'s request`}
              {prepared.terms.note ? `: “${prepared.terms.note}”` : ''}
              {prepared.period ? `. The payment due ${formatDateTime(Date.parse(prepared.period.startsAt))}` : ''}.
            </Text>
          }
        />
      </SheetScreen>
    );
  }

  if (step.name === 'blocked') {
    const { prepared } = step;
    return (
      <SheetScreen title="Pay request" onClose={close} testID="pay-request-screen">
        <View style={styles.body}>
          <View>
            <Text variant="secondary" color="graphite">
              {name} asks for
            </Text>
            <AssetAmount value={prepared.amount} asset={prepared.asset} size="hero" />
          </View>
          <PersonRecipient
            recipient={{ kind: 'pubky', label: name, publicKey: counterparty, route: 'request', addresses: { [prepared.asset]: prepared.address } }}
            address={prepared.address}
          />
          <Text color="alert" testID="pay-request-blocked">
            {step.message}
          </Text>
          <Button label="Close" variant="secondary" onPress={close} />
        </View>
      </SheetScreen>
    );
  }

  return (
    <SheetScreen title="Pay request" onClose={close} testID="pay-request-screen">
      <View style={styles.body}>
        {step.name === 'cannot' ? (
          <>
            <Text color="graphite" testID="pay-request-cannot">
              {step.message}
            </Text>
            <Button label="Close" variant="secondary" onPress={close} />
          </>
        ) : (
          <Text color="graphite" testID="pay-request-preparing">
            {view ? `Getting ${name}'s payment details and the network fee…` : 'Loading the request…'}
          </Text>
        )}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.l },
});
