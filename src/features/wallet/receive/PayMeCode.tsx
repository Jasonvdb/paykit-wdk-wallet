// Your pay-me code: your pubky as a QR code, with your seal and name, and
// ways to hand it over. Shown on Receive (beside the asset cards) and on
// You.
//
// The QR holds the contact link `paykitwdk://contact?pubky=<key>`: a phone
// camera opens this app straight on Add person, and this app's scanner
// reads both the link and a bare pubky. Copy gives the bare pubky (what
// other Pubky apps expect); Share sends a sentence, the link and the pubky,
// one per line, and that whole message can be pasted into Send's Person
// field, Add person or Scan (pubkyFromText finds the one key in it).
//
// Scanning opens Add person; paying you by pubky (your public addresses,
// You > What you publish) starts from Send. The note under the code says
// which is which. Share text avoids the SDK names (docs/DESIGN.md).
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { contactLinkFor, useOwnProfile, usePaykitService } from '../../../paykit';
import { Button, Card, KeyText, QrCode, Text, space } from '../../../ui';
import { PersonSeal } from '../../people/PersonSeal';

export function PayMeCode({ qrSize = 208, showHeading = true }: { qrSize?: number; /** False where the screen already shows your seal and name. */ showHeading?: boolean }) {
  const service = usePaykitService();
  const profile = useOwnProfile();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!service) {
    return (
      <Card style={styles.card}>
        <Text color="graphite">Connecting to your identity…</Text>
      </Card>
    );
  }
  const pubky = service.publicKey;
  const link = contactLinkFor(pubky);

  const onCopy = async () => {
    await Clipboard.setStringAsync(pubky);
    void Haptics.selectionAsync();
    setCopied(true);
  };
  const onShare = () => {
    const who = profile.displayName ?? 'Me';
    void Share.share({ message: `${who} in the test wallet. Paste this in Send to pay me, or open the link to add me:\n${link}\n${pubky}` });
  };

  return (
    <Card style={styles.card}>
      {showHeading ? (
        <View style={styles.heading}>
          <PersonSeal pubky={pubky} size={40} />
          <Text variant="heading" numberOfLines={1} style={styles.name}>
            {profile.displayName ?? 'Your pay-me code'}
          </Text>
        </View>
      ) : null}
      <View style={styles.qr} testID="pay-me-qr">
        <QrCode value={link} size={qrSize} />
      </View>
      <View style={styles.key}>
        <KeyText value={pubky} full small copyable={false} testID="pay-me-pubky" />
      </View>
      <View style={styles.actions}>
        <Button label={copied ? 'Copied' : 'Copy pubky'} variant="secondary" compact onPress={onCopy} testID="pay-me-copy" />
        <Button label="Share" variant="secondary" compact onPress={onShare} testID="pay-me-share" />
      </View>
      <Text variant="caption" color="graphite" style={styles.note}>
        Others scan this code to add you as a contact. To pay you, they paste your pubky in Send.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: space.s },
  heading: { flexDirection: 'row', alignItems: 'center', gap: space.s, maxWidth: '100%' },
  name: { flexShrink: 1 },
  qr: { marginVertical: space.l },
  key: { alignSelf: 'stretch', alignItems: 'center' },
  actions: { flexDirection: 'row', gap: space.s, marginTop: space.s, flexWrap: 'wrap', justifyContent: 'center' },
  note: { textAlign: 'center', marginTop: space.s },
});
