// Review's "To" for a person: their seal and name, and the exact address
// the money goes to, with where that address came from. Showing the
// address keeps the review honest: a pubky resolves to an address on
// someone else's homeserver, and this is what the wallet will pay.
import { StyleSheet, View } from 'react-native';

import { KeyText, Text, space } from '../../../ui';
import { PersonSeal } from '../../people/PersonSeal';
import type { SendRecipient } from './recipient';

export function PersonRecipient({ recipient, address }: { recipient: Extract<SendRecipient, { kind: 'pubky' }>; address: string }) {
  return (
    <View style={styles.root} testID="review-person">
      <View style={styles.person}>
        <PersonSeal pubky={recipient.publicKey} size={36} />
        <Text variant="bodyStrong" numberOfLines={1} style={styles.name}>
          {recipient.label}
        </Text>
      </View>
      <Text variant="caption" color="graphite">
        {recipient.route === 'private' ? 'Their private address for you:' : 'Their public address:'}
      </Text>
      <KeyText value={address} full small copyable={false} testID="review-person-address" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.s },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  name: { flexShrink: 1 },
});
