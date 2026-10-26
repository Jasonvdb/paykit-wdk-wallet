// Raised surfaces. The design keeps card treatment for the receive card and
// modals only; everything else is flat rows.
//
// - <Card>: a Sheet-colored block with the sheet radius and the one soft
//   shadow. Used for the receive card with the QR code.
// - <SheetScreen>: the frame for modal routes (Send, Receive, Request, Add
//   person): a title, a close button and scrollable content. Native-stack
//   presents it as a sheet on iOS and a full screen on Android.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Screen } from './Screen';
import { Text } from './Text';
import { colors, radii, sheetShadow, space } from './theme';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export type SheetScreenProps = {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  testID?: string;
};

export function SheetScreen({ title, onClose, footer, children, testID }: SheetScreenProps) {
  return (
    <Screen
      scroll
      title={title}
      footer={footer}
      testID={testID}
      headerLeft={
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12}>
          <Text variant="bodyStrong" color="seal">
            Close
          </Text>
        </Pressable>
      }
    >
      {children}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.sheet,
    borderRadius: radii.sheet,
    padding: space.xl,
    ...sheetShadow,
  },
});
