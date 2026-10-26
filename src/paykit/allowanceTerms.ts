// Allowance terms for "automatic payments": the limits a payer agrees to,
// in this app's terms. Pure: no native imports, unit tested.
//
// What an Allowance is (specs/allowances.md): private, scoped authority
// from an Allower (the payer, who keeps the money) to an Allowee (the
// payee, who sends payment requests). With an accepted Allowance, the
// Allower's wallet may accept and pay the Allowee's qualifying requests
// without a tap each time. Either side may propose; authority exists only
// once the other side accepts. Terms are immutable: to change them, end
// the Allowance and propose a new one.
//
// The limits model (all rules apply together; the SDK does the exact
// decimal and period math and keeps the usage ledger):
//   asset                  exact match with the request's asset
//   per_payment_amount     an inclusive min..max range for each request
//   period_limits          per period: an amount ceiling and/or a count of
//                          payments; a period is rolling ("the last hour")
//                          or anchored ("each calendar hour from 12:00")
//   lifetime_amount_limit  a ceiling over every automatic payment
//   active_from/expires_at when it can be used
//   allowed endpoints      which payment methods it may pay with
// Terms must set at least one money ceiling or an expiry. Manual payments
// never use up an Allowance; requests are not tied to one on the wire (the
// payer's wallet picks it).
//
// This app proposes as the payer (Allower) and picks conservative demo
// defaults: an amount per payment, at most 10 payments and 4 payments'
// worth an hour (rolling), 10 payments' worth in all, our one payment
// method for the asset, and an end date. The checks here are for display
// only ("this request is covered"); the SDK decides every payment.
import { formatAssetAmount, fromPaykitDecimal, toPaykitDecimal } from '../wallet/amounts';
import { parseTime } from './recurrence';
import { ENDPOINT_FOR_ASSET, type RequestAsset, type RequestTermsView } from './requestTerms';

/** Terms as plain strings and numbers (./allowances.ts reads the FFI objects' getters into this). */
export type PlainAllowanceTerms = {
  asset: string;
  perPayment?: { minimum: string; maximum: string };
  periodLimits: { amountLimit?: string; paymentCountLimit?: number; period: { kind: string; every: number; unit: string; anchor?: string } }[];
  lifetimeAmountLimit?: string;
  activeFrom?: string;
  expiresAt?: string;
  allowedEndpointIdentifiers?: string[];
};

export type AllowancePeriodView = {
  /** Base units, when the asset is ours and it parses. */
  amount?: bigint;
  count?: number;
  rolling: boolean;
  /** Period length in ms, for minute/hour/day/week; undefined for months and years. */
  lengthMs?: number;
  every: number;
  unit: string;
  anchorMs?: number;
};

export type AllowanceTermsView = {
  /** Set when the asset is one this wallet holds and every amount parses. */
  asset?: RequestAsset;
  rawAsset: string;
  perPaymentMin?: bigint;
  perPaymentMax?: bigint;
  periods: AllowancePeriodView[];
  lifetime?: bigint;
  activeFromMs?: number;
  expiresAtMs?: number;
  endpoints?: string[];
};

const UNIT_MS: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 };

export function readAllowanceTerms(plain: PlainAllowanceTerms): AllowanceTermsView {
  const known = plain.asset === 'btc' || plain.asset === 'usdt' ? plain.asset : undefined;
  let readable = !!known;
  const amount = (text: string | undefined): bigint | undefined => {
    if (text === undefined || !known) return undefined;
    const parsed = fromPaykitDecimal(text, known);
    if (!parsed.ok) readable = false;
    return parsed.ok ? parsed.value : undefined;
  };
  const view: AllowanceTermsView = {
    rawAsset: plain.asset,
    perPaymentMin: amount(plain.perPayment?.minimum),
    perPaymentMax: amount(plain.perPayment?.maximum),
    periods: plain.periodLimits.map((limit) => ({
      amount: amount(limit.amountLimit),
      count: limit.paymentCountLimit,
      rolling: limit.period.kind === 'rolling',
      lengthMs: UNIT_MS[limit.period.unit] !== undefined ? (UNIT_MS[limit.period.unit] ?? 0) * limit.period.every : undefined,
      every: limit.period.every,
      unit: limit.period.unit,
      anchorMs: parseTime(limit.period.anchor),
    })),
    lifetime: amount(plain.lifetimeAmountLimit),
    activeFromMs: parseTime(plain.activeFrom),
    expiresAtMs: parseTime(plain.expiresAt),
    endpoints: plain.allowedEndpointIdentifiers,
  };
  return readable ? { ...view, asset: known } : view;
}

// Proposing (demo defaults) -------------------------------------------------------------

/** Amount per payment the person can pick, in base units. */
export const PER_PAYMENT_CHOICES: Record<RequestAsset, readonly bigint[]> = {
  btc: [1_000n, 5_000n, 10_000n],
  usdt: [1_000_000n, 5_000_000n, 10_000_000n],
};
export const DEFAULT_PER_PAYMENT: Record<RequestAsset, bigint> = { btc: 5_000n, usdt: 5_000_000n };

export const DURATION_CHOICES = [
  { id: 'hour', label: '1 hour', ms: 3_600_000 },
  { id: 'day', label: '1 day', ms: 86_400_000 },
  { id: 'week', label: '1 week', ms: 7 * 86_400_000 },
] as const;
export type DurationChoice = (typeof DURATION_CHOICES)[number]['id'];
export const DEFAULT_DURATION: DurationChoice = 'day';

/** At most this many automatic payments in any hour. */
export const PAYMENTS_PER_HOUR = 10;
/** ...and at most this many payments' worth of money in any hour. */
export const HOURLY_AMOUNT_IN_PAYMENTS = 4n;
/** ...and this many payments' worth in all. */
export const LIFETIME_IN_PAYMENTS = 10n;

export type AllowanceDraft = { asset: RequestAsset; perPayment: bigint; duration: DurationChoice; nowMs: number };

/** The terms this app proposes for a draft (see the header for the defaults). */
export function buildAllowanceTerms(draft: AllowanceDraft): PlainAllowanceTerms {
  if (draft.perPayment <= 0n) throw new Error('The amount per payment must be above zero');
  const duration = DURATION_CHOICES.find((d) => d.id === draft.duration) ?? DURATION_CHOICES[1];
  const decimal = (value: bigint) => toPaykitDecimal(value, draft.asset);
  return {
    asset: draft.asset,
    perPayment: { minimum: '0', maximum: decimal(draft.perPayment) },
    periodLimits: [
      {
        amountLimit: decimal(draft.perPayment * HOURLY_AMOUNT_IN_PAYMENTS),
        paymentCountLimit: PAYMENTS_PER_HOUR,
        period: { kind: 'rolling', every: 1, unit: 'hour' },
      },
    ],
    lifetimeAmountLimit: decimal(draft.perPayment * LIFETIME_IN_PAYMENTS),
    // No start time: usable as soon as it is accepted.
    activeFrom: undefined,
    expiresAt: new Date(Math.floor((draft.nowMs + duration.ms) / 1000) * 1000).toISOString().replace('.000Z', 'Z'),
    allowedEndpointIdentifiers: [ENDPOINT_FOR_ASSET[draft.asset]],
  };
}

// Words -------------------------------------------------------------------------------

const PERIOD_WORDS: Record<string, string> = { minute: 'a minute', hour: 'an hour', day: 'a day', week: 'a week', month: 'a month', year: 'a year' };

function periodWords(period: AllowancePeriodView): string {
  if (period.every === 1) return PERIOD_WORDS[period.unit] ?? `per ${period.unit}`;
  return `every ${period.every} ${period.unit}s`;
}

/**
 * The limits as sentences: "Up to 5 USD₮ a payment. At most 10 payments
 * and 20 USD₮ an hour. 50 USD₮ in all." `formatDate` words the end date.
 */
export function allowanceTermsWords(view: AllowanceTermsView, formatDate: (ms: number) => string): string {
  const asset = view.asset;
  if (!asset) return `Limits in ${view.rawAsset}, which this wallet doesn't hold.`;
  const money = (value: bigint) => formatAssetAmount(value, asset, { withSymbol: true });
  const sentences: string[] = [];
  if (view.perPaymentMax !== undefined) {
    sentences.push(view.perPaymentMin ? `From ${money(view.perPaymentMin)} to ${money(view.perPaymentMax)} a payment` : `Up to ${money(view.perPaymentMax)} a payment`);
  }
  for (const period of view.periods) {
    const parts = [period.count !== undefined ? `${period.count} ${period.count === 1 ? 'payment' : 'payments'}` : undefined, period.amount !== undefined ? money(period.amount) : undefined].filter(Boolean);
    if (parts.length > 0) sentences.push(`At most ${parts.join(' and ')} ${periodWords(period)}`);
  }
  if (view.lifetime !== undefined) sentences.push(`${money(view.lifetime)} in all`);
  if (view.expiresAtMs !== undefined) sentences.push(`Until ${formatDate(view.expiresAtMs)}`);
  return sentences.map((s) => `${s}.`).join(' ');
}

// Matching (display only) -------------------------------------------------------------

/**
 * Whether these limits statically cover a request: same asset, amount
 * within the per-payment range, and our payment method allowed. Time,
 * usage and lifecycle are the SDK's call (evaluateAllowanceCandidates,
 * reserveAutomaticPayment); this only decides what the screens say.
 */
export function allowanceCovers(view: AllowanceTermsView, request: Pick<RequestTermsView, 'asset' | 'amount' | 'cannotPay'>, nowMs: number): boolean {
  if (!view.asset || request.cannotPay || request.asset !== view.asset || request.amount === undefined) return false;
  if (view.perPaymentMax !== undefined && request.amount > view.perPaymentMax) return false;
  if (view.perPaymentMin !== undefined && request.amount < view.perPaymentMin) return false;
  if (view.endpoints && !view.endpoints.includes(ENDPOINT_FOR_ASSET[view.asset])) return false;
  if (view.expiresAtMs !== undefined && nowMs >= view.expiresAtMs) return false;
  return true;
}

// Usage -------------------------------------------------------------------------------

/** One automatic payment counted against an Allowance: committed or still reserved (never a failed one). */
export type UsageEntry = { amount: bigint; admittedAtMs: number };

export type AllowanceUsage = {
  payments: number;
  total: bigint;
  /** Per configured period, what counts in the period containing `nowMs`. */
  periods: { payments: number; total: bigint }[];
};

/**
 * What an Allowance has used, the way the spec counts it: a rolling period
 * holds admissions in (now - length, now]; an anchored one those in the
 * anchor-aligned interval containing now. Months and years (calendar math)
 * are not proposed by this app and count as the whole history here.
 */
export function allowanceUsage(view: AllowanceTermsView, entries: readonly UsageEntry[], nowMs: number): AllowanceUsage {
  const sum = (list: readonly UsageEntry[]) => list.reduce((total, e) => total + e.amount, 0n);
  const periods = view.periods.map((period) => {
    let inPeriod: readonly UsageEntry[] = entries;
    const length = period.lengthMs;
    if (length !== undefined && length > 0) {
      if (period.rolling) {
        inPeriod = entries.filter((e) => e.admittedAtMs > nowMs - length && e.admittedAtMs <= nowMs);
      } else if (period.anchorMs !== undefined) {
        const k = Math.floor((nowMs - period.anchorMs) / length);
        const start = period.anchorMs + k * length;
        inPeriod = entries.filter((e) => e.admittedAtMs >= start && e.admittedAtMs < start + length);
      }
    }
    return { payments: inPeriod.length, total: sum(inPeriod) };
  });
  return { payments: entries.length, total: sum(entries), periods };
}

/**
 * "2 of 10 payments and 2 of 20 USD₮ in the last hour. 7 of 50 USD₮ used
 * in all." for the Person page.
 */
export function allowanceUsageWords(view: AllowanceTermsView, usage: AllowanceUsage): string {
  const asset = view.asset;
  if (!asset) return '';
  const money = (value: bigint) => formatAssetAmount(value, asset, { withSymbol: true });
  const sentences: string[] = [];
  view.periods.forEach((period, index) => {
    const used = usage.periods[index];
    if (!used) return;
    const parts = [
      period.count !== undefined ? `${used.payments} of ${period.count} ${period.count === 1 ? 'payment' : 'payments'}` : undefined,
      period.amount !== undefined ? `${money(used.total)} of ${money(period.amount)}` : undefined,
    ].filter(Boolean);
    const when = period.rolling ? `in the last ${period.every === 1 ? period.unit : `${period.every} ${period.unit}s`}` : `this ${period.unit}`;
    if (parts.length > 0) sentences.push(`${parts.join(' and ')} ${when}`);
  });
  if (view.lifetime !== undefined) sentences.push(`${money(usage.total)} of ${money(view.lifetime)} used in all`);
  else sentences.push(`${money(usage.total)} paid in all`);
  return sentences.map((s) => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`).join(' ');
}

/** Why the SDK would not pay a request automatically (an FfiAllowanceAccountingBlock), in words. */
export function automaticBlockWords(tag: string, code?: string): string {
  if (tag === 'SharedRule') {
    switch (code) {
      case 'period_amount_limit':
      case 'period_count_limit':
        return 'It would go over your hourly limit for automatic payments.';
      case 'lifetime_amount_limit':
        return 'It would go over the total you allowed for automatic payments.';
      case 'amount_outside_range':
        return 'It is more than you allowed for one automatic payment.';
      case 'expired':
        return 'Your automatic payments to them have ended.';
      case 'not_active':
        return "Your automatic payments to them haven't started yet.";
      default:
        return "Your limits for automatic payments don't cover it.";
    }
  }
  switch (tag) {
    case 'ManualOnly':
      return 'You answered it yourself, so it is paid by hand.';
    case 'PaymentAlreadyRecorded':
      return 'This payment is already recorded.';
    case 'InvalidLifecycle':
      return 'The request or your automatic payments are no longer active.';
    default:
      return "It couldn't be paid automatically right now.";
  }
}
