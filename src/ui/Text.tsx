// Text with the design's type scale. Use a variant instead of ad-hoc font
// sizes; `color` takes a token name from ./theme.ts.
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { colors, typography, type TypeVariant } from './theme';

export type TextProps = RNTextProps & {
  variant?: TypeVariant;
  color?: keyof typeof colors;
};

export function Text({ variant = 'body', color = 'ink', style, ...rest }: TextProps) {
  return <RNText {...rest} style={[typography[variant], { color: colors[color] }, style]} />;
}
