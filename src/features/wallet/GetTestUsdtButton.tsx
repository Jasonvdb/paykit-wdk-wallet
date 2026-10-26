// "Get test USD₮": the wallet mints Aave's Sepolia test USDT to itself
// (src/wallet/useUsdtFaucet.ts). The mint is a contract call, so it costs a
// little Sepolia ETH; with no ETH the button is disabled and says why,
// instead of failing after a tap.
//
// A mint that fails in a way that may have reached the network keeps the
// button disabled (sendFailureFor): a second mint would cost gas twice.
// A ref guards against a double tap before React re-renders.
//
// Used on Receive (next to USD₮), on the Wallet tab when USD₮ is empty, and
// in You &gt; Test funds.
import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button, Text, space } from '../../ui';
import { CONFIRMATION_TIME, DEFAULT_FAUCET_MINT_UNITS, formatAssetAmount, sendFailureFor, useUsdtFaucet, useWalletBalances } from '../../wallet';

/** "Get 1,000 test USD₮". */
const MINT_LABEL = `Get ${formatAssetAmount(DEFAULT_FAUCET_MINT_UNITS, 'usdt').replace(/\.00$/, '')} test USD₮`;

export function GetTestUsdtButton({ compact, faucetBelow }: { compact?: boolean; /** In You > Test funds, where the ETH faucet link is right below. */ faucetBelow?: boolean }) {
  const faucet = useUsdtFaucet();
  const { balances, refresh } = useWalletBalances();
  const [minting, setMinting] = useState(false);
  const [result, setResult] = useState<{ explorerUrl: string }>();
  const [error, setError] = useState<string>();
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const inFlight = useRef(false);

  const noGas = balances.eth === 0n;
  const onMint = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setMinting(true);
    setError(undefined);
    setResult(undefined);
    try {
      const minted = await faucet.mint();
      setResult(minted);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void refresh();
    } catch (e) {
      const failure = sendFailureFor(e, 'usdt');
      setError(failure.message);
      if (failure.outcome === 'unknown') {
        setOutcomeUnknown(true);
        void refresh();
      }
    } finally {
      inFlight.current = false;
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
        disabled={!faucet.isReady || noGas || outcomeUnknown}
        testID="get-test-usdt"
      />
      {noGas && !result ? (
        <Text variant="caption" color="graphite" testID="faucet-needs-gas">
          Minting needs a little Sepolia ETH for gas, and this wallet has none. {faucetBelow ? 'Get some from the Sepolia ETH faucet below.' : 'Get some for your Ethereum address in You > Test funds.'}
        </Text>
      ) : null}
      {result ? (
        <View style={styles.result}>
          <Text variant="caption" color="graphite">
            Minting. It arrives with the next Sepolia block, in {CONFIRMATION_TIME.ethereum}.
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
