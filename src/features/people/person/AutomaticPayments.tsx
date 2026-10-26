// Person > Automatic payments: the Allowances with this contact
// (src/paykit/allowances.ts), both ways.
//
//   you pay them     accepted: the limits, what has been used against them
//                    (from the payment ledger) and "Stop automatic payments";
//                    offered by you: waiting for them, with "Withdraw offer";
//                    asked by them: "Accept automatic payments" (after a
//                    confirmation that repeats every limit) / "Decline"
//   they pay you     accepted: the limits and "End automatic payments";
//                    offered by them: "Accept automatic payments" / "Decline"
//
// Accept is not offered for limits this wallet can't read or that have
// ended, nor, when they ask you to pay, for limits that leave the amount
// open or go over this wallet's caps (acceptProblem in
// src/paykit/allowanceTerms.ts): one tap must never let a contact take the
// whole balance.
//   none             "Set up automatic payments" (AutomaticPaymentsScreen),
//                    once the private connection is ready; until then a
//                    sentence says why there is no button
//
// Ended, declined and conflicted ones are not listed; their history stays
// in the SDK. Accepting names the exact offer shown here (its proposal
// stream item), so terms that changed in between are refused.
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import {
  acceptAutomaticPayments,
  acceptProblem,
  allowanceTermsWords,
  allowanceUsage,
  allowanceUsageWords,
  declineAutomaticPayments,
  describeError,
  endAutomaticPayments,
  useAllowanceLedger,
  useAllowancesWith,
  usePaykit,
  userMessageFor,
  useRestoreReview,
  type AllowanceView,
  type LinkState,
} from '../../../paykit';
import { Button, Divider, Text, formatDateTime, space } from '../../../ui';

export function AutomaticPayments({ pubky, name, linkState, onSetUp }: { pubky: string; name: string; linkState: LinkState; onSetUp: () => void }) {
  const allowances = useAllowancesWith(pubky).filter((a) => a.state === 'proposed' || a.state === 'accepted');
  // A stopped one (you blocked or removed them) no longer pays, so a new offer is allowed.
  const youPay = allowances.some((a) => a.role === 'allower' && a.state === 'accepted' && !a.stoppedHere);
  const pausedByRestore = useRestoreReview()?.paused === true;

  return (
    <View style={styles.root} testID="automatic-payments">
      {allowances.length === 0 ? (
        <Text color="graphite">
          {linkState === 'linked'
            ? `Let ${name}'s payment requests be paid without a tap, up to limits you choose.`
            : `Let ${name}'s payment requests be paid without a tap, up to limits you choose. You can set this up once your private connection with ${name} is ready.`}
        </Text>
      ) : (
        allowances.map((allowance, index) => (
          <View key={allowance.allowanceId}>
            {index > 0 ? <Divider /> : null}
            <AllowanceItem allowance={allowance} name={name} />
          </View>
        ))
      )}
      {youPay && pausedByRestore ? (
        <Text color="graphite" testID="automatic-payments-paused">
          {"Paused since this phone was restored from a backup. Resume them in You > Contacts and requests backup once you've checked Activity."}
        </Text>
      ) : null}
      {!youPay && linkState === 'linked' && !allowances.some((a) => a.role === 'allower' && a.proposedByUs && !a.stoppedHere) ? (
        <Button label="Set up automatic payments" variant="secondary" compact onPress={onSetUp} testID="automatic-payments-set-up" />
      ) : null}
    </View>
  );
}

type Action = 'accept' | 'decline' | 'end';

function AllowanceItem({ allowance, name }: { allowance: AllowanceView; name: string }) {
  const { service, log } = usePaykit();
  const ledger = useAllowanceLedger();
  const [running, setRunning] = useState<Action>();
  const [error, setError] = useState<string>();
  const payer = allowance.role === 'allower';
  const accepted = allowance.state === 'accepted';
  const terms = allowance.terms;

  const run = async (action: Action, task: () => Promise<void>, failure: string) => {
    if (!service || running) return;
    setRunning(action);
    setError(undefined);
    try {
      await task();
    } catch (e) {
      log.warn(`${action} automatic payments: ${describeError(e)}`);
      setError(userMessageFor(e, failure));
    } finally {
      setRunning(undefined);
    }
  };
  const stateOf = (action: Action) => ({ loading: running === action, disabled: !service || (running !== undefined && running !== action) });

  const end = () => {
    const ending = !accepted ? 'withdraw' : payer ? 'stop' : 'end';
    const words = {
      withdraw: { title: 'Withdraw your offer?', message: `${name} can no longer accept it.`, action: 'Withdraw', failure: "Couldn't withdraw the offer. Try again." },
      stop: {
        title: 'Stop automatic payments?',
        message: `${name}'s next requests wait for you again. Payments already made stay made.`,
        action: 'Stop',
        failure: "Couldn't stop automatic payments. Try again.",
      },
      end: {
        title: `End ${name}'s automatic payments?`,
        message: `${name}'s wallet stops paying your requests automatically. Payments already made stay made.`,
        action: 'End',
        failure: "Couldn't end automatic payments. Try again.",
      },
    }[ending];
    Alert.alert(words.title, words.message, [
      { text: 'Back', style: 'cancel' },
      { text: words.action, style: 'destructive', onPress: () => void run('end', () => endAutomaticPayments(service!, allowance), words.failure) },
    ]);
  };

  const acceptNow = () => void run('accept', () => acceptAutomaticPayments(service!, allowance), "Couldn't accept automatic payments. Try again.");
  // Paying someone without a tap is standing authority over your money: repeat every limit first.
  const accept = () =>
    payer && terms
      ? Alert.alert(`Pay ${name}'s requests automatically?`, `${allowanceTermsWords(terms, formatDateTime)} Requests within these limits are paid without asking you. You can stop it at any time.`, [
          { text: 'Back', style: 'cancel' },
          { text: 'Accept', onPress: acceptNow },
        ])
      : acceptNow();

  const title = accepted
    ? payer
      ? `You pay ${name}'s requests automatically`
      : `${name} pays your requests automatically`
    : allowance.proposedByUs
      ? payer
        ? `Waiting for ${name} to accept your offer`
        : `Waiting for ${name} to accept`
      : payer
        ? `${name} asks you to pay their requests automatically`
        : `${name} offers to pay your requests automatically`;

  const usage = payer && accepted && terms ? allowanceUsage(terms, ledger?.usage.get(allowance.allowanceId) ?? [], Date.now()) : undefined;
  const expired = terms?.expiresAtMs !== undefined && terms.expiresAtMs <= Date.now();
  const answerable = !accepted && !allowance.proposedByUs;
  // Only offers that we would pay under were written by them for us to pay (they asked as the payee).
  const cannotAccept = answerable ? acceptProblem(terms, payer, Date.now()) : undefined;

  return (
    <View style={styles.item} testID={`allowance-${allowance.allowanceId.slice(0, 8)}`}>
      <Text variant="bodyStrong">{title}</Text>
      <Text color="graphite" testID="allowance-terms">
        {terms ? allowanceTermsWords(terms, formatDateTime) : "This wallet can't read these limits."}
      </Text>
      {expired && !cannotAccept ? <Text color="graphite">These limits have ended.</Text> : null}
      {cannotAccept ? (
        <Text color="graphite" testID="allowance-cannot-accept">
          {cannotAccept}
        </Text>
      ) : null}
      {usage && terms ? (
        <Text variant="secondary" testID="allowance-usage">
          {allowanceUsageWords(terms, usage)}
        </Text>
      ) : null}
      {!allowance.healthy ? <Text color="graphite">{"Something in their history doesn't add up, so nothing is paid automatically."}</Text> : null}
      {allowance.stoppedHere ? (
        <Text color="graphite" testID="allowance-stopped">
          {`Stopped on this phone when you blocked or removed ${name}: nothing is paid under it. End it to tell them.`}
        </Text>
      ) : null}
      {allowance.ourDelivery === 'queued' ? (
        <Text variant="caption" color="graphite">
          Sending to them…
        </Text>
      ) : null}
      {error ? <Text color="alert">{error}</Text> : null}
      <View style={styles.buttons}>
        {answerable ? (
          <>
            {cannotAccept ? null : <Button label="Accept automatic payments" compact onPress={accept} {...stateOf('accept')} testID="allowance-accept" />}
            <Button
              label="Decline"
              variant="secondary"
              compact
              onPress={() => void run('decline', () => declineAutomaticPayments(service!, allowance), "Couldn't decline the offer. Try again.")}
              {...stateOf('decline')}
              testID="allowance-decline"
            />
          </>
        ) : (
          <Button
            label={accepted ? (payer ? 'Stop automatic payments' : 'End automatic payments') : 'Withdraw offer'}
            variant="destructive"
            compact
            onPress={end}
            {...stateOf('end')}
            testID="allowance-end"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.m, alignItems: 'stretch' },
  item: { gap: space.xs, paddingVertical: space.s },
  buttons: { flexDirection: 'row', gap: space.s, marginTop: space.s, flexWrap: 'wrap' },
});
