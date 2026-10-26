// Design tokens from docs/DESIGN.md. Every color, size and radius in the app
// comes from here; screens should not invent new ones.
//
// The palette is airmail paper and navy ink with one accent (Seal). Asset
// colors are information, not decoration: use them only next to that asset.
import type { AssetId } from '../wallet/assets';

export const colors = {
  /** App background: cool, slightly blue off-white. */
  paper: '#EEF1F4',
  /** Raised surfaces: sheets, inputs, the receive card. */
  sheet: '#FFFFFF',
  /** Primary text and primary buttons. */
  ink: '#18233A',
  /** Secondary text, hints, inactive icons. */
  graphite: '#5D6778',
  /** Dividers and input outlines. */
  rule: '#D5DBE3',
  /** Identity and Paykit: seals, link states, "private" markers, focus rings. */
  seal: '#3D3BBF',
  /** A light tint of Seal for the seal's second tile tone. */
  sealTint: '#C9C8F0',
  /** USD₮ only. */
  tether: '#1F9D7A',
  /** Bitcoin only. */
  amber: '#C98404',
  /** Errors and destructive actions only. */
  alert: '#B42318',
} as const;

/** The dot and amount color of each asset. ETH is gas, shown in Graphite. */
export const assetColors: Record<AssetId, string> = {
  btc: colors.amber,
  usdt: colors.tether,
  eth: colors.graphite,
};

/** 4 pt grid. */
export const space = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Screen side margin. Content is left aligned. */
export const SCREEN_MARGIN = 20;

/** Radius follows hierarchy: sheets 20, buttons 14, inputs 12, chips fully round. */
export const radii = {
  sheet: 20,
  button: 14,
  input: 12,
  chip: 999,
} as const;

/** The only shadow: sheets and modals. Rows never get one. */
export const sheetShadow = {
  shadowColor: colors.ink,
  shadowOpacity: 0.08,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 8 },
  elevation: 6,
} as const;

/** Font family names registered in ./fonts.ts. */
export const fonts = {
  display: 'BricolageGrotesque_600SemiBold',
  text: 'AtkinsonHyperlegibleNext_400Regular',
  textBold: 'AtkinsonHyperlegibleNext_700Bold',
  mono: 'AtkinsonHyperlegibleMono_400Regular',
} as const;

/** Type scale (pt): 44 / 30 / 22 / 17 / 15 / 13. Body is 17 with 1.4 line height. */
export const typography = {
  /** The amount on a money screen. */
  amount: { fontFamily: fonts.display, fontSize: 44, lineHeight: 50, letterSpacing: -1.2 },
  /** Screen titles and a contact's name on their page. */
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  /** Section headings and row amounts. */
  heading: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  body: { fontFamily: fonts.text, fontSize: 17, lineHeight: 24 },
  bodyStrong: { fontFamily: fonts.textBold, fontSize: 17, lineHeight: 24 },
  secondary: { fontFamily: fonts.text, fontSize: 15, lineHeight: 21 },
  caption: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18 },
  /** Keys, addresses and hashes only: strings compared character by character. */
  mono: { fontFamily: fonts.mono, fontSize: 15, lineHeight: 21 },
  monoSmall: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18 },
} as const;

export type TypeVariant = keyof typeof typography;
