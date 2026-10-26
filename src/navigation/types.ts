// Every route in the app and its parameters, in one place.
//
// Root stack
//   Onboarding (stack)  Welcome -> CreateOrRestore -> InviteCode -> YourName -> Ready
//   Main (tabs)         Wallet | People | Requests | You
//   Modals              Send, Receive, RequestMoney, AddPerson, ScanQr
//   Pushed cards        Person, RequestDetail, ActivityDetail
//
// Params carry ids and public keys only, never records: screens read
// current data from the wallet and Paykit hooks, so a deep link and a tap
// land on the same, fresh data.
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { AssetId } from '../wallet/assets';

export type OnboardingStackParamList = {
  Welcome: undefined;
  CreateOrRestore: undefined;
  InviteCode: undefined;
  YourName: undefined;
  Ready: undefined;
};

export type MainTabParamList = {
  Wallet: undefined;
  People: undefined;
  Requests: undefined;
  You: undefined;
};

export type RootStackParamList = {
  Onboarding: NavigatorScreenParams<OnboardingStackParamList> | undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  /** `to` is a pubky (pay a person) or an address. */
  Send: { to?: string; asset?: AssetId } | undefined;
  Receive: { asset?: AssetId } | undefined;
  /** Ask a contact for money. */
  RequestMoney: { pubky?: string } | undefined;
  /** Opened by the People tab, a scanned QR or paykitwdk://contact?pubky=<key>. */
  AddPerson: { pubky?: string } | undefined;
  ScanQr: undefined;
  Person: { pubky: string };
  RequestDetail: { counterparty: string; requestId: string };
  ActivityDetail: { activityId: string };
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;

export type OnboardingScreenProps<T extends keyof OnboardingStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<OnboardingStackParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

// Lets useNavigation() know the route names without a type argument.
declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
