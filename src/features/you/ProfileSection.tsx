// You > profile: your seal with your photo, your published name and your
// pubky, with "Edit profile" (the EditProfile modal).
import { StyleSheet, View } from 'react-native';

import { useOwnProfile, usePaykitService } from '../../paykit';
import { Button, KeyText, Text, space } from '../../ui';
import { PersonSeal } from '../people/PersonSeal';

export function ProfileSection({ onEdit }: { onEdit: () => void }) {
  const service = usePaykitService();
  const profile = useOwnProfile();
  if (!service) return null;
  return (
    <View style={styles.root} testID="you-profile">
      <View style={styles.header}>
        <PersonSeal pubky={service.publicKey} size={72} />
        <View style={styles.name}>
          <Text variant="heading" testID="you-name">
            {profile.displayName ?? 'No name yet'}
          </Text>
          <Button label="Edit profile" variant="secondary" compact onPress={onEdit} testID="you-edit-profile" />
        </View>
      </View>
      <KeyText value={service.publicKey} full small testID="own-pubky" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.m },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  name: { flex: 1, gap: space.s, alignItems: 'flex-start' },
});
