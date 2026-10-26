// Request money (modal): person -> asset -> amount -> note, expiry, repeat.
//
// Only contacts with a private connection (Linked) can be asked: a payment
// request is a private message over the Encrypted Link. The Person page
// opens this with them chosen (`pubky`); from the Wallet tab the person
// picks one here.
//
// Repeat makes a recurring request with a short demo schedule (every
// minute or every 5 minutes) and a number of payments; the payer pays each
// one when it is due. The request binds the exact address to pay: your
// own Bitcoin address for that contact, or your USD₮ address
// (src/paykit/requestTerms.ts). Sending it is proposePaymentRequest plus
// a sync loop flush (src/paykit/requests.ts, requestMoney).
//
// After sending, the screen says whether it left already or is queued
// ("It sends by itself when Ben is reachable"); both are fine, the sync
// loop keeps retrying.
import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';

import type { RootScreenProps } from '../../navigation/types';
import {
  EXPIRY_CHOICES,
  NOTE_MAX_CHARS,
  PAYMENT_COUNT_CHOICES,
  REPEAT_CHOICES,
  describeError,
  recurringScheduleWords,
  requestMoney,
  useConnectionNotice,
  useContacts,
  useLinkState,
  usePaykit,
  usePaymentRequest,
  userMessageFor,
  type ExpiryChoice,
  type RepeatChoice,
  type RequestView,
} from '../../paykit';
import { Button, Divider, EmptyState, Input, Row, SegmentedControl, SheetScreen, Text, linkStateWords, sealRingFor, space } from '../../ui';
import { formatAssetAmount, parseTypedAmount } from '../../wallet';
import { PersonSeal } from '../people/PersonSeal';
import { usePersonName } from '../people/usePersonName';
import { AssetPicker, isPayableAsset, type PayableAsset } from '../wallet/AssetPicker';
import { AmountField } from '../wallet/send/AmountField';
import { PersonHeader } from '../wallet/send/PersonRecipient';

const PARSE_ERRORS = {
  empty: undefined,
  invalid: 'Enter a number, like 0.0005 or 12.50.',
  'too-many-decimals': 'That has more decimal places than this asset allows.',
  ambiguous: 'Is that one or a thousand? Use a point for decimals (1.5) and leave out thousands separators.',
} as const;

export function RequestMoneyScreen({ navigation, route }: RootScreenProps<'RequestMoney'>) {
  const { service, log } = usePaykit();
  const notice = useConnectionNotice();
  const [payer, setPayer] = useState<string | undefined>(route.params?.pubky);
  const [asset, setAsset] = useState<PayableAsset>(isPayableAsset(route.params?.asset) ? route.params.asset : 'usdt');
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [expiry, setExpiry] = useState<ExpiryChoice>('1h');
  const [repeat, setRepeat] = useState<RepeatChoice>('once');
  const [count, setCount] = useState<number>(3);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<RequestView>();
  const inFlight = useRef(false);
  const { name } = usePersonName(payer);
  const linkState = useLinkState(payer);

  const parsed = parseTypedAmount(amountText, asset);
  const amount = parsed.ok && parsed.value > 0n ? parsed.value : undefined;
  const close = () => navigation.goBack();

  if (sent) return <RequestSent view={sent} name={name} onClose={close} onOpen={() => navigation.replace('RequestDetail', { counterparty: sent.counterparty, requestId: sent.requestId })} />;

  const send = async () => {
    if (!service || !payer || amount === undefined || inFlight.current) return;
    inFlight.current = true;
    Keyboard.dismiss();
    setSending(true);
    setError(undefined);
    try {
      const view = await requestMoney(service, { payer, asset, amount, note, expiry, repeat, count });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSent(view);
    } catch (e) {
      log.warn(`request money: ${describeError(e)}`);
      setError(userMessageFor(e, `Couldn't send the request to ${name}. Try again.`));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  const amountWords = amount !== undefined ? formatAssetAmount(amount, asset, { withSymbol: true }) : undefined;
  const canSend = !!service && !!payer && linkState === 'linked' && amount !== undefined && !sending;
  return (
    <SheetScreen
      title="Request money"
      onClose={close}
      testID="request-money-screen"
      footer={
        payer ? (
          <Button
            label={sending ? 'Sending…' : amountWords ? `Request ${amountWords} from ${name}` : 'Request'}
            onPress={() => void send()}
            loading={sending}
            disabled={!canSend}
            testID="request-money-send"
          />
        ) : undefined
      }
    >
      {notice ? (
        <Text color="graphite">{notice.message}</Text>
      ) : !payer ? (
        <ChoosePerson onChoose={setPayer} onAdd={() => navigation.replace('AddPerson')} />
      ) : (
        <View style={[styles.body, sending && styles.locked]} pointerEvents={sending ? 'none' : 'auto'}>
          <View style={styles.person}>
            <PersonHeader publicKey={payer} sealSize={44} />
            {route.params?.pubky ? null : <Button label="Change" variant="secondary" compact onPress={() => setPayer(undefined)} />}
          </View>
          {linkState !== 'linked' ? (
            <Text color="graphite" testID="request-money-not-linked">
              You can ask {name} once your private connection is ready ({linkStateWords(linkState).toLowerCase()}).
            </Text>
          ) : null}
          <AssetPicker value={asset} onChange={setAsset} />
          <AmountField asset={asset} text={amountText} onChangeText={setAmountText} error={parsed.ok ? undefined : PARSE_ERRORS[parsed.reason]} />
          <Input
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="What it's for"
            maxLength={NOTE_MAX_CHARS}
            hint={`${name} sees this with the request.`}
            testID="request-money-note"
          />
          <View style={styles.group}>
            <Text variant="secondary" color="graphite">
              {name} can accept it for
            </Text>
            <SegmentedControl
              accessibilityLabel="Expires"
              value={expiry}
              onChange={setExpiry}
              options={EXPIRY_CHOICES.map((choice) => ({ value: choice.id, label: choice.label, testID: `request-expiry-${choice.id}` }))}
            />
          </View>
          <View style={styles.group}>
            <Text variant="secondary" color="graphite">
              Repeat
            </Text>
            <SegmentedControl
              accessibilityLabel="Repeat"
              value={repeat}
              onChange={setRepeat}
              options={REPEAT_CHOICES.map((choice) => ({ value: choice.id, label: choice.label, testID: `request-repeat-${choice.id}` }))}
            />
          </View>
          {repeat !== 'once' ? (
            <View style={styles.group}>
              <Text variant="secondary" color="graphite">
                Number of payments
              </Text>
              <SegmentedControl
                accessibilityLabel="Number of payments"
                value={String(count)}
                onChange={(value) => setCount(Number(value))}
                options={PAYMENT_COUNT_CHOICES.map((n) => ({ value: String(n), label: String(n), testID: `request-count-${n}` }))}
              />
              <Text variant="caption" color="graphite" testID="request-money-schedule">
                {recurringScheduleWords(repeat, count, name)}
              </Text>
            </View>
          ) : null}
          {error ? (
            <Text color="alert" testID="request-money-error">
              {error}
            </Text>
          ) : null}
        </View>
      )}
    </SheetScreen>
  );
}

/** Only Linked contacts can be asked; others are listed with why not. */
function ChoosePerson({ onChoose, onAdd }: { onChoose: (pubky: string) => void; onAdd: () => void }) {
  const contacts = useContacts();
  const linked = contacts.filter((c) => c.linkState === 'linked');
  if (linked.length === 0) {
    return (
      <EmptyState
        title="No one to ask yet"
        message="You can ask contacts you have a private connection with. Add someone, and once you have both added each other, ask them here."
        action={{ label: 'Add person', onPress: onAdd }}
      />
    );
  }
  return (
    <View>
      <Text variant="secondary" color="graphite" style={styles.chooseTitle}>
        Who should pay you?
      </Text>
      {linked.map((contact, index) => (
        <View key={contact.publicKey}>
          {index > 0 ? <Divider inset={56} /> : null}
          <ChoosableContact pubky={contact.publicKey} onPress={() => onChoose(contact.publicKey)} />
        </View>
      ))}
      {contacts.length > linked.length ? (
        <Text variant="caption" color="graphite" style={styles.chooseNote}>
          Contacts still connecting privately are not listed: a request travels over that private connection.
        </Text>
      ) : null}
    </View>
  );
}

function ChoosableContact({ pubky, onPress }: { pubky: string; onPress: () => void }) {
  const { name } = usePersonName(pubky);
  return (
    <Row
      title={name}
      subtitle={linkStateWords('linked')}
      leading={<PersonSeal pubky={pubky} size={44} ring={sealRingFor('linked')} />}
      onPress={onPress}
      testID={`request-money-person-${pubky}`}
    />
  );
}

/** After proposing: delivered or queued, both said plainly. */
function RequestSent({ view, name, onClose, onOpen }: { view: RequestView; name: string; onClose: () => void; onOpen: () => void }) {
  // The live record: the sync loop updates its delivery status within seconds.
  const live = usePaymentRequest(view.counterparty, view.requestId) ?? view;
  const amount = live.terms?.amount !== undefined && live.terms.asset ? formatAssetAmount(live.terms.amount, live.terms.asset, { withSymbol: true }) : '';
  const delivered = live.ourDelivery === 'sent';
  return (
    <SheetScreen title="Request money" onClose={onClose} testID="request-money-screen">
      <View style={styles.body} testID="request-sent">
        <Text variant="title">{delivered ? `Sent to ${name}` : 'Request saved'}</Text>
        <Text>
          You asked {name} for {amount}
          {live.terms?.recurrence ? ', on a schedule' : ''}.
        </Text>
        <Text color="graphite" testID="request-sent-delivery">
          {delivered ? `Waiting for ${name} to pay.` : `It sends by itself when ${name} is reachable. Then you wait for them to pay.`}
        </Text>
        <View style={styles.actions}>
          <Button label="See the request" variant="secondary" onPress={onOpen} testID="request-sent-open" />
          <Button label="Done" onPress={onClose} testID="request-sent-done" />
        </View>
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
  locked: { opacity: 0.6 },
  person: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m },
  group: { gap: space.s },
  chooseTitle: { marginBottom: space.s },
  chooseNote: { marginTop: space.l },
  actions: { gap: space.s },
});
