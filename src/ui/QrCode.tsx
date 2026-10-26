// A QR code in Ink on Sheet, for addresses and the "pay-me code" (a pubky).
// Simulators cannot scan each other's screens; copy/paste and deep links
// are the working paths there, the QR is for real devices.
import QRCode from 'react-native-qrcode-svg';

import { colors } from './theme';

export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  return <QRCode value={value} size={size} color={colors.ink} backgroundColor={colors.sheet} ecl="M" quietZone={8} />;
}
