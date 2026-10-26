// Hold a secret (the recovery phrase) in state only while the app is in
// front. When the app goes to the background the value is dropped, so the
// OS app-switcher snapshot cannot show it and it does not linger in memory.
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useForegroundSecret<T>(): [T | undefined, (value: T | undefined) => void] {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    if (value === undefined) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') setValue(undefined);
    });
    return () => subscription.remove();
  }, [value]);
  return [value, setValue];
}
