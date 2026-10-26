// Receive (modal): pick an asset, then show its receive card (address, QR,
// copy, share, explorer). Next to USD₮ sits "Get test USD₮", because a new
// wallet's first question is where test money comes from.
//
// Only account 0 is shown here: it is the public address. Contacts get
// their own BTC addresses through private payment lists (Phase 4).
//
// TODO(Phase 3 — Identity): the pay-me code (pubky QR + contactLinkFor).
// Add it as a third choice beside the assets, in its own component
// (receive/PayMeCode.tsx), and render it in the slot below.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RootScreenProps } from '../../navigation/types';
import { SheetScreen, Text, space } from '../../ui';
import { useWalletAddresses } from '../../wallet';
import { AssetPicker, isPayableAsset, type PayableAsset } from './AssetPicker';
import { GetTestUsdtButton } from './GetTestUsdtButton';
import { ReceiveCard } from './receive/ReceiveCard';

export function ReceiveScreen({ navigation, route }: RootScreenProps<'Receive'>) {
  const addresses = useWalletAddresses();
  const initial = route.params?.asset;
  const [asset, setAsset] = useState<PayableAsset>(isPayableAsset(initial) ? initial : 'btc');

  return (
    <SheetScreen title="Receive" onClose={() => navigation.goBack()} testID="receive-screen">
      <View style={styles.body}>
        <AssetPicker value={asset} onChange={setAsset} />
        <ReceiveCard asset={asset} address={asset === 'btc' ? addresses.btc : addresses.evm} />
        {asset === 'usdt' ? (
          <View style={styles.faucet}>
            <Text variant="bodyStrong">Need test USD₮?</Text>
            <Text color="graphite" variant="secondary">
              Mint it yourself from Aave’s Sepolia faucet. Anyone can mint test tokens.
            </Text>
            <GetTestUsdtButton compact />
          </View>
        ) : null}
        {/* Phase 3: the pay-me code renders here. */}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
  faucet: { gap: space.s },
});
