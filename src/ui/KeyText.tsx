// A pubky, address or hash: mono face, shortened in the middle by default,
// tap to copy. These strings are compared character by character, which is
// why they get the mono face and nothing else does.
//
// Only pass public values. Never use this for a recovery phrase or a code.
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { middleEllipsis } from './format';
import { Text } from './Text';
import { space } from './theme';

export type KeyTextProps = {
  value: string;
  /** Show the whole value (wrapped) instead of the shortened form. */
  full?: boolean;
  /** Characters kept at each end in the short form. */
  head?: number;
  tail?: number;
  small?: boolean;
  /** Disable copy-on-tap. */
  copyable?: boolean;
  testID?: string;
};

export function KeyText({ value, full, head, tail, small, copyable = true, testID }: KeyTextProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const text = (
    <Text variant={small ? 'monoSmall' : 'mono'} selectable={full} testID={testID}>
      {full ? value : middleEllipsis(value, head, tail)}
    </Text>
  );
  if (!copyable) return text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Copy"
      accessibilityHint="Copies the full value"
      onPress={async () => {
        await Clipboard.setStringAsync(value);
        void Haptics.selectionAsync();
        setCopied(true);
      }}
      hitSlop={8}
    >
      <View style={styles.row}>
        {text}
        <Text variant="caption" color={copied ? 'seal' : 'graphite'}>
          {copied ? 'Copied' : 'Copy'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' },
});
