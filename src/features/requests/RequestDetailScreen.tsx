// Request detail (pushed): one payment request.
//
//   who and how much   their seal, "Ben asks you for" / "You asked Ben for",
//                      the amount as the headline, the status in a chip
//   terms              note, network, the address it must be paid to,
//                      until when it can be accepted, the schedule
//   timeline           Requested -> Accepted -> Paid (proof) -> Verified ->
//                      Receipt (./RequestTimeline.tsx). Request, payment,
//                      proof and verification stay separate steps: a
//                      submitted proof is not a settlement.
//   payments           recurring only: one row per billing period, with
//                      Pay now / Not now for the payer (./RecurringPayments.tsx)
//   actions            payer: Accept and pay, Accept (pay later), Decline,
//                      Pay request, Stop these payments; payee: Cancel request
//
// The record is found by `counterparty` + `requestId` in the observeState
// snapshot (route params carry ids, never records), so the page updates by
// itself every sync round. Paying opens PayRequest: the Send review with
// the amount and address locked.
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import type { RootScreenProps } from '../../navigation/types';
import {
  acceptRequest,
  cancelRequest,
  declineRequest,
  deferPayment,
  describeError,
  intervalWords,
  isPaymentHandled,
  isTerminal,
  paymentCount,
  requestStatusWords,
  requestTimeline,
  usePaykit,
  usePaymentRequest,
  useRequestFacts,
  userMessageFor,
  type BillingPeriod,
} from '../../paykit';
import { AssetAmount, Button, Chip, DetailRow, Divider, EmptyState, KeyText, PushedScreen, Text, formatDateTime, space } from '../../ui';
import { ASSETS } from '../../wallet';
import { PersonSeal } from '../people/PersonSeal';
import { usePersonName } from '../people/usePersonName';
import { RecurringPayments } from './RecurringPayments';
import { RequestTimeline } from './RequestTimeline';
import { useNow } from './useNow';

export function RequestDetailScreen({ navigation, route }: RootScreenProps<'RequestDetail'>) {
  const { counterparty, requestId } = route.params;
  const { service, log } = usePaykit();
  const view = usePaymentRequest(counterparty, requestId);
  const { name } = usePersonName(counterparty);
  const facts = useRequestFacts(view, name);
  const nowMs = useNow(5_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const back = () => navigation.goBack();

  if (!view || !facts) {
    return (
      <PushedScreen title="Request" onBack={back} testID="request-detail">
        <EmptyState title="Request not found" message="It may still be on its way. Check again in a moment." action={{ label: 'Back', onPress: back }} />
      </PushedScreen>
    );
  }

  const terms = view.terms;
  const payer = view.role === 'payer';
  const recurrence = terms?.recurrence;
  const terminal = isTerminal(view.state);
  const onePayment = facts.payments[0];
  const paidOnce = !recurrence && !!onePayment && isPaymentHandled(onePayment);

  const run = async (label: string, task: () => Promise<void>, failure: string) => {
    if (!service || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await task();
    } catch (e) {
      log.warn(`${label}: ${describeError(e)}`);
      setError(userMessageFor(e, failure));
    } finally {
      setBusy(false);
    }
  };

  const pay = (period?: BillingPeriod) => navigation.navigate('PayRequest', { counterparty, requestId, periodStart: period?.startsAt });
  const confirm = (title: string, message: string, action: string, onConfirm: () => void) =>
    Alert.alert(title, message, [
      { text: 'Back', style: 'cancel' },
      { text: action, style: 'destructive', onPress: onConfirm },
    ]);
  const accept = () =>
    void run('accept request', () => acceptRequest(service!, counterparty, requestId, view.proposalStreamItemId), "Couldn't accept it. Try again.");
  const decline = () =>
    confirm(`Decline ${name}'s request?`, `${name} is told you said no. You can't accept it later.`, 'Decline', () =>
      void run('decline request', () => declineRequest(service!, counterparty, requestId), "Couldn't decline it. Try again."),
    );
  const cancel = () =>
    confirm(
      payer ? 'Stop these payments?' : 'Cancel this request?',
      payer ? `${name} is told you stopped. Payments already made stay made.` : `${name} is told it's canceled and can't pay it any more.`,
      payer ? 'Stop payments' : 'Cancel request',
      () => void run('cancel request', () => cancelRequest(service!, counterparty, requestId), "Couldn't cancel it. Try again."),
    );
  const defer = (period: BillingPeriod) => void run('defer payment', () => deferPayment(service!, counterparty, requestId, period), "Couldn't put it off. Try again.");

  const amountRow = terms?.amount !== undefined && terms.asset ? <AssetAmount value={terms.amount} asset={terms.asset} size="hero" /> : <Text variant="title">{terms?.rawAmount}</Text>;
  // Recurring: the timeline covers the request (asked, accepted, or where it
  // stopped); each payment's own steps are in the Payments list below.
  const timeline = requestTimeline(facts, recurrence ? undefined : onePayment);
  const steps = recurrence ? timeline.filter((s) => s.key === 'requested' || s.key === 'accepted' || s.state === 'stopped') : timeline;

  return (
    <PushedScreen title="Request" onBack={back} testID="request-detail">
      <View style={styles.header}>
        <View style={styles.person}>
          <PersonSeal pubky={counterparty} size={44} />
          <Text variant="bodyStrong" style={styles.who}>
            {payer ? `${name} asks you for` : `You asked ${name} for`}
          </Text>
        </View>
        {amountRow}
        <Chip label={requestStatusWords(facts)} tone={terminal ? 'neutral' : 'seal'} />
      </View>

      <View style={styles.section}>
        {terms?.note ? (
          <>
            <DetailRow label="Note" value={`“${terms.note}”`} testID="request-note" />
            <Divider />
          </>
        ) : null}
        {terms?.asset ? (
          <>
            <DetailRow label="Network" value={terms.asset === 'btc' ? 'Bitcoin (Mutinynet)' : `${ASSETS.usdt.displayName} on Ethereum Sepolia`} />
            <Divider />
          </>
        ) : null}
        {terms?.endpoint ? (
          <>
            <DetailRow
              label={payer ? 'Pay to' : 'To be paid to'}
              value={<KeyText value={terms.endpoint.address} full small copyable={false} />}
              hint={
                payer
                  ? `The address ${name} put in the request.`
                  : terms.asset === 'btc'
                    ? `Your private Bitcoin address for ${name}.`
                    : 'Your USD₮ address.'
              }
            />
            <Divider />
          </>
        ) : null}
        {recurrence ? (
          <>
            <DetailRow
              label="Schedule"
              value={`${intervalWords(recurrence).replace(/^e/, 'E')}${paymentCount(recurrence) ? `, ${paymentCount(recurrence)} payments` : ''}`}
              hint={`From ${formatDateTime(Date.parse(recurrence.startsAt))}${recurrence.endsAt ? ` to ${formatDateTime(Date.parse(recurrence.endsAt))}` : ''}`}
              testID="request-schedule"
            />
            <Divider />
          </>
        ) : null}
        {terms?.expiresAtMs !== undefined && (view.state === 'proposed' || view.state === 'expired') ? (
          <>
            <DetailRow label={view.state === 'expired' ? 'Expired' : 'Accept by'} value={formatDateTime(terms.expiresAtMs)} />
            <Divider />
          </>
        ) : null}
        {terms ? <DetailRow label="Reference" value={terms.reference} hint="Goes with every payment and receipt for this request." /> : null}
      </View>

      <View style={styles.section}>
        <Text variant="heading">Status</Text>
        <RequestTimeline steps={steps} testID="request-timeline" />
      </View>

      {recurrence && view.accepted ? (
        <View style={styles.section}>
          <Text variant="heading">Payments</Text>
          <RecurringPayments
            view={view}
            facts={facts}
            nowMs={nowMs}
            onPay={payer && view.state === 'active' ? pay : undefined}
            onDefer={payer && view.state === 'active' ? defer : undefined}
            busy={busy}
          />
        </View>
      ) : null}

      {terms?.cannotPay && payer ? (
        <Text color="graphite" style={styles.section}>
          {terms.cannotPay}
        </Text>
      ) : null}
      {error ? (
        <Text color="alert" style={styles.section} testID="request-error">
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {payer && view.state === 'proposed' && !terms?.cannotPay ? (
          <>
            <Button label={recurrence ? 'Accept and pay the first one' : 'Accept and pay'} onPress={() => pay()} disabled={busy} testID="request-accept-pay" />
            <Button label="Accept, pay later" variant="secondary" onPress={accept} loading={busy} testID="request-accept" />
          </>
        ) : null}
        {payer && view.state === 'accepted' && !recurrence && !paidOnce ? <Button label="Pay request" onPress={() => pay()} disabled={busy} testID="request-pay" /> : null}
        {payer && (view.state === 'proposed' || view.state === 'expired') ? (
          <Button label="Decline" variant="secondary" onPress={decline} loading={busy} testID="request-decline" />
        ) : null}
        {payer && view.state === 'active' ? <Button label="Stop these payments" variant="destructive" onPress={cancel} loading={busy} testID="request-stop" /> : null}
        {!payer && !terminal && !paidOnce && view.state !== 'proof-submitted' ? (
          <Button label="Cancel request" variant="destructive" onPress={cancel} loading={busy} testID="request-cancel" />
        ) : null}
      </View>
    </PushedScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.m, alignItems: 'flex-start' },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  who: { flexShrink: 1 },
  section: { marginTop: space.xl },
  actions: { marginTop: space.xxl, marginBottom: space.xxl, gap: space.s },
});
