// Converting between bigint base units and decimal text.
//
// Never use JavaScript numbers for money: 2^53 wei is only 0.009 ETH, and
// floats cannot represent 0.1 exactly. WDK returns balances and fees as
// base-unit strings, Paykit uses decimal strings ("0.00001"), and the UI
// shows grouped decimals. Everything in between is bigint.
import { ASSETS, type AssetId } from './assets';

export type FormatOptions = {
  /** Always show at least this many fraction digits (pads with zeros). */
  minFractionDigits?: number;
  /** Cut (round down) after this many fraction digits. */
  maxFractionDigits?: number;
  /** Group the whole part in thousands: 1,234.5. */
  groupThousands?: boolean;
};

/** Format a base-unit amount as a decimal string, e.g. (123456n, 6) -> "0.123456". */
export function formatUnits(value: bigint, decimals: number, options: FormatOptions = {}): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  let fraction = decimals > 0 ? (absolute % base).toString().padStart(decimals, '0') : '';

  const max = Math.min(options.maxFractionDigits ?? decimals, decimals);
  fraction = fraction.slice(0, max).replace(/0+$/, '');
  const min = Math.min(options.minFractionDigits ?? 0, max);
  fraction = fraction.padEnd(min, '0');

  const wholeText = options.groupThousands ? groupThousands(whole.toString()) : whole.toString();
  const text = fraction ? `${wholeText}.${fraction}` : wholeText;
  // "-0" is not a thing: a negative amount that rounds to zero shows as zero.
  return negative && /[1-9]/.test(text) ? `-${text}` : text;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export type ParseResult =
  | { ok: true; value: bigint }
  | { ok: false; reason: 'empty' | 'invalid' | 'too-many-decimals' | 'ambiguous' };

/**
 * Parse decimal text typed by a user (or sent by Paykit) into base units.
 * Accepts "12", "12.5", ".5", "1,234.56" (commas as group separators).
 * Rejects negatives, exponents and more fraction digits than the asset has.
 */
export function parseUnits(text: string, decimals: number): ParseResult {
  const cleaned = text.trim().replace(/,/g, '');
  if (cleaned === '') return { ok: false, reason: 'empty' };
  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match || (match[1] === '' && (match[2] ?? '') === '')) return { ok: false, reason: 'invalid' };
  const wholeDigits = match[1] || '0';
  const fractionDigits = match[2] ?? '';
  if (fractionDigits.length > decimals) return { ok: false, reason: 'too-many-decimals' };
  const value = BigInt(wholeDigits) * 10n ** BigInt(decimals) + BigInt(fractionDigits.padEnd(decimals, '0') || '0');
  return { ok: true, value };
}

/** How many fraction digits each asset shows by default. */
const DISPLAY: Record<AssetId, Required<Pick<FormatOptions, 'minFractionDigits' | 'maxFractionDigits'>>> = {
  btc: { minFractionDigits: 0, maxFractionDigits: 8 },
  usdt: { minFractionDigits: 2, maxFractionDigits: 6 },
  eth: { minFractionDigits: 0, maxFractionDigits: 6 },
};

/** Format an amount for the UI: grouped, with the asset's display precision. */
export function formatAssetAmount(
  value: bigint,
  asset: AssetId,
  options: { withSymbol?: boolean; signed?: boolean } = {},
): string {
  const info = ASSETS[asset];
  let text = formatUnits(value, info.decimals, { ...DISPLAY[asset], groupThousands: true });
  if (options.signed && value > 0n) text = `+${text}`;
  // Use a real minus sign for display, not a hyphen.
  text = text.replace(/^-/, '−');
  return options.withSymbol ? `${text} ${info.symbol}` : text;
}

/** Parse what a user typed in an amount field for `asset`. */
export function parseAssetAmount(text: string, asset: AssetId): ParseResult {
  return parseUnits(text, ASSETS[asset].decimals);
}

/**
 * Parse what a person typed or pasted into an amount field. Decimal keypads
 * in many locales type "," for the decimal point, while pasted amounts may
 * use "," to group thousands. So:
 *
 *   "0,5"  "12,50"           one comma, not followed by exactly 3 digits: decimal comma
 *   "0,500"                  a whole part of 0 is never grouped: decimal comma
 *   "1,000,000" "1,000.50"   several commas, or a point too: grouping
 *   "1,000"                  could be 1 or 1000: refused as 'ambiguous'
 *
 * A thousands separator silently read as a decimal point (or the reverse)
 * changes the amount 1000 times, so the ambiguous case asks instead.
 */
export function parseTypedAmount(text: string, asset: AssetId): ParseResult {
  const trimmed = text.trim();
  const commas = (trimmed.match(/,/g) ?? []).length;
  if (commas === 1 && !trimmed.includes('.')) {
    const [whole = '', fraction = ''] = trimmed.split(',');
    const grouped = /^\d{3}$/.test(fraction) && !/^0*$/.test(whole);
    if (grouped) return { ok: false, reason: 'ambiguous' };
    return parseAssetAmount(`${whole}.${fraction}`, asset);
  }
  return parseAssetAmount(trimmed, asset);
}

/**
 * Paykit amounts are plain decimal strings without grouping, e.g. "0.00001".
 * Use these at the Paykit boundary (payment requests, receipts).
 */
export function toPaykitDecimal(value: bigint, asset: AssetId): string {
  return formatUnits(value, ASSETS[asset].decimals);
}

export function fromPaykitDecimal(text: string, asset: AssetId): ParseResult {
  if (/,/.test(text)) return { ok: false, reason: 'invalid' };
  return parseUnits(text, ASSETS[asset].decimals);
}

/** Parse a base-unit string from WDK ("12345") into bigint; undefined if it is not one. */
export function parseBaseUnits(text: string | null | undefined): bigint | undefined {
  if (text == null || !/^\d+$/.test(text)) return undefined;
  return BigInt(text);
}
