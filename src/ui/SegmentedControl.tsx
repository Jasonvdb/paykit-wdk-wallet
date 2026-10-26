// A row of fully round choices where exactly one is selected: the asset
// picker on Send and Receive. The selected choice is Ink filled, like a
// primary button; the others are Sheet with a Rule outline.
//
// Generic over the value type, so `value` stays an AssetId (or a later
// phase's own union) instead of a string.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { colors, radii, space } from './theme';

export type SegmentOption<T extends string> = { value: T; label: string; leading?: ReactNode; testID?: string };

export type SegmentedControlProps<T extends string> = {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
};

export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel }: SegmentedControlProps<T>) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            testID={option.testID}
            style={({ pressed }) => [styles.segment, selected ? styles.selected : styles.unselected, pressed && styles.pressed]}
          >
            {option.leading}
            <Text variant="secondary" color={selected ? 'sheet' : 'ink'}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    borderRadius: radii.chip,
    paddingHorizontal: space.l,
    minHeight: 40,
  },
  selected: { backgroundColor: colors.ink },
  unselected: { backgroundColor: colors.sheet, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.rule },
  pressed: { opacity: 0.8 },
});
