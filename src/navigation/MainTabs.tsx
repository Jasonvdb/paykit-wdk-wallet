// The four tabs. Each tab screen lives in its feature folder.
//
// PaymentChainBridge renders nothing; it sits here so the payment request
// round hooks have WDK whichever tab is open.
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { PeopleScreen } from '../features/people/PeopleScreen';
import { PaymentChainBridge } from '../features/requests/PaymentChainBridge';
import { RequestsScreen } from '../features/requests/RequestsScreen';
import { WalletScreen } from '../features/wallet/WalletScreen';
import { YouScreen } from '../features/you/YouScreen';
import { colors, fonts, typography } from '../ui';
import { PeopleIcon, RequestsIcon, WalletIcon, YouIcon } from '../ui/icons';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  return (
    <>
      <PaymentChainBridge />
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.ink,
          tabBarInactiveTintColor: colors.graphite,
          tabBarStyle: { backgroundColor: colors.paper, borderTopColor: colors.rule },
          tabBarLabelStyle: { fontFamily: fonts.text, fontSize: typography.caption.fontSize },
          sceneStyle: { backgroundColor: colors.paper },
        }}
      >
        <Tab.Screen name="Wallet" component={WalletScreen} options={{ tabBarIcon: ({ color }) => <WalletIcon color={color} /> }} />
        <Tab.Screen name="People" component={PeopleScreen} options={{ tabBarIcon: ({ color }) => <PeopleIcon color={color} /> }} />
        <Tab.Screen name="Requests" component={RequestsScreen} options={{ tabBarIcon: ({ color }) => <RequestsIcon color={color} /> }} />
        <Tab.Screen name="You" component={YouScreen} options={{ tabBarIcon: ({ color }) => <YouIcon color={color} /> }} />
      </Tab.Navigator>
    </>
  );
}
