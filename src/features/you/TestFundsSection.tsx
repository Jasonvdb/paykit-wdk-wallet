// You > Test funds: where demo money comes from.
//
// - USD₮: "Get test USD₮" mints Aave's Sepolia test token from this wallet
//   (needs a little Sepolia ETH for gas; the button says so when there is
//   none).
// - ETH for gas and Mutinynet bitcoin come from public faucets, which need a
//   person (a login or a captcha), so this section links to them. The demo
//   scripts in scripts/fund-*.mjs do the same from a laptop.
import { Linking, StyleSheet, View } from 'react-native';

import { Button, KeyText, Text, space } from '../../ui';
import { formatFee, useWalletAddresses, useWalletBalances } from '../../wallet';
import { GetTestUsdtButton } from '../wallet/GetTestUsdtButton';

const MUTINYNET_FAUCET_URL = 'https://faucet.mutinynet.com';

export function TestFundsSection() {
  const { evm } = useWalletAddresses();
  const { balances } = useWalletBalances();
  return (
    <View style={styles.root}>
      <GetTestUsdtButton compact />
      <Text color="graphite" variant="secondary">
        Gas: {balances.eth === undefined ? '—' : formatFee(balances.eth, 'eth')}. Sepolia ETH comes from a public faucet; send it to
        your Ethereum address:
      </Text>
      {evm ? <KeyText value={evm} small testID="you-evm-address" /> : null}
      <Text color="graphite" variant="secondary">
        Test bitcoin comes from the Mutinynet faucet (GitHub login).
      </Text>
      <Button label="Open the Mutinynet faucet" variant="secondary" compact onPress={() => void Linking.openURL(MUTINYNET_FAUCET_URL)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.m, alignItems: 'flex-start' },
});
