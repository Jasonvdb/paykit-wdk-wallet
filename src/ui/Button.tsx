// Buttons say what happens ("Send 12 USD₮", "Add Ana").
//
//   primary      Ink filled: the one main action on a screen
//   secondary    Sheet with a Rule outline
//   destructive  Alert text on Sheet: remove, block, reset
//
// `loading` shows a spinner and blocks presses, so a slow WDK or Paykit call
// cannot be triggered twice.
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { colors, radii, space } from './theme';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';

export type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  /** Shrink to the label instead of filling the row. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Button({ label, onPress, variant = 'primary', loading, disabled, compact, style, testID }: ButtonProps) {
  const inactive = disabled || loading;
  const textColor = variant === 'primary' ? 'sheet' : variant === 'destructive' ? 'alert' : 'ink';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' ? styles.primary : styles.outlined,
        compact && styles.compact,
        pressed && styles.pressed,
        disabled && !loading && styles.disabled,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={colors[textColor]} style={styles.spinner} /> : null}
        <Text variant="bodyStrong" color={textColor} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radii.button,
    paddingHorizontal: space.l,
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.ink },
  outlined: { backgroundColor: colors.sheet, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.rule },
  compact: { alignSelf: 'flex-start', minHeight: 40 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.4 },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  spinner: { marginRight: space.s },
});
