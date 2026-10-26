// Deep links. `paykitwdk://contact?pubky=<key>` opens Add person with the
// key filled in (the query parameter becomes the `pubky` route param). The
// format mirrors Bitkit's `bitkit://contact?pubky=<key>`.
//
// Drive the simulators with it:
//   xcrun simctl openurl booted "paykitwdk://contact?pubky=<key>"
//   adb shell am start -a android.intent.action.VIEW -d "paykitwdk://contact?pubky=<key>"
//
// Links only resolve after onboarding: before that, the routes do not exist.
//
// Wallet links (handy for demo scripts and simulators, which cannot scan):
//   paykitwdk://receive?asset=usdt          Receive, with an asset chosen
//   paykitwdk://send?to=<address>&asset=btc  Send, with the recipient filled in
//   paykitwdk://receive?code=pubky           Receive, showing your pay-me code
//   paykitwdk://profile                      Edit your name and photo
//   paykitwdk://scan                         Scan a code (paste or a photo on simulators)
//   paykitwdk://request-money?pubky=<key>    Request money, with the contact chosen
//   paykitwdk://request?counterparty=<key>&requestId=<id>   one payment request
//   paykitwdk://person?pubky=<key>           a contact's Person page
//   paykitwdk://automatic-payments?pubky=<key>  offer a contact automatic payments
// A send link only fills in the form: nothing moves until the person
// reviews the fee and taps Send.
import type { LinkingOptions } from '@react-navigation/native';

import type { RootStackParamList } from './types';

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['paykitwdk://'],
  config: {
    screens: {
      AddPerson: 'contact',
      Send: 'send',
      Receive: 'receive',
      EditProfile: 'profile',
      ScanQr: 'scan',
      RequestMoney: 'request-money',
      RequestDetail: 'request',
      Person: 'person',
      AutomaticPayments: 'automatic-payments',
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
