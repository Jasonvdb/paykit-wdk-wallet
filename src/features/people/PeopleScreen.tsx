// People tab: your contacts, each with their seal (photo and ring) and the
// state of your private connection in words.
//
// Contacts come from the Paykit observeState snapshot (useContacts). The
// list puts people you can pay privately first (./contactOrder.ts), then
// those still connecting, then those who haven't added you yet. Adding is
// mutual: a private connection forms only after both people add each
// other, so a short note says so while anyone is waiting. People you
// blocked are listed last, under their own heading, with the Graphite
// dashed ring (docs/DESIGN.md, "The seal").
import { StyleSheet, View } from 'react-native';

import type { MainTabScreenProps } from '../../navigation/types';
import { useConnectionNotice, useContacts, type ContactSummary } from '../../paykit';
import { Button, Divider, EmptyState, Row, Screen, Text, linkStateWords, sealRingFor, space } from '../../ui';
import { sortContacts } from './contactOrder';
import { personName } from './personName';
import { PersonSeal } from './PersonSeal';
import { usePersonName } from './usePersonName';

export function PeopleScreen({ navigation }: MainTabScreenProps<'People'>) {
  const notice = useConnectionNotice();
  const sorted = sortContacts(useContacts().map((contact) => ({ ...contact, name: personName(contact).name })));
  const contacts = sorted.filter((c) => c.linkState !== 'blocked');
  const blocked = sorted.filter((c) => c.linkState === 'blocked');
  const someoneWaiting = contacts.some((c) => c.linkState === 'waiting');
  const open = (contact: ContactSummary) => navigation.navigate('Person', { pubky: contact.publicKey });

  return (
    <Screen
      scroll
      title="People"
      edges={['top']}
      testID="people-screen"
      headerRight={
        <View style={styles.headerActions}>
          <Button label="Scan" compact variant="secondary" onPress={() => navigation.navigate('ScanQr')} testID="people-scan" />
          <Button label="Add" compact variant="secondary" onPress={() => navigation.navigate('AddPerson')} testID="people-add" />
        </View>
      }
    >
      {notice ? (
        <Text color="graphite">{notice.message}</Text>
      ) : contacts.length === 0 ? (
        // Also when everyone left is blocked: the list above "Blocked" still offers the next step.
        <EmptyState
          title={blocked.length === 0 ? 'No one here yet' : 'No one to pay right now'}
          message="Add someone by their pubky or pay-me code. Once you have both added each other, you can pay each other privately."
          action={{ label: 'Add person', onPress: () => navigation.navigate('AddPerson') }}
        />
      ) : (
        contacts.map((contact, index) => (
          <View key={contact.publicKey}>
            {index > 0 ? <Divider inset={56} /> : null}
            <ContactRow contact={contact} onPress={() => open(contact)} />
          </View>
        ))
      )}
      {!notice && blocked.length > 0 ? (
        <View style={styles.blocked} testID="people-blocked">
          <Text variant="heading">Blocked</Text>
          {blocked.map((contact, index) => (
            <View key={contact.publicKey}>
              {index > 0 ? <Divider inset={56} /> : null}
              <ContactRow contact={contact} onPress={() => open(contact)} />
            </View>
          ))}
        </View>
      ) : null}
      {someoneWaiting ? (
        <Text variant="secondary" color="graphite" style={styles.note} testID="people-mutual-note">
          {"“They haven't added you yet” means they need to add you too. Send them your pay-me code from Receive."}
        </Text>
      ) : null}
      <View style={styles.spacer} />
    </Screen>
  );
}

/** One contact: seal with photo, your label or their published name, link state in words. */
function ContactRow({ contact, onPress }: { contact: ContactSummary; onPress: () => void }) {
  const hint = { displayName: contact.publishedName, imageUri: contact.imageUri };
  const { name } = usePersonName(contact.publicKey);
  return (
    <Row
      title={name}
      subtitle={linkStateWords(contact.linkState)}
      leading={<PersonSeal pubky={contact.publicKey} size={44} ring={sealRingFor(contact.linkState)} profileHint={hint} />}
      onPress={onPress}
      testID={`contact-${contact.publicKey}`}
    />
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: space.s },
  note: { marginTop: space.l },
  blocked: { marginTop: space.xl, gap: space.xs },
  spacer: { height: space.xl },
});
