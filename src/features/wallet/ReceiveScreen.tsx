// Receive (modal): asset picker, the address with its QR code, and "Your
// pay-me code" (your pubky as a QR and a paykitwdk:// link).
//
// Phase 1 lists the two account-0 addresses so funds can be sent in.
//
// TODO(Phase 2 — Wallet): asset picker, centered receive card with QrCode,
// copy/share, "Get test USD₮" (useUsdtFaucet) next to USD₮.
// TODO(Phase 3 — Identity): the pay-me code tab (pubky QR + contactLinkFor).
import { StyleSheet, View } from 'react-native';

import type { RootScreenProps } from '../../navigation/types';
import { KeyText, SheetScreen, Text, space } from '../../ui';
import { useWalletAddresses } from '../../wallet';

export function ReceiveScreen({ navigation }: RootScreenProps<'Receive'>) {
  const addresses = useWalletAddresses();
  return (
    <SheetScreen title="Receive" onClose={() => navigation.goBack()} testID="receive-screen">
      <View style={styles.block}>
        <Text variant="bodyStrong">Bitcoin (Mutinynet)</Text>
        {addresses.btc ? <KeyText value={addresses.btc} full small /> : <Text color="graphite">Loading…</Text>}
      </View>
      <View style={styles.block}>
        <Text variant="bodyStrong">USD₮ and ETH (Sepolia)</Text>
        {addresses.evm ? <KeyText value={addresses.evm} full small /> : <Text color="graphite">Loading…</Text>}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s, marginBottom: space.xl },
});
