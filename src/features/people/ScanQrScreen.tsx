// Scan QR (modal): scan a pay-me code (a pubky or a paykitwdk://contact
// link) and continue to Add person.
//
// The iOS simulator has no camera; paste and deep links are the working
// paths there.
//
// TODO(Phase 4 — Contacts): expo-camera CameraView with barcode scanning
// (QR only), camera permission flow (the usage string is in app.json),
// then navigation.replace('AddPerson', { pubky }).
import type { RootScreenProps } from '../../navigation/types';
import { SheetScreen, Text } from '../../ui';

export function ScanQrScreen({ navigation }: RootScreenProps<'ScanQr'>) {
  return (
    <SheetScreen title="Scan a code" onClose={() => navigation.goBack()}>
      <Text color="graphite">Coming in Phase 4.</Text>
    </SheetScreen>
  );
}
