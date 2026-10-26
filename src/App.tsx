import { StatusBar } from 'expo-status-bar';
import { WdkAppProvider } from '@tetherto/wdk-react-native-core';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import wdkBundle from '../.wdk-bundle/wdk-worklet.bundle.js';
import { wdkConfigs } from './config/wdk';
import { SpikeScreen } from './spike/SpikeScreen';

export default function App() {
  return (
    <WdkAppProvider bundle={{ bundle: wdkBundle }} wdkConfigs={wdkConfigs}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <SpikeScreen />
      </SafeAreaProvider>
    </WdkAppProvider>
  );
}
