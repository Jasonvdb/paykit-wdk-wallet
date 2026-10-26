// Edit profile (modal, from You): your display name and photo.
//
// Both are public: they are published to your homeserver as your profile
// and anyone who looks up your pubky can read them. The photo is picked
// from the library, square-cropped and shrunk to 400 px
// (src/media/pickProfilePhoto.ts), uploaded as a blob, and the profile
// points at it.
//
// Publishing reads the current profile first and passes its revision, so a
// change made from another device in between is not overwritten: the
// person sees "Still finishing another change…" and tries again.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { pickProfilePhoto, type ProfilePhoto } from '../../media/pickProfilePhoto';
import type { RootScreenProps } from '../../navigation/types';
import { describeError, useOwnProfile, usePaykit, userMessageFor } from '../../paykit';
import { arrayBufferToBase64 } from '../../paykit/bytes';
import { Button, Input, Seal, SheetScreen, Text, space } from '../../ui';

/** What happens to the photo when the person taps Publish. */
type PhotoChange = { kind: 'keep' } | { kind: 'new'; photo: ProfilePhoto; dataUri: string } | { kind: 'remove' };

export function EditProfileScreen({ navigation }: RootScreenProps<'EditProfile'>) {
  const { service, log } = usePaykit();
  const current = useOwnProfile();
  const [name, setName] = useState(current.displayName ?? '');
  const [photo, setPhoto] = useState<PhotoChange>({ kind: 'keep' });
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string>();

  // The cached profile can arrive after the screen opens: prefill the name
  // once, unless the person has already started typing.
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current && current.displayName) setName(current.displayName);
  }, [current.displayName]);
  // Fetch a fresh copy, in case the profile changed elsewhere.
  useEffect(() => {
    if (service) void service.profiles.ensureProfile(service.publicKey, { force: true });
  }, [service]);

  const previewImage = photo.kind === 'new' ? photo.dataUri : photo.kind === 'remove' ? undefined : current.image;
  const hasPhoto = previewImage !== undefined;
  const nameChanged = name.trim() !== (current.displayName ?? '');
  const changed = nameChanged || photo.kind !== 'keep';

  const onPickPhoto = async () => {
    setError(undefined);
    try {
      const picked = await pickProfilePhoto();
      if (picked) setPhoto({ kind: 'new', photo: picked, dataUri: `data:${picked.contentType};base64,${arrayBufferToBase64(picked.bytes)}` });
    } catch {
      setError("Couldn't use that photo. Try another one.");
    }
  };

  const onPublish = async () => {
    if (!service) return;
    setPublishing(true);
    setError(undefined);
    try {
      await service.publishProfile({
        // An empty field removes the name; an unchanged one is left as is.
        displayName: nameChanged ? name.trim() : undefined,
        avatar:
          photo.kind === 'new'
            ? { bytes: photo.photo.bytes, contentType: photo.photo.contentType }
            : photo.kind === 'remove'
              ? null
              : undefined,
      });
      navigation.goBack();
    } catch (e) {
      log.error(`publish profile: ${describeError(e)}`);
      setError(userMessageFor(e, "Couldn't publish your profile. Try again."));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <SheetScreen
      title="Your profile"
      onClose={() => navigation.goBack()}
      testID="edit-profile-screen"
      footer={
        <Button
          label="Publish my profile"
          onPress={onPublish}
          loading={publishing}
          disabled={!service || !changed}
          testID="edit-profile-publish"
        />
      }
    >
      <View style={styles.body}>
        <Text color="graphite">People see your name and photo when they add you or pay you. Both are public.</Text>
        <View style={styles.photoRow}>
          {service ? <Seal pubky={service.publicKey} size={96} imageUri={previewImage} testID="edit-profile-seal" /> : null}
          <View style={styles.photoActions}>
            <Button
              label={hasPhoto ? 'Change photo' : 'Add a photo'}
              variant="secondary"
              compact
              onPress={onPickPhoto}
              disabled={publishing}
              testID="edit-profile-photo"
            />
            {hasPhoto ? (
              <Button
                label="Remove photo"
                variant="destructive"
                compact
                onPress={() => setPhoto({ kind: 'remove' })}
                disabled={publishing}
                testID="edit-profile-remove-photo"
              />
            ) : null}
          </View>
        </View>
        <Input
          label="Display name"
          value={name}
          onChangeText={(text) => {
            typed.current = true;
            setName(text);
          }}
          placeholder="Ana"
          maxLength={128}
          autoCapitalize="words"
          testID="edit-profile-name"
        />
        {error ? (
          <Text color="alert" testID="edit-profile-error">
            {error}
          </Text>
        ) : null}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  photoActions: { gap: space.s },
});
