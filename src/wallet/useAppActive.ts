// True while the app is in the foreground.
//
// Balance and history polling stop in the background: the OS suspends
// network access anyway, and WDK logs every failed fetch as an error.
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setActive(next === 'active'));
    return () => subscription.remove();
  }, []);
  return active;
}
