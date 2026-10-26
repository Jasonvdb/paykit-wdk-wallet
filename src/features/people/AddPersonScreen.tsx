// Add person (modal): paste a pubky, scan a QR, or arrive from a
// paykitwdk://contact?pubky=<key> link. Saving starts the Encrypted Link;
// it completes once they add you too.
//
// Phase 1: paste (prefilled with the other demo phone's key in dev builds)
// and save, so the two phones can link.
//
// TODO(Phase 4 — Contacts): profile preview before saving ("Retrieving
// contact info…" via PaykitService.resolvePeer), reject duplicates, label
// field, paste button, mutual-add explainer. ("Scan their pay-me code"
// opens ScanQr, Phase 3.)
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { demoPrefill } from '../../config/demo';
import type { RootScreenProps } from '../../navigation/types';
import { describeError, keyFromContactLink, usePaykit, userMessageFor } from '../../paykit';
import { Button, Input, SheetScreen, Text, space } from '../../ui';

export function AddPersonScreen({ navigation, route }: RootScreenProps<'AddPerson'>) {
  const { service, log } = usePaykit();
  const [text, setText] = useState(route.params?.pubky ?? demoPrefill.peerPubky ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const onSave = async () => {
    if (!service) return;
    setSaving(true);
    setError(undefined);
    try {
      const record = await service.saveContactAndLink(keyFromContactLink(text) ?? '');
      navigation.replace('Person', { pubky: record.publicKey });
    } catch (e) {
      log.warn(`add contact: ${describeError(e)}`);
      setError(userMessageFor(e, "Couldn't add that key. Check that it is a full pubky and try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SheetScreen
      title="Add person"
      onClose={() => navigation.goBack()}
      testID="add-person-screen"
      footer={<Button label="Add person" onPress={onSave} loading={saving} disabled={!service || !text.trim()} testID="add-person-save" />}
    >
      <View style={styles.body}>
        <Input label="Their pubky" value={text} onChangeText={setText} mono multiline placeholder="pubky…" error={error} testID="add-person-key" />
        <Text variant="secondary" color="graphite">
          You and they must add each other to pay each other privately.
        </Text>
        <Button label="Scan their pay-me code" variant="secondary" compact onPress={() => navigation.replace('ScanQr')} testID="add-person-scan" />
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.l },
});
