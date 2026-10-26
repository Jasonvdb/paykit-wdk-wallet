// Deep links. `paykitwdk://contact?pubky=<key>` opens Add person with the
// key filled in (the query parameter becomes the `pubky` route param). The
// format mirrors Bitkit's `bitkit://contact?pubky=<key>`.
//
// Drive the simulators with it:
//   xcrun simctl openurl booted "paykitwdk://contact?pubky=<key>"
//   adb shell am start -a android.intent.action.VIEW -d "paykitwdk://contact?pubky=<key>"
//
// Links only resolve after onboarding: before that, the routes do not exist.
import type { LinkingOptions } from '@react-navigation/native';

import type { RootStackParamList } from './types';

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['paykitwdk://'],
  config: {
    screens: {
      AddPerson: 'contact',
      Main: {
        screens: {
          Wallet: 'wallet',
          People: 'people',
          Requests: 'requests',
          You: 'you',
        },
      },
    },
  },
};
