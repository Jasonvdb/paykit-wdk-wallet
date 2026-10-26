// A labeled value on a review or detail screen: "Network fee" over
// "141 sats". The label is Graphite, the value Ink; pass a node (a KeyText,
// a Chip) when the value is more than text. Separate rows with <Divider />.
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { space } from './theme';

export type DetailRowProps = {
  label: string;
  value: ReactNode;
  /** A quieter line under the value, e.g. "1 sat/vB". */
  hint?: string;
  testID?: string;
};

export function DetailRow({ label, value, hint, testID }: DetailRowProps) {
  return (
    <View style={styles.row} testID={testID}>
      <Text variant="secondary" color="graphite">
        {label}
      </Text>
      {typeof value === 'string' ? <Text>{value}</Text> : value}
      {hint ? (
        <Text variant="caption" color="graphite">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: space.m, gap: space.xs },
});
