// Small fully-round labels. The persistent "Testnet" chip marks the network
// clearly but quietly: never a scary banner.
import { StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { colors, radii, space } from './theme';

export type ChipTone = 'neutral' | 'seal' | 'alert';

export function Chip({ label, tone = 'neutral' }: { label: string; tone?: ChipTone }) {
  const color = tone === 'seal' ? 'seal' : tone === 'alert' ? 'alert' : 'graphite';
  return (
    <View style={[styles.chip, { borderColor: colors[color] + '55' }]}>
      <Text variant="caption" color={color}>
        {label}
      </Text>
    </View>
  );
}

export function TestnetChip() {
  return <Chip label="Testnet" />;
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radii.chip,
    borderWidth: 1,
    paddingHorizontal: space.m - 2,
    paddingVertical: 2,
    backgroundColor: colors.sheet,
  },
});
