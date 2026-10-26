// App root: providers from the outside in.
//
//   SafeAreaProvider
//   WdkAppProvider      starts the WDK Bare worklet (wallet keys + chains)
//   PaykitProvider      the Paykit SDK handle, call queue and sync loop
//   NavigationContainer deep links + theme
//   RootNavigator       the gate: onboarding or tabs
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { WdkAppProvider } from '@tetherto/wdk-react-native-core';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import wdkBundle from '../.wdk-bundle/wdk-worklet.bundle.js';
import { useOnboardingComplete } from './settings/appSettings';
import { wdkConfigs } from './config/wdk';
import { linking } from './navigation/linking';
import { RootNavigator } from './navigation/RootNavigator';
import { PaykitProvider } from './paykit';
import { colors, useAppFonts } from './ui';

const navigationTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.paper, card: colors.paper, text: colors.ink, primary: colors.seal, border: colors.rule },
};

function AppContent() {
  const [onboarded] = useOnboardingComplete();
  return (
    <PaykitProvider autoConnect={onboarded}>
      <NavigationContainer linking={linking} theme={navigationTheme}>
        <RootNavigator />
      </NavigationContainer>
    </PaykitProvider>
  );
}

export default function App() {
  const fontsReady = useAppFonts();
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <WdkAppProvider bundle={{ bundle: wdkBundle }} wdkConfigs={wdkConfigs}>
        {fontsReady ? (
          <AppContent />
        ) : (
          <View style={styles.splash}>
            <ActivityIndicator color={colors.seal} />
          </View>
        )}
      </WdkAppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
});
