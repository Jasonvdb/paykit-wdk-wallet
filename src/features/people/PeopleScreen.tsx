// People tab: your contacts with their seals and link state in words.
//
// Phase 1 lists contacts from the Paykit observeState snapshot so the link
// between the two demo phones can be checked.
//
// TODO(Phase 4 — Contacts): avatars (PaykitService.fetchImageDataUri),
// mutual-add explainer, sections (linked / waiting), swipe actions.
import { StyleSheet, View } from 'react-native';

import type { MainTabScreenProps } from '../../navigation/types';
import { useConnectionNotice, useContacts, usePersonProfile, type ContactSummary } from '../../paykit';
import { Button, Divider, EmptyState, Row, Screen, Text, linkStateWords, middleEllipsis, sealRingFor, space } from '../../ui';
import { PersonSeal } from './PersonSeal';

export function PeopleScreen({ navigation }: MainTabScreenProps<'People'>) {
  const notice = useConnectionNotice();
  const contacts = useContacts();

  return (
    <Screen
      scroll
      title="People"
      edges={['top']}
      testID="people-screen"
      headerRight={<Button label="Add" compact variant="secondary" onPress={() => navigation.navigate('AddPerson')} />}
    >
      {notice ? (
        <Text color="graphite">{notice.message}</Text>
      ) : contacts.length === 0 ? (
        <EmptyState
          title="No one here yet"
          message="Add someone by their pubky. You both need to add each other to pay privately."
          action={{ label: 'Add person', onPress: () => navigation.navigate('AddPerson') }}
        />
      ) : (
        contacts.map((contact, index) => (
          <View key={contact.publicKey}>
            {index > 0 ? <Divider inset={56} /> : null}
            <ContactRow contact={contact} onPress={() => navigation.navigate('Person', { pubky: contact.publicKey })} />
          </View>
        ))
      )}
      <View style={styles.spacer} />
    </Screen>
  );
}

/** One contact: seal with photo, local label or published name, link state in words. */
function ContactRow({ contact, onPress }: { contact: ContactSummary; onPress: () => void }) {
  const hint = { displayName: contact.name, imageUri: contact.imageUri };
  const profile = usePersonProfile(contact.publicKey, hint);
  return (
    <Row
      title={contact.label || profile.displayName || middleEllipsis(contact.publicKey)}
      subtitle={linkStateWords(contact.linkState)}
      leading={<PersonSeal pubky={contact.publicKey} size={44} ring={sealRingFor(contact.linkState)} profileHint={hint} />}
      onPress={onPress}
      testID={`contact-${contact.publicKey}`}
    />
  );
}

const styles = StyleSheet.create({
  spacer: { height: space.xl },
});
