// The few line icons the tab bar needs, drawn with react-native-svg so the
// app does not pull in an icon font. 24 pt, 1.75 pt strokes.
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type IconProps = { color: string; size?: number };

const stroke = { strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

export function WalletIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={3} y={6} width={18} height={13} rx={3} stroke={color} {...stroke} />
      <Path d="M3 10h18M16 14.5h2" stroke={color} {...stroke} />
    </Svg>
  );
}

export function PeopleIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={9} cy={9} r={3.5} stroke={color} {...stroke} />
      <Path d="M3 19c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5" stroke={color} {...stroke} />
      <Path d="M15.5 5.8a3.5 3.5 0 0 1 0 6.4M17.5 14.8c1.6.6 2.8 2 3.3 4.2" stroke={color} {...stroke} />
    </Svg>
  );
}

export function RequestsIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={3} y={5.5} width={18} height={13} rx={2.5} stroke={color} {...stroke} />
      <Path d="M3.5 7l8.5 6 8.5-6" stroke={color} {...stroke} />
    </Svg>
  );
}

export function YouIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} stroke={color} {...stroke} />
      <Path d="M12 3a9 9 0 0 1 0 18M3 12a9 9 0 0 0 18 0" stroke={color} {...stroke} />
      <Circle cx={12} cy={12} r={3} stroke={color} {...stroke} />
    </Svg>
  );
}
