// Your pay-me code: your pubky as a QR code, with your seal and name, and
// ways to hand it over. Shown on Receive (beside the asset cards) and on
// You.
//
// The QR holds the contact link `paykitwdk://contact?pubky=<key>`: a phone
// camera opens this app straight on Add person, and this app's scanner
// reads both the link and a bare pubky. Copy gives the bare pubky (what
// other Pubky apps expect); Share sends both.
//
// With the pubky, people can pay you through your public addresses
// (You > What you publish) or add you as a contact for private ones.
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { contactLinkFor, useOwnProfile, usePaykitService } from '../../../paykit';
import { Button, Card, KeyText, QrCode, Text, space } from '../../../ui';
import { PersonSeal } from '../../people/PersonSeal';

export function PayMeCode({ qrSize = 208 }: { qrSize?: number }) {
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
    const who = profile.displayName ? `${profile.displayName} on ` : '';
    void Share.share({ message: `Pay ${who}the Paykit WDK test wallet: ${link}\n\nMy pubky: ${pubky}` });
  };

  return (
    <Card style={styles.card}>
      <View style={styles.heading}>
        <PersonSeal pubky={pubky} size={40} />
        <Text variant="heading" numberOfLines={1} style={styles.name}>
          {profile.displayName ?? 'Your pay-me code'}
        </Text>
      </View>
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
        Scan or paste this code to pay you or add you as a contact.
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
