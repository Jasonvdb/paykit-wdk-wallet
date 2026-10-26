// Keep a secret out of screenshots, screen recordings and the app switcher
// while it is on screen (the recovery phrase, a phrase being typed in, a
// backup about to be copied).
//
// expo-screen-capture does the native part:
// - Android: FLAG_SECURE on the window. Screenshots and recordings come out
//   black, and the recents thumbnail is blank. That is the only reliable
//   way on Android: the AppState change that drops the secret in
//   ./useForegroundSecret.ts reaches JS after the thumbnail may be taken.
// - iOS: screenshots and recordings of the app come out blank (the view is
//   moved into a secure text field's layer), and while the app is inactive
//   (app switcher, Control Center, a call) a blur covers it, so the
//   switcher snapshot shows no words. iOS still tells the person a
//   screenshot was taken; it can't be refused.
//
// Each caller gets its own key, so two protected things on screen at once
// (onboarding can show the old phrase while a new one is typed) don't
// switch each other's protection off. The app-switcher blur on iOS is one
// global switch, so it is counted here.
//
// Protection is switched off only once the app is in front again. The
// secret itself is dropped as soon as the app leaves the foreground, and
// that removes the protection's reason too; switching it off right then
// would race the snapshot the OS is about to take.
import * as ScreenCapture from 'expo-screen-capture';
import { useEffect, useId } from 'react';
import { AppState, Platform } from 'react-native';

let switcherProtectionUsers = 0;

function ignore(): void {
  // Best effort: a device without the native module (a test runner) still works.
}

/** Run `task` now if the app is in front, else the next time it comes to the front. */
function whenActive(task: () => void): void {
  if (AppState.currentState === 'active') {
    task();
    return;
  }
  const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    subscription.remove();
    task();
  });
}

export function useScreenCaptureBlock(active: boolean): void {
  const key = `secret-${useId()}`;
  useEffect(() => {
    if (!active) return;
    ScreenCapture.preventScreenCaptureAsync(key).catch(ignore);
    if (Platform.OS === 'ios' && switcherProtectionUsers++ === 0) {
      ScreenCapture.enableAppSwitcherProtectionAsync(1).catch(ignore);
    }
    return () => {
      const usesSwitcherProtection = Platform.OS === 'ios';
      whenActive(() => {
        ScreenCapture.allowScreenCaptureAsync(key).catch(ignore);
        if (usesSwitcherProtection && --switcherProtectionUsers === 0) {
          ScreenCapture.disableAppSwitcherProtectionAsync().catch(ignore);
        }
      });
    };
  }, [active, key]);
}
