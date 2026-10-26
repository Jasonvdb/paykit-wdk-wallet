// An amount of one asset, formatted from bigint base units, with the asset's
// dot. The amount is the headline of a money screen (`size="hero"`).
//
// Asset colors are information: Amber next to BTC, Tether green next to
// USD₮, Graphite for ETH (shown as gas). Formatting rules live in
// src/wallet/amounts.ts.
import { StyleSheet, View } from 'react-native';

import { formatAssetAmount } from '../wallet/amounts';
import { ASSETS, type AssetId } from '../wallet/assets';
import { Text } from './Text';
import { assetColors, space, type TypeVariant } from './theme';

/** The asset dot's default diameter. Rows indent text under a dot by this plus their gap. */
export const ASSET_DOT_SIZE = 10;

export function AssetDot({ asset, size = ASSET_DOT_SIZE }: { asset: AssetId; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: assetColors[asset] }} />;
}

export type AssetAmountProps = {
  /** Base units; undefined renders a placeholder (still loading). */
  value: bigint | undefined;
  asset: AssetId;
  size?: 'hero' | 'row' | 'small';
  /** Prefix positive amounts with "+" (incoming activity). */
  signed?: boolean;
  showSymbol?: boolean;
  showDot?: boolean;
  /** Color the number in the asset color instead of Ink. */
  tinted?: boolean;
};

const VARIANT: Record<NonNullable<AssetAmountProps['size']>, TypeVariant> = {
  hero: 'amount',
  row: 'heading',
  small: 'secondary',
};

export function AssetAmount({ value, asset, size = 'row', signed, showSymbol = true, showDot, tinted }: AssetAmountProps) {
  const text = value === undefined ? '—' : formatAssetAmount(value, asset, { signed });
  const symbol = ASSETS[asset].symbol;
  return (
    <View style={styles.row} accessibilityLabel={value === undefined ? `${symbol} loading` : `${text} ${symbol}`}>
      {showDot ? <AssetDot asset={asset} /> : null}
      <Text variant={VARIANT[size]} style={tinted ? { color: assetColors[asset] } : undefined}>
        {text}
        {showSymbol ? (
          <Text variant={size === 'hero' ? 'heading' : VARIANT[size]} color="graphite">
            {` ${symbol}`}
          </Text>
        ) : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s },
});
