// The four tabs. Each tab screen lives in its feature folder.
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { PeopleScreen } from '../features/people/PeopleScreen';
import { RequestsScreen } from '../features/requests/RequestsScreen';
import { WalletScreen } from '../features/wallet/WalletScreen';
import { YouScreen } from '../features/you/YouScreen';
import { colors, fonts } from '../ui';
import { PeopleIcon, RequestsIcon, WalletIcon, YouIcon } from '../ui/icons';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.graphite,
        tabBarStyle: { backgroundColor: colors.paper, borderTopColor: colors.rule },
        tabBarLabelStyle: { fontFamily: fonts.text, fontSize: 12 },
        sceneStyle: { backgroundColor: colors.paper },
      }}
    >
      <Tab.Screen name="Wallet" component={WalletScreen} options={{ tabBarIcon: ({ color }) => <WalletIcon color={color} /> }} />
      <Tab.Screen name="People" component={PeopleScreen} options={{ tabBarIcon: ({ color }) => <PeopleIcon color={color} /> }} />
      <Tab.Screen name="Requests" component={RequestsScreen} options={{ tabBarIcon: ({ color }) => <RequestsIcon color={color} /> }} />
      <Tab.Screen name="You" component={YouScreen} options={{ tabBarIcon: ({ color }) => <YouIcon color={color} /> }} />
    </Tab.Navigator>
  );
}
