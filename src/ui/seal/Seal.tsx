// The seal: every person's mark, generated from their Pubky key, with a ring
// that shows the state of your private link with them (docs/DESIGN.md).
//
//   pattern  4×4 quarter-circle tiles from the key bytes (./sealPattern.ts)
//   photo    optional profile picture inside the ring
//   ring     none | linking (dashed, slow rotation) | linked (solid + envelope)
//            | unreachable (Graphite dashed)
//
// The moment a ring changes from linking to linked is the app's one
// orchestrated animation: the dashes join into a solid ring over 400 ms,
// then a light haptic. Rotation is skipped when reduce motion is on; the
// closing then happens instantly, still with the haptic.
import * as Haptics from 'expo-haptics';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Image as SvgImage, Path, Rect } from 'react-native-svg';

import { useReduceMotion } from '../motion';
import { colors } from '../theme';
import { SEAL_GRID, sealPattern, type SealTile } from './sealPattern';
import type { SealRing } from './types';

export type SealProps = {
  pubky: string;
  size?: number;
  ring?: SealRing;
  /** A data: URI or https URL of the person's photo. */
  imageUri?: string;
  /**
   * The ring to start from on mount. Pass 'linking' to play the closing
   * animation when the seal first renders already 'linked' (a link that
   * completed while the person was being added).
   */
  initialRing?: SealRing;
  testID?: string;
};

const CLOSE_MS = 400;
const ROTATION_MS = 16_000;
const DASHES = 16;

function tilePath(tile: SealTile, x: number, y: number, t: number): string {
  switch (tile.corner) {
    case 0: // top-left
      return `M${x} ${y}L${x + t} ${y}A${t} ${t} 0 0 1 ${x} ${y + t}Z`;
    case 1: // top-right
      return `M${x + t} ${y}L${x + t} ${y + t}A${t} ${t} 0 0 1 ${x} ${y}Z`;
    case 2: // bottom-right
      return `M${x + t} ${y + t}L${x} ${y + t}A${t} ${t} 0 0 1 ${x + t} ${y}Z`;
    default: // bottom-left
      return `M${x} ${y + t}L${x} ${y}A${t} ${t} 0 0 1 ${x + t} ${y + t}Z`;
  }
}

/** The static part: tile pattern and optional photo. Memoized: it only depends on key, size and photo. */
const SealFace = memo(function SealFace({ pubky, size, imageUri, clipId }: { pubky: string; size: number; imageUri?: string; clipId: string }) {
  const geometry = sealGeometry(size);
  const tiles = useMemo(() => sealPattern(pubky), [pubky]);
  const { c, innerRadius } = geometry;
  const t = (innerRadius * 2) / SEAL_GRID;
  const origin = c - innerRadius;
  const photoRadius = innerRadius * 0.72;
  return (
    <Svg width={size} height={size}>
      <Defs>
        <ClipPath id={`${clipId}-face`}>
          <Circle cx={c} cy={c} r={innerRadius} />
        </ClipPath>
        <ClipPath id={`${clipId}-photo`}>
          <Circle cx={c} cy={c} r={photoRadius} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${clipId}-face)`}>
        <Rect x={origin} y={origin} width={innerRadius * 2} height={innerRadius * 2} fill={colors.sheet} />
        {tiles.map((tile, i) => (
          <Path
            key={i}
            d={tilePath(tile, origin + (i % SEAL_GRID) * t, origin + Math.floor(i / SEAL_GRID) * t, t)}
            fill={tile.tone === 'deep' ? colors.seal : colors.sealTint}
          />
        ))}
      </G>
      {imageUri ? (
        <>
          <Circle cx={c} cy={c} r={photoRadius + Math.max(1.5, size * 0.02)} fill={colors.sheet} />
          <SvgImage
            href={{ uri: imageUri }}
            x={c - photoRadius}
            y={c - photoRadius}
            width={photoRadius * 2}
            height={photoRadius * 2}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipId}-photo)`}
          />
        </>
      ) : null}
    </Svg>
  );
});

function sealGeometry(size: number) {
  const c = size / 2;
  const ringWidth = Math.max(2, size * 0.04);
  const ringRadius = c - ringWidth / 2;
  const innerRadius = c - ringWidth - size * 0.06;
  const segment = (2 * Math.PI * ringRadius) / DASHES;
  return { c, ringWidth, ringRadius, innerRadius, segment };
}

/** Envelope badge for a linked seal: a closed envelope on a Seal disc, bottom right. */
function EnvelopeBadge({ size }: { size: number }) {
  const { c, ringRadius } = sealGeometry(size);
  const r = Math.max(7, size * 0.15);
  const cx = c + ringRadius * Math.SQRT1_2;
  const cy = c + ringRadius * Math.SQRT1_2;
  const w = r * 1.1;
  const h = r * 0.78;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const stroke = Math.max(1.2, r * 0.14);
  return (
    <>
      <Circle cx={cx} cy={cy} r={r} fill={colors.seal} stroke={colors.sheet} strokeWidth={Math.max(1.5, size * 0.025)} />
      <Rect x={x} y={y} width={w} height={h} rx={stroke} fill="none" stroke={colors.sheet} strokeWidth={stroke} />
      <Path d={`M${x} ${y}L${cx} ${cy + h * 0.1}L${x + w} ${y}`} fill="none" stroke={colors.sheet} strokeWidth={stroke} strokeLinejoin="round" />
    </>
  );
}

let nextClipId = 0;

export function Seal({ pubky, size = 48, ring = 'none', imageUri, initialRing, testID }: SealProps) {
  const [clipId] = useState(() => `seal${nextClipId++}`);
  const reduceMotion = useReduceMotion();
  const geometry = sealGeometry(size);

  // Closing animation: 0 = dashed, 1 = solid. Driven by JS frames (400 ms).
  const [closing, setClosing] = useState<number | null>(() => (initialRing === 'linking' && ring === 'linked' ? 0 : null));
  const previousRing = useRef(initialRing ?? ring);
  useEffect(() => {
    const from = previousRing.current;
    previousRing.current = ring;
    if (!(from === 'linking' && ring === 'linked')) return;
    const done = () => {
      setClosing(null);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    };
    if (reduceMotion) {
      done();
      return;
    }
    const started = Date.now();
    let frame = 0;
    const step = () => {
      const progress = Math.min(1, (Date.now() - started) / CLOSE_MS);
      setClosing(Easing.out(Easing.cubic)(progress));
      if (progress < 1) frame = requestAnimationFrame(step);
      else done();
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ring, reduceMotion]);

  // Slow rotation while linking (native driver: no JS work per frame).
  const rotation = useRef(new Animated.Value(0)).current;
  const rotating = ring === 'linking' && !reduceMotion;
  useEffect(() => {
    if (!rotating) {
      rotation.stopAnimation();
      return;
    }
    rotation.setValue(0);
    const loop = Animated.loop(
      Animated.timing(rotation, { toValue: 1, duration: ROTATION_MS, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [rotating, rotation]);
  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const { c, ringWidth, ringRadius, segment } = geometry;
  const dashed = (progress: number) => `${segment * (0.6 + 0.4 * progress)} ${segment * 0.4 * (1 - progress)}`;

  let ringElement = null;
  if (closing !== null) {
    ringElement = (
      <Circle cx={c} cy={c} r={ringRadius} fill="none" stroke={colors.seal} strokeWidth={ringWidth} strokeDasharray={dashed(closing)} />
    );
  } else if (ring === 'linking' || ring === 'unreachable') {
    ringElement = (
      <Circle
        cx={c}
        cy={c}
        r={ringRadius}
        fill="none"
        stroke={ring === 'linking' ? colors.seal : colors.graphite}
        strokeWidth={ringWidth}
        strokeDasharray={dashed(0)}
        strokeLinecap="round"
      />
    );
  } else if (ring === 'linked') {
    ringElement = <Circle cx={c} cy={c} r={ringRadius} fill="none" stroke={colors.seal} strokeWidth={ringWidth} />;
  }

  return (
    <View style={{ width: size, height: size }} testID={testID} accessibilityRole="image" accessibilityLabel={ringLabel(ring)}>
      <SealFace pubky={pubky} size={size} imageUri={imageUri} clipId={clipId} />
      {ringElement ? (
        <Animated.View style={[StyleSheet.absoluteFill, rotating && closing === null ? { transform: [{ rotate: spin }] } : null]}>
          <Svg width={size} height={size}>
            {ringElement}
          </Svg>
        </Animated.View>
      ) : null}
      {ring === 'linked' && closing === null ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={size} height={size} style={styles.overflow}>
            <EnvelopeBadge size={size} />
          </Svg>
        </View>
      ) : null}
    </View>
  );
}

function ringLabel(ring: SealRing): string {
  switch (ring) {
    case 'linking':
      return 'Seal, connecting privately';
    case 'linked':
      return 'Seal, private connection ready';
    case 'unreachable':
      return 'Seal, cannot reach them right now';
    default:
      return 'Seal';
  }
}

const styles = StyleSheet.create({
  overflow: { overflow: 'visible' },
});
