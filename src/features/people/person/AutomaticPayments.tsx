// Person > Automatic payments: the Allowances with this contact
// (src/paykit/allowances.ts), both ways.
//
//   you pay them     accepted: the limits, what has been used against them
//                    (from the payment ledger) and "Stop automatic payments";
//                    offered by you: waiting for them, with "Withdraw offer";
//                    asked by them: Accept / Decline
//   they pay you     accepted: the limits and "End"; offered by them:
//                    Accept / Decline
//   none             "Set up automatic payments" (AutomaticPaymentsScreen),
//                    once the private connection is ready
//
// Ended, declined and conflicted ones are not listed; their history stays
// in the SDK. Accepting names the exact offer shown here (its proposal
// stream item), so terms that changed in between are refused.
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import {
  acceptAutomaticPayments,
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
  type AllowanceView,
  type LinkState,
} from '../../../paykit';
import { Button, Divider, Text, formatDateTime, space } from '../../../ui';

export function AutomaticPayments({ pubky, name, linkState, onSetUp }: { pubky: string; name: string; linkState: LinkState; onSetUp: () => void }) {
  const allowances = useAllowancesWith(pubky).filter((a) => a.state === 'proposed' || a.state === 'accepted');
  const youPay = allowances.some((a) => a.role === 'allower' && a.state === 'accepted');

  return (
    <View style={styles.root} testID="automatic-payments">
      {allowances.length === 0 ? (
        <Text color="graphite">{`Let ${name}'s payment requests be paid without a tap, up to limits you choose.`}</Text>
      ) : (
        allowances.map((allowance, index) => (
          <View key={allowance.allowanceId}>
            {index > 0 ? <Divider /> : null}
            <AllowanceItem allowance={allowance} name={name} />
          </View>
        ))
      )}
      {!youPay && linkState === 'linked' && !allowances.some((a) => a.role === 'allower' && a.proposedByUs) ? (
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

  const end = () =>
    Alert.alert(
      accepted ? (payer ? 'Stop automatic payments?' : `End ${name}'s automatic payments?`) : 'Withdraw your offer?',
      accepted
        ? payer
          ? `${name}'s next requests wait for you again. Payments already made stay made.`
          : `${name}'s wallet stops paying your requests automatically. Payments already made stay made.`
        : `${name} can no longer accept it.`,
      [
        { text: 'Back', style: 'cancel' },
        { text: accepted ? 'Stop' : 'Withdraw', style: 'destructive', onPress: () => void run('end', () => endAutomaticPayments(service!, allowance), "Couldn't stop it. Try again.") },
      ],
    );

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

  return (
    <View style={styles.item} testID={`allowance-${allowance.allowanceId.slice(0, 8)}`}>
      <Text variant="bodyStrong">{title}</Text>
      <Text color="graphite" testID="allowance-terms">
        {terms ? allowanceTermsWords(terms, formatDateTime) : "This wallet can't read these limits."}
      </Text>
      {expired ? <Text color="graphite">These limits have ended.</Text> : null}
      {usage && terms ? (
        <Text variant="secondary" testID="allowance-usage">
          {allowanceUsageWords(terms, usage)}
        </Text>
      ) : null}
      {!allowance.healthy ? <Text color="graphite">{"Something in their history doesn't add up, so nothing is paid automatically."}</Text> : null}
      {allowance.ourDelivery === 'queued' ? (
        <Text variant="caption" color="graphite">
          Sending to them…
        </Text>
      ) : null}
      {error ? <Text color="alert">{error}</Text> : null}
      <View style={styles.buttons}>
        {!accepted && !allowance.proposedByUs ? (
          <>
            <Button
              label="Accept"
              compact
              onPress={() => void run('accept', () => acceptAutomaticPayments(service!, allowance), "Couldn't accept it. Try again.")}
              {...stateOf('accept')}
              testID="allowance-accept"
            />
            <Button
              label="Decline"
              variant="secondary"
              compact
              onPress={() => void run('decline', () => declineAutomaticPayments(service!, allowance), "Couldn't decline it. Try again.")}
              {...stateOf('decline')}
              testID="allowance-decline"
            />
          </>
        ) : (
          <Button
            label={accepted ? (payer ? 'Stop automatic payments' : 'End') : 'Withdraw offer'}
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
