// Onboarding: create or restore the wallet, connect the Pubky identity,
// publish a profile. Each screen lives in src/features/onboarding.
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CreateOrRestoreScreen } from '../features/onboarding/CreateOrRestoreScreen';
import { InviteCodeScreen } from '../features/onboarding/InviteCodeScreen';
import { ReadyScreen } from '../features/onboarding/ReadyScreen';
import { WelcomeScreen } from '../features/onboarding/WelcomeScreen';
import { YourNameScreen } from '../features/onboarding/YourNameScreen';
import { BackupPhraseScreen } from '../features/onboarding/BackupPhraseScreen';
import { colors } from '../ui';
import type { OnboardingStackParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="CreateOrRestore" component={CreateOrRestoreScreen} />
      <Stack.Screen name="InviteCode" component={InviteCodeScreen} />
      <Stack.Screen name="YourName" component={YourNameScreen} />
      <Stack.Screen name="Ready" component={ReadyScreen} options={{ gestureEnabled: false }} />
      <Stack.Screen name="BackupPhrase" component={BackupPhraseScreen} />
    </Stack.Navigator>
  );
}
