// Your own name for a contact: a local label that wins over the name they
// publish (personName.ts). It is stored in the contact record on this
// phone (saveContact) and never shared. Clearing it goes back to their
// published name.
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { describeError, usePaykit, userMessageFor } from '../../../paykit';
import { Button, Input, Text, space } from '../../../ui';

export function LabelEditor({ publicKey, label, publishedName }: { publicKey: string; label?: string; publishedName?: string }) {
  const { service, log } = usePaykit();
  const [text, setText] = useState(label ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  // A label changed elsewhere (or the first snapshot arriving) resets the field.
  useEffect(() => setText(label ?? ''), [label]);

  const save = async (next: string) => {
    if (!service) return;
    setSaving(true);
    setError(undefined);
    setSaved(false);
    try {
      await service.setContactLabel(publicKey, next);
      setSaved(true);
    } catch (e) {
      log.warn(`rename contact: ${describeError(e)}`);
      setError(userMessageFor(e, "Couldn't save that name. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const changed = text.trim() !== (label ?? '');
  return (
    <View style={styles.root}>
      <Input
        label="Your name for them"
        value={text}
        onChangeText={(next) => {
          setText(next);
          setSaved(false);
        }}
        placeholder={publishedName ?? 'A name only you see'}
        maxLength={64}
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={() => changed && void save(text)}
        error={error}
        hint={
          publishedName
            ? `Only on this phone. They call themselves “${publishedName}”.`
            : 'Only on this phone. They have not published a name.'
        }
        testID="person-label"
      />
      <View style={styles.actions}>
        <Button label="Save name" compact onPress={() => void save(text)} loading={saving} disabled={!changed || !service} testID="person-label-save" />
        {label && publishedName ? (
          <Button
            label={`Use “${publishedName}”`}
            variant="secondary"
            compact
            onPress={() => {
              setText('');
              void save('');
            }}
            disabled={saving}
            testID="person-label-clear"
          />
        ) : null}
        {saved && !changed ? (
          <Text variant="caption" color="graphite">
            Saved
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.s },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' },
});
