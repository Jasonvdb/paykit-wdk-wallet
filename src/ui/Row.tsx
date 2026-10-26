// A list row: leading visual (a seal or an asset dot), title and subtitle,
// trailing content. Rows are flat: no cards and no shadows, separated by
// <Divider />.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { space, tints } from './theme';

export type RowProps = {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  /** Text or any element on the right (an amount, a chip). */
  trailing?: ReactNode;
  onPress?: () => void;
  testID?: string;
};

export function Row({ title, subtitle, leading, trailing, onPress, testID }: RowProps) {
  const body = (
    <View style={styles.row}>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.text}>
        <Text variant="body" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="secondary" color="graphite" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {typeof trailing === 'string' ? <Text variant="body">{trailing}</Text> : trailing}
    </View>
  );
  if (!onPress) return <View testID={testID}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => pressed && { backgroundColor: tints.pressed }}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.m, gap: space.m, minHeight: 56 },
  leading: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
});
