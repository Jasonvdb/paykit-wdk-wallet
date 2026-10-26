// You > profile: your seal with your photo and your published name, with
// "Edit profile" (the EditProfile modal). Your pubky is in the pay-me code
// right below it.
import { StyleSheet, View } from 'react-native';

import { useOwnProfile, usePaykitService } from '../../paykit';
import { Button, Text, space } from '../../ui';
import { PersonSeal } from '../people/PersonSeal';

export function ProfileSection({ onEdit }: { onEdit: () => void }) {
  const service = usePaykitService();
  const profile = useOwnProfile();
  if (!service) return null;
  return (
    <View style={styles.header} testID="you-profile">
      <PersonSeal pubky={service.publicKey} size={72} />
      <View style={styles.name}>
        <Text variant="heading" testID="you-name">
          {profile.displayName ?? 'No name yet'}
        </Text>
        <Button label="Edit profile" variant="secondary" compact onPress={onEdit} testID="you-edit-profile" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  name: { flex: 1, gap: space.s, alignItems: 'flex-start' },
});
