// Hold a secret (the recovery phrase) in state only while the app is in
// front. When the app leaves the foreground ('inactive' or 'background')
// the value is dropped, so it does not linger in memory and is usually gone
// before the OS takes its app-switcher snapshot.
//
// AppState changes reach JS asynchronously, so dropping the value alone
// can lose the race with the app-switcher snapshot. While a value is held,
// screenshots, recordings and the switcher snapshot are also blocked
// natively (./useScreenCaptureBlock.ts: FLAG_SECURE on Android, a secure
// layer and a blur on iOS).
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useScreenCaptureBlock } from './useScreenCaptureBlock';

export function useForegroundSecret<T>(): [T | undefined, (value: T | undefined) => void] {
  const [value, setValue] = useState<T>();
  useScreenCaptureBlock(value !== undefined);
  useEffect(() => {
    if (value === undefined) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') setValue(undefined);
    });
    return () => subscription.remove();
  }, [value]);
  return [value, setValue];
}
