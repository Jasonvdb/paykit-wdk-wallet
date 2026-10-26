// A labeled text field on Sheet, with a Seal focus ring and an error line.
//
// `mono` switches to the mono face for keys and addresses. For secrets
// (recovery phrase, invite code) pass `secret`: no autocorrect, no
// suggestions, and the keyboard is told not to learn the text.
import { forwardRef, useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Text } from './Text';
import { colors, fonts, radii, space, typography } from './theme';

export type InputProps = Omit<TextInputProps, 'style'> & {
  label?: string;
  error?: string;
  hint?: string;
  mono?: boolean;
  /** Treat the value as a secret (phrases, codes). Visible, but never learned by the keyboard. */
  secret?: boolean;
  /** Element shown inside the field on the right, e.g. a "Paste" button. */
  accessory?: ReactNode;
};

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, hint, mono, secret, accessory, onFocus, onBlur, multiline, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrapper}>
      {label ? (
        <Text variant="secondary" color="graphite">
          {label}
        </Text>
      ) : null}
      <View style={[styles.field, focused && styles.focused, error ? styles.invalid : null]}>
        <TextInput
          ref={ref}
          placeholderTextColor={colors.graphite}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          {...(secret ? { autoComplete: 'off' as const, importantForAutofill: 'no' as const, textContentType: 'none' as const } : null)}
          multiline={multiline}
          {...rest}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, mono ? typography.mono : typography.body, { fontFamily: mono ? fonts.mono : fonts.text }, multiline && styles.multiline]}
        />
        {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      </View>
      {error ? (
        <Text variant="caption" color="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="graphite">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: { gap: space.xs },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sheet,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.rule,
    paddingHorizontal: space.m,
  },
  focused: { borderColor: colors.seal, borderWidth: 2, paddingHorizontal: space.m - 1 },
  invalid: { borderColor: colors.alert },
  input: { flex: 1, minHeight: 48, color: colors.ink, paddingVertical: space.m },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  accessory: { marginLeft: space.s },
});
