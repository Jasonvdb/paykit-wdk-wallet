// You > Test funds: where demo money comes from.
//
// - USD₮: "Get test USD₮" mints Aave's Sepolia test token from this wallet
//   (needs a little Sepolia ETH for gas; the button says so when there is
//   none).
// - ETH for gas and Mutinynet bitcoin come from public faucets, which need a
//   person (a login or a captcha), so this section links to them
//   (src/config/chains.ts). Every "Not enough ETH for gas" message points
//   here. The demo scripts in scripts/fund-*.mjs do the same from a laptop.
//
// One Ethereum address holds both ETH and USD₮, so the text calls it "your
// Ethereum address" and says once that USD₮ arrives there too.
import { Linking, StyleSheet, View } from 'react-native';

import { MUTINYNET_FAUCET_URL, SEPOLIA_ETH_FAUCET_URL } from '../../config/chains';
import { Button, KeyText, Text, space } from '../../ui';
import { formatFee, useWalletAddresses, useWalletBalances } from '../../wallet';
import { GetTestUsdtButton } from '../wallet/GetTestUsdtButton';

export function TestFundsSection() {
  const { evm } = useWalletAddresses();
  const { balances } = useWalletBalances();
  return (
    <View style={styles.root}>
      <GetTestUsdtButton compact faucetBelow />
      <Text color="graphite" variant="secondary">
        Gas: {balances.eth === undefined ? '—' : formatFee(balances.eth, 'eth')}. Sepolia ETH comes from a public faucet. Ask it to send
        to your Ethereum address (USD₮ arrives there too):
      </Text>
      {evm ? <KeyText value={evm} small testID="you-evm-address" /> : null}
      <Button
        label="Open a Sepolia ETH faucet"
        variant="secondary"
        compact
        onPress={() => void Linking.openURL(SEPOLIA_ETH_FAUCET_URL)}
        testID="open-eth-faucet"
      />
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
