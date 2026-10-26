// Bitcoin or USD₮: the asset choice on Send and Receive. ETH is not offered:
// in this wallet it is only gas for USD₮ (docs/DESIGN.md).
import { AssetDot, SegmentedControl } from '../../ui';
import { ASSETS, type AssetId } from '../../wallet';

/** The assets people send and receive. */
export const PAYABLE_ASSETS = ['btc', 'usdt'] as const satisfies readonly AssetId[];
export type PayableAsset = (typeof PAYABLE_ASSETS)[number];

export function isPayableAsset(asset: AssetId | undefined): asset is PayableAsset {
  return asset === 'btc' || asset === 'usdt';
}

export function AssetPicker({ value, onChange }: { value: PayableAsset; onChange: (asset: PayableAsset) => void }) {
  return (
    <SegmentedControl
      accessibilityLabel="Asset"
      value={value}
      onChange={onChange}
      options={PAYABLE_ASSETS.map((asset) => ({
        value: asset,
        label: asset === 'btc' ? 'Bitcoin' : ASSETS[asset].symbol,
        leading: <AssetDot asset={asset} />,
        testID: `asset-${asset}`,
      }))}
    />
  );
}
