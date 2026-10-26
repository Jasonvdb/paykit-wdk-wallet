// Scan a code (modal): a pay-me code (pubky), a payment link, or a
// Bitcoin / Ethereum test address. It goes to Add person or Send; see
// ./scan/parseScannedCode.ts for what is accepted and why.
//
// Three ways in, because simulators have no camera (the iOS simulator
// shows a black preview):
//   1. the camera (expo-camera, QR only), after asking for permission;
//   2. a photo of a code from the library (expo-camera's scanFromURLAsync),
//      e.g. a screenshot of the other phone's pay-me code;
//   3. paste.
//
// Everything scanned is untrusted. The parser checks shapes, and a pubky
// is validated by the SDK (normalizeKey) before Add person opens. Nothing
// is paid from here: Send opens with the recipient filled in, and the
// person still chooses the amount and reviews the fee.
import * as Clipboard from 'expo-clipboard';
import { CameraView, scanFromURLAsync, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import type { RootScreenProps } from '../../navigation/types';
import { describeError, usePaykit } from '../../paykit';
import { Button, Input, SheetScreen, Text, colors, radii, space } from '../../ui';
import { parseScannedCode } from './scan/parseScannedCode';

export function ScanQrScreen({ navigation }: RootScreenProps<'ScanQr'>) {
  const { service, log } = usePaykit();
  const [permission, requestPermission] = useCameraPermissions();
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState<string>();
  /** The camera reports the same code many times a second; act on the first only. */
  const handled = useRef(false);

  const handle = (text: string): boolean => {
    const code = parseScannedCode(text);
    if (code.kind === 'unsupported') {
      setError(code.message);
      return false;
    }
    if (code.kind === 'pay') {
      navigation.replace('Send', { to: code.to, asset: code.asset });
      return true;
    }
    if (!service) {
      setError('Still connecting to your identity. Try again in a moment.');
      return false;
    }
    let pubky: string;
    try {
      pubky = service.normalizeKey(code.pubky);
    } catch (e) {
      log.warn(`scan: ${describeError(e)}`);
      setError("That pubky isn't valid. Ask for their pay-me code again.");
      return false;
    }
    if (pubky === service.publicKey) {
      setError("That's your own pay-me code. Scan the other person's code.");
      return false;
    }
    navigation.replace('AddPerson', { pubky });
    return true;
  };

  const onScanned = ({ data }: BarcodeScanningResult) => {
    if (handled.current) return;
    handled.current = true;
    if (!handle(data)) {
      // Let the person point at another code after reading the message.
      setTimeout(() => (handled.current = false), 1500);
    }
  };

  const onPaste = async () => {
    const text = await Clipboard.getStringAsync();
    setPasted(text.trim());
    setError(undefined);
  };

  const onPhoto = async () => {
    setError(undefined);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    const uri = picked.canceled ? undefined : picked.assets[0]?.uri;
    if (!uri) return;
    try {
      const [first] = await scanFromURLAsync(uri, ['qr']);
      if (first) handle(first.data);
      else setError('No code found in that photo. Try a sharper one, or paste the code.');
    } catch (e) {
      log.warn(`scan photo: ${describeError(e)}`);
      setError("Couldn't read that photo. Try another one, or paste the code.");
    }
  };

  return (
    <SheetScreen title="Scan a code" onClose={() => navigation.goBack()} testID="scan-screen">
      <View style={styles.body}>
        <CameraArea permission={permission} onRequest={requestPermission} onScanned={onScanned} />

        {error ? (
          <Text color="alert" testID="scan-error">
            {error}
          </Text>
        ) : null}

        <Button label="Choose a photo of a code" variant="secondary" onPress={onPhoto} testID="scan-photo" />

        <Input
          label="Or paste a code"
          value={pasted}
          onChangeText={(text) => {
            setPasted(text);
            setError(undefined);
          }}
          placeholder="pubky…, tb1… or 0x…"
          mono
          multiline
          blurOnSubmit
          returnKeyType="done"
          accessory={
            <Pressable accessibilityRole="button" accessibilityLabel="Paste" onPress={onPaste} hitSlop={8} testID="scan-paste">
              <Text variant="bodyStrong" color="seal">
                Paste
              </Text>
            </Pressable>
          }
          testID="scan-text"
        />
        <Button label="Continue" onPress={() => handle(pasted)} disabled={!pasted.trim()} testID="scan-continue" />
      </View>
    </SheetScreen>
  );
}

type CameraAreaProps = {
  permission: ReturnType<typeof useCameraPermissions>[0];
  onRequest: () => Promise<unknown>;
  onScanned: (result: BarcodeScanningResult) => void;
};

/** The camera preview, or the permission step in plain words. */
function CameraArea({ permission, onRequest, onScanned }: CameraAreaProps) {
  if (!permission) return <View style={styles.camera} />;

  if (!permission.granted) {
    const blocked = !permission.canAskAgain;
    return (
      <View style={[styles.camera, styles.permission]} testID="scan-permission">
        <Text variant="bodyStrong" color="sheet">
          {blocked ? 'Camera access is off' : 'Scan with your camera'}
        </Text>
        <Text color="sheet" style={styles.center}>
          {blocked
            ? 'Turn on camera access for this app in Settings, or paste the code below.'
            : 'The camera is used only to read codes on this screen. Nothing is recorded.'}
        </Text>
        <Button
          label={blocked ? 'Open Settings' : 'Allow camera'}
          variant="secondary"
          compact
          onPress={() => void (blocked ? Linking.openSettings() : onRequest())}
          style={styles.permissionButton}
          testID="scan-allow-camera"
        />
      </View>
    );
  }

  return (
    <View style={styles.camera} testID="scan-camera">
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScanned} />
      <View style={styles.frame} pointerEvents="none" />
      <Text variant="caption" color="sheet" style={styles.cameraHint}>
        Point at a pay-me code or an address.
      </Text>
    </View>
  );
}

const CAMERA_HEIGHT = 300;

const styles = StyleSheet.create({
  body: { gap: space.l },
  camera: {
    height: CAMERA_HEIGHT,
    borderRadius: radii.sheet,
    overflow: 'hidden',
    backgroundColor: colors.ink,
    justifyContent: 'flex-end',
  },
  permission: { justifyContent: 'center', alignItems: 'center', gap: space.m, padding: space.xl },
  permissionButton: { alignSelf: 'center' },
  center: { textAlign: 'center' },
  frame: {
    position: 'absolute',
    top: (CAMERA_HEIGHT - 200) / 2,
    alignSelf: 'center',
    width: 200,
    height: 200,
    borderRadius: radii.input,
    borderWidth: 2,
    borderColor: colors.sheet,
  },
  cameraHint: { textAlign: 'center', padding: space.m },
});
