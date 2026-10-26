// "To" as a person: their pubky, typed, pasted, scanned or linked
// (paykitwdk://send?to=<pubky>). The field looks them up and reports a
// 'pubky' recipient whose addresses are the ones they accept.
//
// Lookup order:
//   1. privatePaymentAddressesFor: a linked contact's private addresses.
//      Phase 4 fills it in; until then it returns nothing.
//   2. their PUBLIC payment endpoints (resolvePublicPaymentOptions), which
//      anyone can read.
// Everything they publish is untrusted: the key is normalized by the SDK
// first, and endpoints are re-checked before they become addresses
// (src/paykit/publicPaymentOptions.ts).
//
// The card under the field shows who you are paying (seal, name) and what
// they accept, or why they can't be paid in the chosen asset.
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  cannotPayReason,
  describeError,
  paykitErrorTag,
  privatePaymentAddressesFor,
  pubkyFromText,
  resolvePublicPaymentOptions,
  usePaykit,
  userMessageFor,
  type PayeeAsset,
  type PublicPaymentOptions,
} from '../../../paykit';
import { Button, Input, Text, space } from '../../../ui';
import { ASSETS } from '../../../wallet';
import { usePersonName } from '../../people/usePersonName';
import { PersonHeader } from './PersonRecipient';
import type { RecipientFieldProps, SendRecipient } from './recipient';

/** Wait this long after the last keystroke before looking a pubky up. */
const LOOKUP_DELAY_MS = 300;

type Lookup =
  | { state: 'idle' }
  | { state: 'loading'; key: string }
  | { state: 'error'; key: string; message: string }
  | { state: 'ready'; key: string; publicKey: string; route: 'public' | 'private'; options?: PublicPaymentOptions; addresses: Partial<Record<PayeeAsset, string>> };

export function PubkyRecipientField({ asset, initialText, onChange }: RecipientFieldProps) {
  const { service, log } = usePaykit();
  const [text, setText] = useState(initialText ?? '');
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const key = pubkyFromText(text);

  const ready = lookup.state === 'ready' ? lookup : undefined;
  const { name } = usePersonName(ready?.publicKey);

  // Look the key up whenever it changes (and on "Try again").
  useEffect(() => {
    if (!key || !service) {
      setLookup({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setLookup({ state: 'loading', key });
    const timer = setTimeout(async () => {
      try {
        const publicKey = service.normalizeKey(key);
        if (publicKey === service.publicKey) throw new OwnKeyError();
        const privateAddresses = await privatePaymentAddressesFor(service, publicKey);
        if (privateAddresses) {
          if (!cancelled) setLookup({ state: 'ready', key, publicKey, route: 'private', addresses: privateAddresses });
          return;
        }
        const { options } = await resolvePublicPaymentOptions(service, publicKey);
        if (!cancelled) setLookup({ state: 'ready', key, publicKey, route: 'public', options, addresses: options.addresses });
      } catch (error) {
        if (cancelled) return;
        if (!(error instanceof OwnKeyError)) log.warn(`look up pubky: ${describeError(error)}`);
        const message =
          error instanceof OwnKeyError
            ? "That's your own pubky. Paste the pubky of the person you want to pay."
            : paykitErrorTag(error) === 'Transport'
              ? // A pubky nobody uses fails the same way as a network problem.
                "Couldn't reach that person's homeserver. Check that the pubky is right, or try again in a moment."
              : userMessageFor(error, "Couldn't look up that pubky. Check that it is right, or try again in a moment.");
        setLookup({ state: 'error', key, message });
      }
    }, LOOKUP_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, service, log, attempt]);

  // Report the recipient: their addresses (possibly without this asset; the
  // Send screen then keeps Review disabled and the card says why).
  const label = ready ? name : '';
  useEffect(() => {
    if (!ready) {
      onChange(undefined);
      return;
    }
    const recipient: SendRecipient = { kind: 'pubky', label, publicKey: ready.publicKey, route: ready.route, addresses: ready.addresses };
    onChange(recipient);
  }, [ready, label, onChange]);

  const onPaste = async () => {
    const pasted = await Clipboard.getStringAsync();
    if (pasted) setText(pasted.trim());
  };

  const payeeAsset: PayeeAsset = asset === 'usdt' ? 'usdt' : 'btc';
  const reason = ready?.options ? cannotPayReason(ready.options, payeeAsset, name) : undefined;
  const typedButNotKey = text.trim() !== '' && !key;

  return (
    <View style={styles.root}>
      <Input
        label="To"
        value={text}
        onChangeText={setText}
        placeholder="pubky…"
        mono
        multiline
        blurOnSubmit
        returnKeyType="done"
        error={typedButNotKey ? 'That is not a pubky. A pubky starts with "pubky" and has 52 more letters and digits.' : undefined}
        hint="Their pubky or pay-me code. You pay the address they publish for that asset."
        accessory={
          <Pressable accessibilityRole="button" accessibilityLabel="Paste" onPress={onPaste} hitSlop={8} testID="paste-pubky">
            <Text variant="bodyStrong" color="seal">
              Paste
            </Text>
          </Pressable>
        }
        testID="send-to-pubky"
      />

      {lookup.state === 'loading' ? (
        <Text color="graphite" testID="pubky-lookup-loading">
          Looking them up…
        </Text>
      ) : null}

      {lookup.state === 'error' ? (
        <View style={styles.block}>
          <Text color="alert" testID="pubky-lookup-error">
            {lookup.message}
          </Text>
          <Button label="Try again" variant="secondary" compact onPress={() => setAttempt((n) => n + 1)} />
        </View>
      ) : null}

      {ready ? (
        <View style={styles.payee} testID="pubky-payee">
          <PersonHeader publicKey={ready.publicKey} sealSize={44} />
          <Text variant="secondary" color="graphite" testID="pubky-accepts">
            {acceptsWords(ready)}
          </Text>
        </View>
      ) : null}
      {reason ? (
        <Text color="alert" testID="pubky-cannot-pay">
          {reason}
        </Text>
      ) : null}
    </View>
  );
}

class OwnKeyError extends Error {}

function acceptsWords(ready: Extract<Lookup, { state: 'ready' }>): string {
  const assets = (['btc', 'usdt'] as const).filter((a) => ready.addresses[a] !== undefined).map((a) => ASSETS[a].displayName);
  if (assets.length === 0) return 'Accepts nothing by pubky';
  const how = ready.route === 'private' ? 'privately' : 'by pubky';
  return `Accepts ${assets.join(' and ')} ${how}`;
}

/** Whether `text` should open the pubky field rather than the address field. */
export const isPubkyText = (text: string | undefined): boolean => !!text && pubkyFromText(text) !== undefined;

const styles = StyleSheet.create({
  root: { gap: space.m },
  block: { gap: space.s, alignItems: 'flex-start' },
  payee: { gap: space.s },
});
