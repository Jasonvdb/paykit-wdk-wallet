// The root of navigation and the app's gate:
//
//   WDK starting           -> a quiet splash
//   wallet locked          -> unlock automatically once at launch (no PIN in this demo)
//   worklet error          -> "restart the app" (WDK cannot recover in-process)
//   onboarding incomplete  -> Onboarding stack
//   otherwise              -> Tabs, plus modal and pushed routes
//
// Screens are registered conditionally (React Navigation's auth-flow
// pattern), so finishing onboarding switches to the tabs by itself and the
// back gesture can never return to onboarding.
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useOnboardingComplete } from '../settings/appSettings';
import { PersonScreen } from '../features/people/PersonScreen';
import { AddPersonScreen } from '../features/people/AddPersonScreen';
import { ScanQrScreen } from '../features/people/ScanQrScreen';
import { RequestDetailScreen } from '../features/requests/RequestDetailScreen';
import { RequestMoneyScreen } from '../features/requests/RequestMoneyScreen';
import { PayRequestScreen } from '../features/requests/PayRequestScreen';
import { ActivityDetailScreen } from '../features/wallet/ActivityDetailScreen';
import { ReceiveScreen } from '../features/wallet/ReceiveScreen';
import { SendScreen } from '../features/wallet/SendScreen';
import { EditProfileScreen } from '../features/you/EditProfileScreen';
import { colors, Screen, Text } from '../ui';
import { useWalletLifecycle } from '../wallet';
import { MainTabs } from './MainTabs';
import { OnboardingNavigator } from './OnboardingNavigator';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const wallet = useWalletLifecycle();
  const [onboarded] = useOnboardingComplete();
  const { status, unlock } = wallet;

  // Unlock once at launch. Later locks are deliberate (restoring a phrase
  // during onboarding locks and replaces the wallet) and must not race.
  // WDK reports 'no-wallet' when its wallet list is empty, even if the seed
  // is still in the Keychain/Keystore; check the seed before onboarding.
  const launchUnlockDone = useRef(false);
  const [checkingStoredWallet, setCheckingStoredWallet] = useState(true);
  const { hasStoredWallet } = wallet;
  useEffect(() => {
    if (launchUnlockDone.current || (status !== 'locked' && status !== 'no-wallet')) return;
    launchUnlockDone.current = true;
    void (async () => {
      try {
        if (status === 'locked' || (await hasStoredWallet())) await unlock();
      } catch {
        // Shown as the wallet error state.
      } finally {
        setCheckingStoredWallet(false);
      }
    })();
  }, [status, unlock, hasStoredWallet]);

  // Show the splash only until the navigator first appears; afterwards keep
  // it mounted through transient states so onboarding keeps its place.
  const navigatorShown = useRef(false);

  if (status === 'error') {
    return (
      <Screen title="Something went wrong">
        <Text color="graphite">
          The wallet engine stopped ({wallet.error ?? 'unknown error'}). Close the app completely and open it again.
        </Text>
      </Screen>
    );
  }
  const waiting = status === 'starting' || status === 'locked' || (status === 'no-wallet' && checkingStoredWallet);
  if (waiting && !navigatorShown.current) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.seal} />
      </View>
    );
  }

  navigatorShown.current = true;
  const showMain = onboarded && status === 'ready';
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
      {showMain ? (
        <>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="Person" component={PersonScreen} />
          <Stack.Screen name="RequestDetail" component={RequestDetailScreen} />
          <Stack.Screen name="ActivityDetail" component={ActivityDetailScreen} />
          <Stack.Group screenOptions={{ presentation: 'modal' }}>
            <Stack.Screen name="Send" component={SendScreen} />
            <Stack.Screen name="Receive" component={ReceiveScreen} />
            <Stack.Screen name="RequestMoney" component={RequestMoneyScreen} />
            <Stack.Screen name="AddPerson" component={AddPersonScreen} />
            <Stack.Screen name="ScanQr" component={ScanQrScreen} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen} />
            <Stack.Screen name="PayRequest" component={PayRequestScreen} />
          </Stack.Group>
        </>
      ) : (
        <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
});
