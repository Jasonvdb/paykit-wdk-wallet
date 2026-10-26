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
// Review and send use the request as it was when Review was tapped (a
// SendDraft saved with the quote), never the live inputs: a fee quoted for
// Bitcoin must not be paired with a USD₮ amount typed while it loaded.
// The inputs are locked while a quote or send runs, and a ref guards each
// handler against a second tap before React re-renders.
//
// A send that fails in a way that might have reached the network (a
// timeout after the broadcast, see sendFailureFor) is not offered again:
// the screen says to check Activity first, so nobody pays twice.
//
// Recipients plug in through ./send/recipient.ts: each way of choosing who
// to pay is a field component that reports a SendRecipient.
//   Person   send/PubkyRecipientField: a pubky, resolved to the private
//            addresses a linked contact shared only with you, else to the
//            addresses they publish for everyone (public endpoints)
//   Address  send/AddressRecipientField: a tb1… or 0x… address
// A `to` param that is a pubky (paykitwdk://send?to=<pubky>) opens on
// Person, and pasting a pubky into Address switches to Person.
import * as Haptics from 'expo-haptics';
import { useCallback, useRef, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';

import type { RootScreenProps } from '../../navigation/types';
import { Button, SegmentedControl, SheetScreen, Text, space } from '../../ui';
import {
  checkAffordable,
  fetchBtcFeeRate,
  formatUnits,
  parseTypedAmount,
  sendErrorMessage,
  sendFailureFor,
  useSend,
  useWalletBalances,
  ASSETS,
  type FeeQuote,
  type SendResult,
} from '../../wallet';
import { AssetPicker, isPayableAsset, type PayableAsset } from './AssetPicker';
import { AddressRecipientField } from './send/AddressRecipientField';
import { AmountField } from './send/AmountField';
import { PubkyRecipientField, isPubkyText } from './send/PubkyRecipientField';
import type { SendRecipient } from './send/recipient';
import { SendReview } from './send/SendReview';
import { SendSuccess } from './send/SendSuccess';

/** What is being sent, frozen when Review is tapped. */
type SendDraft = { asset: PayableAsset; recipient: SendRecipient; address: string; amount: bigint };

type Step =
  | { name: 'compose' }
  | { name: 'review'; draft: SendDraft; quote: FeeQuote; outcomeUnknown?: boolean }
  | { name: 'sent'; draft: SendDraft; result: SendResult };

const PARSE_ERRORS = {
  empty: undefined,
  invalid: 'Enter a number, like 0.0005 or 12.50.',
  'too-many-decimals': 'That has more decimal places than this asset allows.',
  ambiguous: 'Is that one or a thousand? Use a point for decimals (1.5) and leave out thousands separators.',
} as const;

export function SendScreen({ navigation, route }: RootScreenProps<'Send'>) {
  const wallet = useSend();
  const { balances, refresh } = useWalletBalances();

  const initialAsset = route.params?.asset;
  const [asset, setAsset] = useState<PayableAsset>(isPayableAsset(initialAsset) ? initialAsset : 'btc');
  const [recipient, setRecipient] = useState<SendRecipient>();
  const [toKind, setToKind] = useState<'person' | 'address'>(isPubkyText(route.params?.to) ? 'person' : 'address');
  /** Text to start the "To" field with: the link's `to`, or a pubky pasted into the address field. */
  const [toPrefill, setToPrefill] = useState(route.params?.to);
  const [amountText, setAmountText] = useState('');
  /** The BTC amount Max filled in and the fee rate it was sized at; the quote reuses that rate. */
  const [maxSizing, setMaxSizing] = useState<{ amount: bigint; feeRate?: bigint }>();
  const [step, setStep] = useState<Step>({ name: 'compose' });
  const [busy, setBusy] = useState<'max' | 'quote' | 'send' | null>(null);
  const [error, setError] = useState<string>();
  /** Set synchronously at the top of each handler: a second tap before React re-renders must not run it twice. */
  const inFlight = useRef(false);

  const parsed = parseTypedAmount(amountText, asset);
  const amount = parsed.ok ? parsed.value : undefined;
  const address = recipient?.addresses[asset];
  const preQuoteProblem = amount !== undefined ? checkAffordable({ asset, amount, balances }) : undefined;

  // Stable, so recipient fields can report from an effect without looping.
  const onRecipientChange = useCallback((next: SendRecipient | undefined) => setRecipient(next), []);
  const onPubkyInAddressField = useCallback((text: string) => {
    setToPrefill(text);
    setToKind('person');
  }, []);
  const changeToKind = (next: 'person' | 'address') => {
    setToPrefill(undefined);
    setRecipient(undefined);
    setToKind(next);
  };

  const changeAsset = (next: PayableAsset) => {
    setAsset(next);
    setError(undefined);
  };

  /** Run `task` unless another one is running; `busy` drives the spinners and locks the inputs. */
  const exclusive = async (kind: NonNullable<typeof busy>, task: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    try {
      await task();
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const onMax = () =>
    exclusive('max', async () => {
      setError(undefined);
      if (asset === 'usdt') {
        if (balances.usdt !== undefined) setAmountText(formatUnits(balances.usdt, ASSETS.usdt.decimals));
        return;
      }
      try {
        const feeRate = await fetchBtcFeeRate().catch(() => undefined);
        const max = await wallet.maxBtcAmount(feeRate);
        setAmountText(max > 0n ? formatUnits(max, ASSETS.btc.decimals) : '0');
        setMaxSizing(max > 0n ? { amount: max, feeRate } : undefined);
      } catch (e) {
        setError(sendErrorMessage(e, 'btc'));
      }
    });

  const onReview = () => {
    if (!recipient || !address || amount === undefined) return;
    const draft: SendDraft = { asset, recipient, address, amount };
    Keyboard.dismiss();
    return exclusive('quote', async () => {
      setError(undefined);
      const feeRate = draft.asset === 'btc' && maxSizing?.amount === draft.amount ? maxSizing.feeRate : undefined;
      try {
        const quote = await wallet.quote({ asset: draft.asset, to: draft.address, amount: draft.amount, feeRate });
        setStep({ name: 'review', draft, quote });
      } catch (e) {
        setError(sendErrorMessage(e, draft.asset));
      }
    });
  };

  const onSend = () => {
    if (step.name !== 'review' || step.outcomeUnknown) return;
    const { draft, quote } = step;
    return exclusive('send', async () => {
      setError(undefined);
      try {
        const result = await wallet.send({ asset: draft.asset, to: draft.address, amount: draft.amount, feeRate: quote.feeRate });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setStep({ name: 'sent', draft, result });
        void refresh();
      } catch (e) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        const failure = sendFailureFor(e, draft.asset);
        setError(failure.message);
        if (failure.outcome === 'unknown') {
          // It may be on its way: no second Send. Fresh balances help the person check.
          setStep({ name: 'review', draft, quote, outcomeUnknown: true });
          void refresh();
        }
      }
    });
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

  if (step.name === 'sent') {
    const { draft } = step;
    return (
      <SheetScreen title="Send" onClose={close} testID="send-screen">
        <SendSuccess
          asset={draft.asset}
          amount={draft.amount}
          toLabel={draft.recipient.label}
          toIsName={draft.recipient.kind === 'pubky'}
          result={step.result}
          onDone={close}
        />
      </SheetScreen>
    );
  }

  if (step.name === 'review') {
    const { draft, quote } = step;
    return (
      <SheetScreen title="Review" onClose={close} testID="send-screen">
        <SendReview
          asset={draft.asset}
          amount={draft.amount}
          recipient={draft.recipient}
          address={draft.address}
          quote={quote}
          problem={checkAffordable({ asset: draft.asset, amount: draft.amount, balances, fee: quote.fee })}
          sending={busy === 'send'}
          outcomeUnknown={step.outcomeUnknown}
          error={error}
          onSend={onSend}
          onEdit={() => {
            setError(undefined);
            setStep({ name: 'compose' });
          }}
          onClose={close}
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
      {/* Locked while a fee quote or Max runs: the review pairs the quote with these inputs. */}
      <View style={[styles.body, busy !== null && styles.locked]} pointerEvents={busy !== null ? 'none' : 'auto'}>
        <SegmentedControl
          accessibilityLabel="Pay"
          value={toKind}
          onChange={changeToKind}
          options={[
            { value: 'person', label: 'A person (pubky)', testID: 'send-to-person' },
            { value: 'address', label: 'An address', testID: 'send-to-address' },
          ]}
        />
        {/* Coming back from review remounts the field: start from the recipient already chosen. */}
        {toKind === 'person' ? (
          <PubkyRecipientField
            asset={asset}
            initialText={recipient?.kind === 'pubky' ? recipient.publicKey : toPrefill}
            onChange={onRecipientChange}
          />
        ) : (
          <AddressRecipientField
            asset={asset}
            initialText={address ?? toPrefill}
            onChange={onRecipientChange}
            onPubky={onPubkyInAddressField}
          />
        )}
        <AssetPicker value={asset} onChange={changeAsset} />
        <AmountField
          asset={asset}
          text={amountText}
          onChangeText={(text) => {
            // Kept as typed: parseTypedAmount decides whether a comma is a
            // decimal point ("0,5") or a thousands separator ("1,000.50").
            setAmountText(text);
            setError(undefined);
          }}
          balance={balances[asset]}
          onMax={() => void onMax()}
          maxLoading={busy === 'max'}
          error={amountError ?? error}
        />
        {noGas ? (
          <Text color="alert" testID="send-no-gas">
            Not enough ETH for gas. USD₮ transfers pay their network fee in Sepolia ETH, and this wallet has none. Get some for your
            Ethereum address in You &gt; Test funds.
          </Text>
        ) : null}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
  locked: { opacity: 0.6 },
});
