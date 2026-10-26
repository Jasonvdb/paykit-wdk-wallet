// "Get test USD₮": the wallet mints Aave's Sepolia test USDT to itself
// (src/wallet/useUsdtFaucet.ts). The mint is a contract call, so it costs a
// little Sepolia ETH; with no ETH the button is disabled and says why,
// instead of failing after a tap.
//
// Used on Receive (next to USD₮), on the Wallet tab when USD₮ is empty, and
// in You > Test funds.
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button, Text, space } from '../../ui';
import { DEFAULT_FAUCET_MINT_UNITS, formatAssetAmount, sendErrorMessage, useUsdtFaucet, useWalletBalances } from '../../wallet';

/** "Get 1,000 test USD₮". */
const MINT_LABEL = `Get ${formatAssetAmount(DEFAULT_FAUCET_MINT_UNITS, 'usdt').replace(/\.00$/, '')} test USD₮`;

export function GetTestUsdtButton({ compact }: { compact?: boolean }) {
  const faucet = useUsdtFaucet();
  const { balances, refresh } = useWalletBalances();
  const [minting, setMinting] = useState(false);
  const [result, setResult] = useState<{ explorerUrl: string }>();
  const [error, setError] = useState<string>();

  const noGas = balances.eth === 0n;
  const onMint = async () => {
    setMinting(true);
    setError(undefined);
    setResult(undefined);
    try {
      const minted = await faucet.mint();
      setResult(minted);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void refresh();
    } catch (e) {
      setError(sendErrorMessage(e, 'usdt'));
    } finally {
      setMinting(false);
    }
  };

  return (
    <View style={styles.root}>
      <Button
        label={minting ? 'Minting…' : MINT_LABEL}
        variant="secondary"
        compact={compact}
        onPress={onMint}
        loading={minting}
        disabled={!faucet.isReady || noGas}
        testID="get-test-usdt"
      />
      {noGas && !result ? (
        <Text variant="caption" color="graphite" testID="faucet-needs-gas">
          Minting needs a little Sepolia ETH for gas, and this wallet has none. Send some to your USD₮ address first.
        </Text>
      ) : null}
      {result ? (
        <View style={styles.result}>
          <Text variant="caption" color="graphite">
            Minting. It arrives with the next Sepolia block, in about 12 seconds.
          </Text>
          <Button label="View on explorer" variant="secondary" compact onPress={() => void Linking.openURL(result.explorerUrl)} />
        </View>
      ) : null}
      {error ? (
        <Text variant="caption" color="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.s, alignItems: 'flex-start' },
  result: { gap: space.s, alignItems: 'flex-start' },
});
