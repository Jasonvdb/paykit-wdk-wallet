// The frame for pushed routes (Person, Request detail, Activity detail): a
// "Back" text button in the header and scrollable content. Modals use
// <SheetScreen> (./Sheet.tsx), which has "Close" in the same place, so every
// route leaves the same way.
import type { ReactNode } from 'react';
import { Pressable } from 'react-native';

import { Screen } from './Screen';
import { Text } from './Text';

export type PushedScreenProps = {
  title?: string;
  onBack: () => void;
  footer?: ReactNode;
  children: ReactNode;
  testID?: string;
};

export function PushedScreen({ title, onBack, footer, children, testID }: PushedScreenProps) {
  return (
    <Screen
      scroll
      title={title}
      footer={footer}
      testID={testID}
      headerLeft={
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={12}>
          <Text variant="bodyStrong" color="seal">
            Back
          </Text>
        </Pressable>
      }
    >
      {children}
    </Screen>
  );
}
