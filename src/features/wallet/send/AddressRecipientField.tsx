// "To" as a wallet address: typed or pasted, checked against the chain of
// the asset being sent (src/wallet/addressFormat.ts checkRecipientAddress).
// Mainnet addresses, the other chain's addresses and Pubky keys are refused
// with a message that says what to do instead.
//
// The error shows once the person is done with the field (blur or paste),
// not on every keystroke of a half-typed address.
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useState } from 'react';
import { Pressable } from 'react-native';

import { Input, Text } from '../../../ui';
import { ASSETS, checkRecipientAddress } from '../../../wallet';
import { addressRecipient, type RecipientFieldProps } from './recipient';

export function AddressRecipientField({ asset, initialText, onChange }: RecipientFieldProps) {
  const [text, setText] = useState(initialText ?? '');
  const [touched, setTouched] = useState(!!initialText);
  const chain = ASSETS[asset].chain;
  const check = useMemo(() => checkRecipientAddress(text, chain), [text, chain]);

  useEffect(() => {
    onChange(check.ok ? addressRecipient(check.address, asset) : undefined);
  }, [check, asset, onChange]);

  const onPaste = async () => {
    const pasted = await Clipboard.getStringAsync();
    if (!pasted) return;
    setText(pasted.trim());
    setTouched(true);
  };

  return (
    <Input
      label="To"
      value={text}
      onChangeText={setText}
      onBlur={() => setTouched(true)}
      placeholder={chain === 'bitcoin' ? 'tb1…' : '0x…'}
      mono
      multiline
      blurOnSubmit
      returnKeyType="done"
      error={touched && !check.ok && check.reason !== 'empty' ? check.message : undefined}
      hint={chain === 'ethereum' ? 'Any Ethereum address. The tokens move on Sepolia.' : 'A Mutinynet address (tb1…).'}
      accessory={
        <Pressable accessibilityRole="button" accessibilityLabel="Paste" onPress={onPaste} hitSlop={8} testID="paste-address">
          <Text variant="bodyStrong" color="seal">
            Paste
          </Text>
        </Pressable>
      }
      testID="send-to"
    />
  );
}
