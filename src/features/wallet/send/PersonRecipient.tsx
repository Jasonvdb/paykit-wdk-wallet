// Review's "To" for a person: their seal, name and shortened pubky, whether
// they are one of your contacts, and the exact address the money goes to.
//
// The name and photo of someone who is not a contact come from their own
// profile, so anyone can publish "Ben" with Ben's photo. The review
// therefore says where the name comes from ("Not in your contacts: this is
// the name they gave themselves") and shows the key, which cannot be
// faked. Showing the address keeps the review honest too: a pubky resolves
// to an address on someone else's homeserver, and this is what the wallet
// will pay.
import { StyleSheet, View } from 'react-native';

import { KeyText, Text, space } from '../../../ui';
import { PersonSeal } from '../../people/PersonSeal';
import { usePersonName } from '../../people/usePersonName';
import type { SendRecipient } from './recipient';

export function PersonRecipient({ recipient, address }: { recipient: Extract<SendRecipient, { kind: 'pubky' }>; address: string }) {
  return (
    <View style={styles.root} testID="review-person">
      <PersonHeader publicKey={recipient.publicKey} sealSize={36} />
      <Text variant="caption" color="graphite">
        {recipient.route === 'private' ? 'Their private address for you:' : 'Their public address:'}
      </Text>
      <KeyText value={address} full small copyable={false} testID="review-person-address" />
    </View>
  );
}

/** Seal, name, short pubky, and whether the name is your contact's or self-chosen. Shared with the Send payee card. */
export function PersonHeader({ publicKey, sealSize }: { publicKey: string; sealSize: number }) {
  const person = usePersonName(publicKey);
  return (
    <View style={styles.person}>
      <PersonSeal pubky={publicKey} size={sealSize} />
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={1} testID="person-name">
          {person.name}
        </Text>
        {person.source !== 'key' ? <KeyText value={publicKey} small copyable={false} /> : null}
        <Text variant="caption" color="graphite" testID="person-name-source">
          {person.isContact
            ? 'In your contacts'
            : person.source === 'profile'
              ? 'Not in your contacts: this is the name they gave themselves.'
              : 'Not in your contacts.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.s },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  text: { flexShrink: 1, gap: 2 },
});
