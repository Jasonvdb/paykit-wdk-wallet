// The amount, set large: on a money screen the amount is the headline
// (docs/DESIGN.md). The person types decimals ("0.0005", "12.5"); the screen
// parses them to base units with parseAssetAmount. "Max" fills in the most
// this wallet can send: the whole USD₮ balance (gas is paid in ETH), or for
// BTC what is left after the network fee. Request money uses the same
// field without Max: that amount is not paid from this wallet.
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Text, colors, fonts, space, typography } from '../../../ui';
import { ASSETS, formatAssetAmount, type AssetId } from '../../../wallet';

export type AmountFieldProps = {
  asset: AssetId;
  text: string;
  onChangeText: (text: string) => void;
  /** Spendable balance in base units, if loaded. */
  balance?: bigint;
  /** Leave out for an amount that is not paid from this wallet (Request money): no Max, no balance line. */
  onMax?: () => void;
  maxLoading?: boolean;
  /** A parse error or an affordability problem. */
  error?: string;
};

export function AmountField({ asset, text, onChangeText, balance, onMax, maxLoading, error }: AmountFieldProps) {
  const symbol = ASSETS[asset].symbol;
  return (
    <View style={styles.root}>
      <Text variant="secondary" color="graphite">
        Amount
      </Text>
      <View style={styles.row}>
        <TextInput
          value={text}
          onChangeText={onChangeText}
          placeholder="0"
          placeholderTextColor={colors.rule}
          keyboardType="decimal-pad"
          autoCorrect={false}
          accessibilityLabel={`Amount in ${symbol}`}
          style={styles.input}
          testID="send-amount"
        />
        <Text variant="heading" color="graphite">
          {symbol}
        </Text>
      </View>
      {onMax ? (
        <View style={styles.footer}>
          <Text variant="caption" color="graphite" style={styles.balance}>
            {balance === undefined ? 'Loading balance…' : `You have ${formatAssetAmount(balance, asset, { withSymbol: true })}`}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Send the maximum" onPress={onMax} disabled={maxLoading} hitSlop={8} testID="send-max">
            {maxLoading ? (
              <ActivityIndicator size="small" color={colors.seal} />
            ) : (
              <Text variant="bodyStrong" color="seal">
                Max
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
      {error ? (
        <Text variant="caption" color="alert" testID="send-amount-error">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: space.s, borderBottomWidth: 1, borderBottomColor: colors.rule },
  input: { ...typography.amount, fontFamily: fonts.display, color: colors.ink, flex: 1, paddingVertical: space.s },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m },
  balance: { flex: 1 },
});
