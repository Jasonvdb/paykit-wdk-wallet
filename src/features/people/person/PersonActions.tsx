// The Person page's actions on the contact itself, each after a
// confirmation that says what happens:
//
//   Block     their requests and messages are ignored; the private
//             connection ends and your private list is withdrawn
//             (PaykitService.blockPeer). They stay in your contacts as
//             "Blocked".
//   Unblock   back to a contact; a fresh private connection forms on the
//             next sync round (PaykitService.unblockPeer).
//   Forget    blocked only: delete what they sent that you never answered
//             (PaykitService.forgetPeer). When you have requests, payments
//             or automatic payments together, the SDK keeps that history;
//             the page says so as a plain note, not an error.
//   Remove    leave your contacts and end the connection
//             (PaykitService.removeContact). Someone you blocked stays
//             blocked.
//
// Blocking and removing refuse while a proof of your payment to them has
// not gone out: both drop the messages still queued for them.
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { describeError, usePaykit, userMessageFor } from '../../../paykit';
import { Button, Text, space } from '../../../ui';

type Action = 'block' | 'unblock' | 'forget' | 'remove';

export function PersonActions({ pubky, name, blocked, onRemoved }: { pubky: string; name: string; blocked: boolean; onRemoved: () => void }) {
  const { service, log } = usePaykit();
  const [running, setRunning] = useState<Action>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  /** Runs an action; the text it returns, if any, is shown as a notice. */
  const run = async (action: Action, task: () => Promise<string | void>, failure: string) => {
    if (!service || running) return;
    setRunning(action);
    setError(undefined);
    setNotice(undefined);
    try {
      const done = await task();
      if (done) setNotice(done);
    } catch (e) {
      log.warn(`${action} contact: ${describeError(e)}`);
      setError(userMessageFor(e, failure));
    } finally {
      setRunning(undefined);
    }
  };

  const confirm = (title: string, message: string, action: string, onConfirm: () => void) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: action, style: 'destructive', onPress: onConfirm },
    ]);

  const block = () =>
    confirm(
      `Block ${name}?`,
      `Their payment requests and other messages are ignored until you unblock them. Your private connection ends and they no longer see your private addresses. Requests and receipts you already have stay.`,
      'Block',
      () => void run('block', () => service!.blockPeer(pubky), `Couldn't block ${name}. Try again.`),
    );
  const unblock = () =>
    void run(
      'unblock',
      async () => {
        await service!.unblockPeer(pubky);
        return `${name} is unblocked. A new private connection forms in a moment.`;
      },
      `Couldn't unblock ${name}. Try again.`,
    );
  const forget = () =>
    confirm(
      `Forget what ${name} sent?`,
      `Requests and offers from ${name} that you never answered, and the addresses they shared with you, are deleted from this phone. This can't be undone. ${name} stays blocked and isn't told.`,
      'Forget',
      () =>
        void run(
          'forget',
          async () =>
            (await service!.forgetPeer(pubky)) === 'forgotten'
              ? `Deleted what ${name} sent that you never answered.`
              : `You and ${name} have requests, payments or automatic payments together, so that history is kept. They stay blocked.`,
          `Couldn't forget what ${name} sent. Try again.`,
        ),
    );
  const remove = () =>
    confirm(
      `Remove ${name}?`,
      blocked
        ? `${name} leaves your contacts and stays blocked: their requests and messages are still ignored. Money already sent to you still arrives.`
        : `${name} leaves your contacts and your private connection ends: they no longer see your private addresses. Money already sent to you still arrives. To pay each other privately again, you both add each other again.`,
      'Remove',
      () =>
        void run(
          'remove',
          async () => {
            await service!.removeContact(pubky);
            onRemoved();
          },
          `Couldn't remove ${name}. Try again.`,
        ),
    );

  const busy = running !== undefined;
  const stateOf = (action: Action) => ({ loading: running === action, disabled: !service || (busy && running !== action) });

  return (
    <View style={styles.root}>
      {notice ? (
        <Text color="graphite" testID="person-action-notice">
          {notice}
        </Text>
      ) : null}
      {error ? (
        <Text color="alert" testID="person-action-error">
          {error}
        </Text>
      ) : null}
      {blocked ? (
        <>
          <Button label={`Unblock ${name}`} variant="secondary" onPress={unblock} {...stateOf('unblock')} testID="person-unblock" />
          <Button label="Forget what they sent" variant="destructive" onPress={forget} {...stateOf('forget')} testID="person-forget" />
        </>
      ) : (
        <Button label={`Block ${name}`} variant="destructive" onPress={block} {...stateOf('block')} testID="person-block" />
      )}
      <Button label={`Remove ${name}`} variant="destructive" onPress={remove} {...stateOf('remove')} testID="person-remove" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: space.xxl, marginBottom: space.xxl, gap: space.s },
});
