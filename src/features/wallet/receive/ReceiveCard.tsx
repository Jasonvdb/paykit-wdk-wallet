// The receive card: one asset's account-0 address as a QR code, the full
// address in the mono face, and ways to hand it over (copy, share) or check
// it (explorer). It is the one centered element in the app (docs/DESIGN.md).
//
// The QR holds the plain address, not a payment URI: every wallet reads a
// plain address, and the person types the amount on their side.
// USD₮ and ETH share one Ethereum address, so the USD₮ card says that gas
// money (Sepolia ETH) goes to the same place.
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Linking, Share, StyleSheet, View } from 'react-native';

import { AssetDot, Button, Card, KeyText, QrCode, Text, space } from '../../../ui';
import { addressUrl } from '../../../wallet';

const CARD_TEXT: Record<'btc' | 'usdt', { title: string; network: string; note: string }> = {
  btc: {
    title: 'Bitcoin',
    network: 'Mutinynet test network',
    note: 'Send only Mutinynet test bitcoin to this address.',
  },
  usdt: {
    title: 'USD₮',
    network: 'Ethereum Sepolia test network',
    note: 'Sepolia ETH for gas arrives at this same address. Send only Sepolia test tokens here.',
  },
};

export function ReceiveCard({ asset, address }: { asset: 'btc' | 'usdt'; address?: string }) {
  const text = CARD_TEXT[asset];
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const chain = asset === 'btc' ? 'bitcoin' : 'ethereum';
  const onCopy = async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    void Haptics.selectionAsync();
    setCopied(true);
  };
  const onShare = () => {
    if (address) void Share.share({ message: address });
  };

  return (
    <Card style={styles.card}>
      <View style={styles.heading}>
        <AssetDot asset={asset} />
        <Text variant="heading">{text.title}</Text>
      </View>
      <Text variant="caption" color="graphite">
        {text.network}
      </Text>
      <View style={styles.qr} testID={`receive-qr-${asset}`}>
        {address ? <QrCode value={address} size={208} /> : <Text color="graphite">Deriving your address…</Text>}
      </View>
      {address ? (
        <>
          <View style={styles.address}>
            <KeyText value={address} full copyable={false} testID={`receive-address-${asset}`} />
          </View>
          <View style={styles.actions}>
            <Button label={copied ? 'Copied' : 'Copy'} variant="secondary" compact onPress={onCopy} testID="receive-copy" />
            <Button label="Share" variant="secondary" compact onPress={onShare} testID="receive-share" />
            <Button label="View on explorer" variant="secondary" compact onPress={() => void Linking.openURL(addressUrl(chain, address))} />
          </View>
        </>
      ) : null}
      <Text variant="caption" color="graphite" style={styles.note}>
        {text.note}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: space.s },
  heading: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  qr: { marginVertical: space.l, minHeight: 208, justifyContent: 'center' },
  address: { alignSelf: 'stretch', alignItems: 'center' },
  actions: { flexDirection: 'row', gap: space.s, marginTop: space.s, flexWrap: 'wrap', justifyContent: 'center' },
  note: { textAlign: 'center', marginTop: space.s },
});
