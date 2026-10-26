// Hold a secret (the recovery phrase) in state only while the app is in
// front. When the app leaves the foreground ('inactive' or 'background')
// the value is dropped, so it does not linger in memory and is usually gone
// before the OS takes its app-switcher snapshot.
//
// Best effort, not a guarantee: AppState changes reach JS asynchronously,
// so on Android the recents thumbnail can be taken before React re-renders,
// and nothing here blocks screenshots or screen recording while the words
// are shown. A production wallet would also set FLAG_SECURE on Android
// (e.g. expo-screen-capture's preventScreenCaptureAsync) while the phrase
// is visible; this reference app has not added that native module yet.
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
