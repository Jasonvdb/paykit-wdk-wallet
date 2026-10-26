// Onboarding 4/5: display name and optional photo, published as the Paykit
// profile (/pub/paykit/profile.json). Everything here is public.
//
// Functional for Phase 1 (name + photo + publish, or skip).
//
// TODO(Phase 3 — Identity): prefill from an existing profile when
// restoring, show the photo inside the user's seal, explain what is public.
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { pickProfilePhoto, type ProfilePhoto } from '../../media/pickProfilePhoto';
import type { OnboardingScreenProps } from '../../navigation/types';
import { describeError, usePaykitService } from '../../paykit';
import { Button, Input, Screen, Text, space } from '../../ui';

export function YourNameScreen({ navigation }: OnboardingScreenProps<'YourName'>) {
  const service = usePaykitService();
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<ProfilePhoto>();
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string>();

  const onPublish = async () => {
    if (!service) return;
    setPublishing(true);
    setError(undefined);
    try {
      await service.publishProfile({
        displayName: name.trim() || undefined,
        avatar: photo ? { bytes: photo.bytes, contentType: photo.contentType } : undefined,
      });
      navigation.navigate('Ready');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPublishing(false);
    }
  };

  const onPickPhoto = async () => {
    try {
      const picked = await pickProfilePhoto();
      if (picked) setPhoto(picked);
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <Screen
      scroll
      title="Your name"
      footer={
        <>
          <Button
            label="Publish my profile"
            onPress={onPublish}
            loading={publishing}
            disabled={!service || (!name.trim() && !photo)}
            testID="publish-profile"
          />
          <Button label="Skip for now" variant="secondary" onPress={() => navigation.navigate('Ready')} testID="skip-profile" />
        </>
      }
    >
      <View style={styles.body}>
        <Text color="graphite">People see this name and photo when they add you. Both are public.</Text>
        <Input label="Display name" value={name} onChangeText={setName} placeholder="Ana" maxLength={128} testID="display-name" />
        <View style={styles.photoRow}>
          {photo ? <Image source={{ uri: photo.previewUri }} style={styles.photo} /> : null}
          <Button label={photo ? 'Change photo' : 'Add a photo'} variant="secondary" compact onPress={onPickPhoto} />
        </View>
        {error ? <Text color="alert">{error}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  photo: { width: 64, height: 64, borderRadius: 32 },
});
