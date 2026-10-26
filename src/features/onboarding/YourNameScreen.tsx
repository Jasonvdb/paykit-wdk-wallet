// Onboarding 4/5: display name and optional photo, published as the Paykit
// profile (/pub/paykit/profile.json). Everything here is public.
//
// A restored identity may already have a profile: the name is prefilled
// from it and its photo shows inside your seal, so "Publish" keeps them
// unless you change them. A new photo shows in the seal before publishing.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { pickProfilePhoto, type ProfilePhoto } from '../../media/pickProfilePhoto';
import type { OnboardingScreenProps } from '../../navigation/types';
import { describeError, useOwnProfile, usePaykit, userMessageFor } from '../../paykit';
import { arrayBufferToBase64 } from '../../paykit/bytes';
import { Button, Input, Screen, Seal, Text, space } from '../../ui';

export function YourNameScreen({ navigation }: OnboardingScreenProps<'YourName'>) {
  const { service, log } = usePaykit();
  const existing = useOwnProfile();
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<ProfilePhoto & { dataUri: string }>();

  // Prefill from a published profile (a restored identity), once, unless
  // the person has started typing.
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current && existing.displayName) setName(existing.displayName);
  }, [existing.displayName]);
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
      log.error(`publish profile: ${describeError(e)}`);
      setError(userMessageFor(e, "Couldn't publish your profile. Try again, or skip for now."));
    } finally {
      setPublishing(false);
    }
  };

  const onPickPhoto = async () => {
    try {
      const picked = await pickProfilePhoto();
      if (picked) setPhoto({ ...picked, dataUri: `data:${picked.contentType};base64,${arrayBufferToBase64(picked.bytes)}` });
    } catch {
      setError("Couldn't use that photo. Try another one.");
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
            disabled={!service || (!name.trim() && !photo && !existing.image)}
            testID="publish-profile"
          />
          <Button label="Skip for now" variant="secondary" onPress={() => navigation.navigate('Ready')} testID="skip-profile" />
        </>
      }
    >
      <View style={styles.body}>
        <Text color="graphite">
          People see this name and photo when they add you or pay you. Both are public: anyone who knows your pubky can read them.
        </Text>
        <Input
          label="Display name"
          value={name}
          onChangeText={(text) => {
            typed.current = true;
            setName(text);
          }}
          placeholder="Ana"
          maxLength={128}
          testID="display-name"
        />
        <View style={styles.photoRow}>
          {service ? <Seal pubky={service.publicKey} size={72} imageUri={photo?.dataUri ?? existing.image} /> : null}
          <Button
            label={photo || existing.image ? 'Change photo' : 'Add a photo'}
            variant="secondary"
            compact
            onPress={onPickPhoto}
          />
        </View>
        {error ? <Text color="alert">{error}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.l },
});
