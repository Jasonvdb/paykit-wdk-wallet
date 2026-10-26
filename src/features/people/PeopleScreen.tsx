// People tab: your contacts with their seals and link state in words.
//
// Phase 1 lists contacts from the Paykit observeState snapshot so the link
// between the two demo phones can be checked.
//
// TODO(Phase 4 — Contacts): avatars (PaykitService.fetchImageDataUri),
// mutual-add explainer, sections (linked / waiting), swipe actions.
import { StyleSheet, View } from 'react-native';

import type { MainTabScreenProps } from '../../navigation/types';
import { useContacts, usePaykit } from '../../paykit';
import { Button, Divider, EmptyState, Row, Screen, Seal, Text, linkStateWords, middleEllipsis, sealRingFor, space } from '../../ui';

export function PeopleScreen({ navigation }: MainTabScreenProps<'People'>) {
  const { service } = usePaykit();
  const contacts = useContacts();

  return (
    <Screen
      scroll
      title="People"
      edges={['top']}
      testID="people-screen"
      headerRight={<Button label="Add" compact variant="secondary" onPress={() => navigation.navigate('AddPerson')} />}
    >
      {!service ? (
        <Text color="graphite">Connecting…</Text>
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
            <Row
              title={contact.name ?? middleEllipsis(contact.publicKey)}
              subtitle={linkStateWords(contact.linkState)}
              leading={<Seal pubky={contact.publicKey} size={44} ring={sealRingFor(contact.linkState)} />}
              onPress={() => navigation.navigate('Person', { pubky: contact.publicKey })}
              testID={`contact-${contact.publicKey}`}
            />
          </View>
        ))
      )}
      <View style={styles.spacer} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  spacer: { height: space.xl },
});
