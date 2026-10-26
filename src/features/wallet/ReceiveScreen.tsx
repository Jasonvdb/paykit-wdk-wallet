// Receive (modal): pick an asset, then show its receive card (address, QR,
// copy, share, explorer), or pick "Pay-me code" to show your pubky as a QR.
// Next to USD₮ sits "Get test USD₮", because a new wallet's first question
// is where test money comes from.
//
// Only account 0 is shown here: it is the public address. Contacts get
// their own BTC addresses through private payment lists (Phase 4). The
// pay-me code (receive/PayMeCode.tsx) lets people pay you by pubky
// instead, through the public addresses you publish.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RootScreenProps } from '../../navigation/types';
import { AssetDot, SegmentedControl, SheetScreen, Text, space } from '../../ui';
import { useWalletAddresses } from '../../wallet';
import { isPayableAsset, type PayableAsset } from './AssetPicker';
import { GetTestUsdtButton } from './GetTestUsdtButton';
import { PayMeCode } from './receive/PayMeCode';
import { ReceiveCard } from './receive/ReceiveCard';

type ReceiveChoice = PayableAsset | 'pubky';

export function ReceiveScreen({ navigation, route }: RootScreenProps<'Receive'>) {
  const addresses = useWalletAddresses();
  const initial = route.params?.asset;
  const [choice, setChoice] = useState<ReceiveChoice>(
    route.params?.code === 'pubky' ? 'pubky' : isPayableAsset(initial) ? initial : 'btc',
  );

  return (
    <SheetScreen title="Receive" onClose={() => navigation.goBack()} testID="receive-screen">
      <View style={styles.body}>
        <SegmentedControl<ReceiveChoice>
          accessibilityLabel="What to receive"
          value={choice}
          onChange={setChoice}
          options={[
            { value: 'btc', label: 'Bitcoin', leading: <AssetDot asset="btc" />, testID: 'asset-btc' },
            { value: 'usdt', label: 'USD₮', leading: <AssetDot asset="usdt" />, testID: 'asset-usdt' },
            { value: 'pubky', label: 'Pay-me code', testID: 'receive-pay-me-code' },
          ]}
        />
        {choice === 'pubky' ? (
          <PayMeCode />
        ) : (
          <ReceiveCard asset={choice} address={choice === 'btc' ? addresses.btc : addresses.evm} />
        )}
        {choice === 'usdt' ? (
          <View style={styles.faucet}>
            <Text variant="bodyStrong">Need test USD₮?</Text>
            <Text color="graphite" variant="secondary">
              Mint it yourself from Aave’s Sepolia faucet. Anyone can mint test tokens.
            </Text>
            <GetTestUsdtButton compact />
          </View>
        ) : null}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
  faucet: { gap: space.s },
});
