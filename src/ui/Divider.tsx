// A hairline in Rule color between rows.
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from './theme';

export function Divider({ inset = 0, style }: { inset?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.line, { marginLeft: inset }, style]} />;
}

const styles = StyleSheet.create({
  line: { height: StyleSheet.hairlineWidth, backgroundColor: colors.rule },
});
