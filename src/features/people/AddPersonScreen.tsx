// Add person (modal): paste a pubky, scan their pay-me code, or arrive from
// a paykitwdk://contact?pubky=<key> link.
//
// Before anything is saved, the screen shows who the key belongs to:
//   1. pubkyFromText checks the shape on every keystroke; after a short
//      pause the SDK validates it (normalizeKey). Your own key and someone
//      already in your contacts are caught here.
//   2. "Retrieving their profile…": resolvePublicPaymentOptions reads their
//      app registry, public endpoints and profile, so the preview shows
//      their seal, published name and photo, the short key, and what they
//      accept publicly. If their homeserver can't be reached the preview
//      says so; you can still add them and the link forms later.
//   3. An optional local label ("your name for them"), then "Add Ben":
//      saveContactAndLink saves the contact and starts the Encrypted Link.
//      It completes once they add you too; the sync loop keeps advancing it.
//
// The published name is their own claim, so the preview always shows the
// key next to it, and a label you type wins everywhere (personName.ts).
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { demoPrefill } from '../../config/demo';
import type { RootScreenProps } from '../../navigation/types';
import {
  describeError,
  paykitErrorTag,
  pubkyFromText,
  resolvePublicPaymentOptions,
  useContacts,
  usePaykit,
  userMessageFor,
  type PersonProfile,
  type PublicPaymentOptions,
} from '../../paykit';
import { Button, Input, KeyText, SheetScreen, Text, space } from '../../ui';
import { personName } from './personName';
import { markJustAdded } from './justAdded';
import { publicAcceptsWords } from './person/personWords';
import { PersonSeal } from './PersonSeal';

/** Wait this long after the last keystroke before looking a key up. */
const LOOKUP_DELAY_MS = 300;

type Preview =
  | { state: 'idle' }
  | { state: 'invalid' }
  | { state: 'self' }
  | { state: 'loading'; publicKey: string }
  | { state: 'ready'; publicKey: string; options: PublicPaymentOptions; profile?: PersonProfile }
  | { state: 'unreachable'; publicKey: string; message: string };

export function AddPersonScreen({ navigation, route }: RootScreenProps<'AddPerson'>) {
  const { service, log } = usePaykit();
  const contacts = useContacts();
  const [text, setText] = useState(route.params?.pubky ?? demoPrefill.peerPubky ?? '');
  const [label, setLabel] = useState('');
  const [preview, setPreview] = useState<Preview>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  /** Set once the save worked: the contact list updates before the screen is replaced, and must not flash "already in your contacts". */
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string>();
  const key = pubkyFromText(text);

  useEffect(() => {
    if (!key || !service) {
      setPreview({ state: 'idle' });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      let publicKey: string;
      try {
        publicKey = service.normalizeKey(key);
      } catch {
        if (!cancelled) setPreview({ state: 'invalid' });
        return;
      }
      if (publicKey === service.publicKey) {
        setPreview({ state: 'self' });
        return;
      }
      setPreview({ state: 'loading', publicKey });
      try {
        const { options, profile } = await resolvePublicPaymentOptions(service, publicKey);
        if (!cancelled) setPreview({ state: 'ready', publicKey, options, profile });
      } catch (e) {
        if (cancelled) return;
        log.warn(`add person lookup: ${describeError(e)}`);
        const message =
          paykitErrorTag(e) === 'Transport'
            ? "Couldn't reach their homeserver. Check the pubky, or add them anyway: the private connection forms once they're reachable."
            : userMessageFor(e, "Couldn't read their profile right now. You can still add them.");
        setPreview({ state: 'unreachable', publicKey, message });
      }
    }, LOOKUP_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, service, log, attempt]);

  const publicKey = preview.state === 'ready' || preview.state === 'loading' || preview.state === 'unreachable' ? preview.publicKey : undefined;
  const existing = publicKey && !added ? contacts.find((c) => c.publicKey === publicKey) : undefined;
  const publishedName = preview.state === 'ready' ? preview.profile?.displayName : undefined;
  const name = publicKey ? personName({ publicKey, label, publishedName }).name : '';
  const canAdd = !!service && !!publicKey && !existing && preview.state !== 'loading' && !saving && !added;

  const onPaste = async () => {
    const pasted = await Clipboard.getStringAsync();
    if (pasted) setText(pasted.trim());
  };

  const onAdd = async () => {
    if (!service || !publicKey) return;
    setSaving(true);
    setError(undefined);
    try {
      const record = await service.saveContactAndLink(publicKey, label.trim() || undefined);
      markJustAdded(record.publicKey);
      setAdded(true);
      navigation.replace('Person', { pubky: record.publicKey });
    } catch (e) {
      log.warn(`add contact: ${describeError(e)}`);
      setError(userMessageFor(e, "Couldn't add them. Try again in a moment."));
    } finally {
      setSaving(false);
    }
  };

  const typedButNotKey = text.trim() !== '' && !key;
  const keyError =
    preview.state === 'invalid' || typedButNotKey
      ? "That isn't a pubky. Paste their whole pubky, or the message from their pay-me code."
      : preview.state === 'self'
        ? "That's your own pubky. Paste the pubky of the person you want to add."
        : undefined;

  return (
    <SheetScreen
      title="Add person"
      onClose={() => navigation.goBack()}
      testID="add-person-screen"
      footer={
        existing ? (
          <Button label={`Open ${name}`} variant="secondary" onPress={() => navigation.replace('Person', { pubky: existing.publicKey })} testID="add-person-open" />
        ) : (
          <Button label={publicKey ? `Add ${name}` : 'Add person'} onPress={onAdd} loading={saving} disabled={!canAdd} testID="add-person-save" />
        )
      }
    >
      <View style={styles.body}>
        <Input
          label="Their pubky"
          value={text}
          onChangeText={setText}
          mono
          multiline
          blurOnSubmit
          returnKeyType="done"
          placeholder="pubky…"
          error={keyError}
          accessory={
            <Pressable accessibilityRole="button" accessibilityLabel="Paste" onPress={onPaste} hitSlop={8} testID="add-person-paste">
              <Text variant="bodyStrong" color="seal">
                Paste
              </Text>
            </Pressable>
          }
          testID="add-person-key"
        />
        {!publicKey ? (
          <Button label="Scan their pay-me code" variant="secondary" compact onPress={() => navigation.replace('ScanQr')} testID="add-person-scan" />
        ) : null}

        {preview.state === 'loading' ? (
          <Text color="graphite" testID="add-person-loading">
            Retrieving their profile…
          </Text>
        ) : null}

        {publicKey && preview.state !== 'loading' ? (
          <PersonPreview
            publicKey={publicKey}
            profile={preview.state === 'ready' ? preview.profile : undefined}
            name={personName({ publicKey, publishedName }).name}
            accepts={preview.state === 'ready' ? publicAcceptsWords(preview.options, publishedName ?? 'They') : undefined}
          />
        ) : null}

        {preview.state === 'unreachable' ? (
          <View style={styles.block}>
            <Text color="alert" testID="add-person-unreachable">
              {preview.message}
            </Text>
            <Button label="Try again" variant="secondary" compact onPress={() => setAttempt((n) => n + 1)} />
          </View>
        ) : null}

        {existing ? (
          <Text color="graphite" testID="add-person-existing">
            {name} is already in your contacts.
          </Text>
        ) : publicKey ? (
          <Input
            label="Your name for them (optional)"
            value={label}
            onChangeText={setLabel}
            placeholder={publishedName ?? 'A name only you see'}
            maxLength={64}
            autoCapitalize="words"
            hint="Shown only on this phone, instead of the name they publish."
            testID="add-person-label"
          />
        ) : null}

        {error ? (
          <Text color="alert" testID="add-person-error">
            {error}
          </Text>
        ) : null}

        <Text variant="secondary" color="graphite">
          You both need to add each other. Then your phones connect privately, and you can pay each other at addresses only the two of you know.
        </Text>
      </View>
    </SheetScreen>
  );
}

/** Who the key belongs to, as they describe themselves, before you save them. */
function PersonPreview({ publicKey, profile, name, accepts }: { publicKey: string; profile?: PersonProfile; name: string; accepts?: string }) {
  return (
    <View style={styles.preview} testID="add-person-preview">
      <PersonSeal pubky={publicKey} size={64} profileHint={profile} />
      <View style={styles.previewText}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {name}
        </Text>
        <KeyText value={publicKey} small copyable={false} />
        {profile?.displayName ? (
          <Text variant="caption" color="graphite">
            The name they gave themselves.
          </Text>
        ) : null}
        {accepts ? (
          <Text variant="secondary" color="graphite" testID="add-person-accepts">
            {accepts}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.l },
  block: { gap: space.s, alignItems: 'flex-start' },
  preview: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  previewText: { flexShrink: 1, gap: 2 },
});
