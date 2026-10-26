// Person (pushed): one contact.
//
//   seal + name      their seal with photo and the link ring; the ring
//                    closes with the app's one animation when the link
//                    becomes Linked while this page is open
//   link state       in words (docs/DESIGN.md, "Writing")
//   Pay / Request    Send with them as the person; Request money (Phase 5)
//   your name        a local label (./person/LabelEditor.tsx)
//   what they accept public endpoints and the private lists, both ways
//                    (./person/WhatTheyAccept.tsx)
//   history          payments with them (./person/PersonHistory.tsx)
//   their Bitcoin    what they paid into your account for them, with Collect
//   Remove           ends the contact and the private connection, after a
//                    confirmation (PaykitService.removeContact)
//
// Blocking and forgetting someone come in Phase 6. A key that is not a
// contact (removed, or opened from a link) offers "Add <name>" instead.
import { useState, type ReactNode } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import type { RootScreenProps } from '../../navigation/types';
import { describeError, useContactAccounts, useContacts, useLinkState, usePaykit, usePersonProfile, userMessageFor } from '../../paykit';
import { Button, KeyText, PushedScreen, Text, linkStateWords, sealRingFor, space } from '../../ui';
import { ContactAccountRow } from '../you/ContactAccountsSection';
import { LabelEditor } from './person/LabelEditor';
import { PersonHistory } from './person/PersonHistory';
import { WhatTheyAccept } from './person/WhatTheyAccept';
import { PersonSeal } from './PersonSeal';
import { usePersonName } from './usePersonName';

export function PersonScreen({ navigation, route }: RootScreenProps<'Person'>) {
  const { pubky } = route.params;
  const { service, log } = usePaykit();
  const linkState = useLinkState(pubky);
  const contact = useContacts().find((c) => c.publicKey === pubky);
  const hint = contact ? { displayName: contact.publishedName, imageUri: contact.imageUri } : undefined;
  const { name } = usePersonName(pubky);
  // Their published name: the fresh profile, else what the contact record remembers.
  const publishedName = usePersonProfile(pubky, hint).displayName;
  const account = useContactAccounts().find((a) => a.pubky === pubky);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string>();

  const remove = async () => {
    if (!service) return;
    setRemoving(true);
    setError(undefined);
    try {
      await service.removeContact(pubky);
      navigation.goBack();
    } catch (e) {
      log.warn(`remove contact: ${describeError(e)}`);
      setError(userMessageFor(e, `Couldn't remove ${name}. Try again.`));
      setRemoving(false);
    }
  };

  const confirmRemove = () =>
    Alert.alert(
      `Remove ${name}?`,
      `${name} leaves your contacts and your private connection ends: they no longer see your private addresses. Money already sent to you still arrives. To pay each other privately again, you both add each other again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void remove() },
      ],
    );

  return (
    <PushedScreen onBack={() => navigation.goBack()} testID="person-screen">
      <View style={styles.header}>
        <PersonSeal pubky={pubky} size={112} ring={sealRingFor(linkState)} profileHint={hint} testID="person-seal" />
        <Text variant="title" testID="person-title">
          {name}
        </Text>
        <Text color={linkState === 'linked' ? 'seal' : 'graphite'} testID="person-link-state">
          {linkStateWords(linkState)}
        </Text>
        <KeyText value={pubky} full small />
      </View>

      {contact ? (
        <>
          <View style={styles.actions}>
            <Button label={`Pay ${name}`} onPress={() => navigation.navigate('Send', { to: pubky })} style={styles.action} testID="person-pay" />
            <Button label="Request" variant="secondary" onPress={() => navigation.navigate('RequestMoney', { pubky })} style={styles.action} testID="person-request" />
          </View>
          {linkState === 'waiting' ? (
            <Text variant="secondary" color="graphite" style={styles.section}>
              They need to add you too. Until then you can pay them only at the addresses they publish for everyone.
            </Text>
          ) : null}

          <Section title="Name">
            <LabelEditor publicKey={pubky} label={contact.label} publishedName={publishedName} />
          </Section>

          <Section title="What they accept">
            <WhatTheyAccept publicKey={pubky} name={name} linkState={linkState} />
          </Section>

          <Section title={`History with ${name}`}>
            <PersonHistory
              publicKey={pubky}
              name={name}
              onOpen={(activityId) => navigation.navigate('ActivityDetail', { activityId })}
              onPay={() => navigation.navigate('Send', { to: pubky })}
            />
          </Section>

          {account ? (
            <Section title={`Bitcoin from ${name}`}>
              <Text variant="secondary" color="graphite">
                {name} pays you privately at your own Bitcoin address for them. Collect moves it to your main account so you can spend it.
              </Text>
              <ContactAccountRow pubky={pubky} accountIndex={account.accountIndex} />
            </Section>
          ) : null}

          <View style={styles.remove}>
            {error ? (
              <Text color="alert" testID="person-remove-error">
                {error}
              </Text>
            ) : null}
            <Button label={`Remove ${name}`} variant="destructive" onPress={confirmRemove} loading={removing} disabled={!service} testID="person-remove" />
          </View>
        </>
      ) : (
        <View style={styles.section}>
          <Text color="graphite">Not in your contacts.</Text>
          <Button label={`Add ${name}`} onPress={() => navigation.replace('AddPerson', { pubky })} testID="person-add" />
        </View>
      )}
    </PushedScreen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="heading">{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.l, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', gap: space.s, marginTop: space.xl },
  action: { flex: 1, paddingHorizontal: space.s },
  section: { marginTop: space.xxl, gap: space.s },
  remove: { marginTop: space.xxl, marginBottom: space.xxl, gap: space.s },
});
