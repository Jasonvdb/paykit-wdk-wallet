// Payment request terms: building ours, reading anyone's.
//
// A payment request's terms are immutable once proposed
// (specs/payment-requests.md, "Payment Request terms"):
//
//   amount                 { value: "0.0001", asset: "btc" }  Paykit decimal text
//   payment_reference      ours: "pkw-<time>", copied into every proof
//   proposal_expires_at    the payer must accept before this
//   recurrence             null, or { every, unit, starts_at, anchor, ends_at }
//   accepted_payment_endpoint_identifiers   one: the asset's rail id
//   required_app_id        our Paykit app id: pay an endpoint this app owns
//   payment_endpoints      the exact address to pay, bound to this request
//   metadata               { "note": "Pizza" }
//
// Binding the address (`payment_endpoints`) instead of letting the payer
// read our Private Payment List makes the request say exactly where the
// money must land, so the on-chain check later compares against the terms
// alone. For Bitcoin it is the payer's own contact account address (only
// they know it is ours), for USD₮ our EVM account 0.
//
// The whole proposal travels as one private message, which must fit in
// 1000 bytes, so notes are short and the size is checked before sending.
// Pure: no native imports, unit tested.
import { ENDPOINT_BTC, ENDPOINT_USDT, PAYKIT_APP_ID } from '../config/paykit';
import { fromPaykitDecimal, toPaykitDecimal } from '../wallet/amounts';
import { parseEndpoint, PRIVATE_MESSAGE_LIMIT_BYTES, utf8ByteLength, type ParsedEndpoint, type ReceivingDetail } from './endpoints';
import { cleanDisplayName } from './profiles';
import { endsAtForCount, intervalWords, parseTime, toRfc3339, type Recurrence } from './recurrence';

export type RequestAsset = 'btc' | 'usdt';

/** The rail id for each asset this wallet requests and pays. */
export const ENDPOINT_FOR_ASSET: Record<RequestAsset, string> = { btc: ENDPOINT_BTC, usdt: ENDPOINT_USDT };

export const NOTE_MAX_CHARS = 100;

/** Leave room for the event envelope's encryption and framing inside the 1000-byte message. */
export const REQUEST_MESSAGE_BUDGET_BYTES = PRIVATE_MESSAGE_LIMIT_BYTES - 100;

export const EXPIRY_CHOICES = [
  { id: '10m', label: '10 minutes', ms: 10 * 60_000 },
  { id: '1h', label: '1 hour', ms: 60 * 60_000 },
  { id: '1d', label: '1 day', ms: 24 * 60 * 60_000 },
  { id: '1w', label: '1 week', ms: 7 * 24 * 60 * 60_000 },
] as const;
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number]['id'];

/** Short demo schedules: a recurring request shows several payments within minutes. */
export const REPEAT_CHOICES = [
  { id: 'once', label: 'One time' },
  { id: '1m', label: 'Every minute', every: 1 },
  { id: '5m', label: 'Every 5 minutes', every: 5 },
] as const;
export type RepeatChoice = (typeof REPEAT_CHOICES)[number]['id'];
export const PAYMENT_COUNT_CHOICES = [2, 3, 5, 10] as const;

/**
 * What a recurring request means for the payer, for the Request money
 * screen. The schedule starts when the request is sent, not when it is
 * accepted (buildRequestTerms), so a late accept makes several payments
 * due at once; the words say so.
 */
export function recurringScheduleWords(repeat: RepeatChoice, count: number, name: string): string {
  const choice = REPEAT_CHOICES.find((c) => c.id === repeat);
  if (!choice || !('every' in choice)) return '';
  return `A payment is due now and then ${intervalWords({ every: choice.every, unit: 'minute' })}, ${count} in all, counted from when you send this. If ${name} accepts late, the missed ones are due at once. ${name} pays each one with a tap.`;
}

/** The terms as plain data. ./requests.ts turns them into the SDK's FfiPaymentRequestTerms. */
export type RequestTermsInput = {
  amount: { value: string; asset: RequestAsset };
  paymentReference: string;
  proposalExpiresAt: string;
  recurrence?: Recurrence;
  acceptedPaymentEndpointIdentifiers: string[];
  paymentEndpoints: Record<string, string>;
  requiredAppId: string;
  metadata: { note?: string };
};

export type RequestDraft = {
  asset: RequestAsset;
  /** Base units. */
  amount: bigint;
  note: string;
  expiry: ExpiryChoice;
  repeat: RepeatChoice;
  /** Recurring only: how many payments. */
  count: number;
  /** Where the money must land: the receiving detail for this payer and asset. */
  receivingDetail: ReceivingDetail;
  nowMs: number;
};

/** A payment reference: short, unique enough per identity, no control characters. */
export function newPaymentReference(nowMs: number, random: () => number = Math.random): string {
  return `pkw-${nowMs.toString(36)}${Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')}`;
}

/** The note people type, cleaned the way names are (no control or invisible characters), and capped. */
export function cleanNote(note: string | undefined): string | undefined {
  return cleanDisplayName(note)?.slice(0, NOTE_MAX_CHARS);
}

export function buildRequestTerms(draft: RequestDraft, reference: string): RequestTermsInput {
  const identifier = ENDPOINT_FOR_ASSET[draft.asset];
  if (draft.receivingDetail.identifier !== identifier) throw new Error('The receiving address is for another asset');
  const startsAt = toRfc3339(draft.nowMs);
  const expiryMs = EXPIRY_CHOICES.find((c) => c.id === draft.expiry)?.ms ?? EXPIRY_CHOICES[1].ms;
  // The expiry the person chose, even past a recurring schedule's end. The
  // payee's SDK checks it when the acceptance *arrives* (an acceptance it
  // fetches after this time makes the request invalid on its side, and a
  // payment for it is never checked), so a tight expiry is a trap. A payer
  // who accepts late simply pays the periods that are already due.
  const proposalExpiresAt = toRfc3339(draft.nowMs + expiryMs);
  let recurrence: Recurrence | undefined;
  const repeat = REPEAT_CHOICES.find((c) => c.id === draft.repeat);
  if (repeat && 'every' in repeat) {
    const endsAt = endsAtForCount(startsAt, 'minute', repeat.every, draft.count);
    recurrence = { every: repeat.every, unit: 'minute', startsAt, anchor: startsAt, endsAt };
  }
  const note = cleanNote(draft.note);
  return {
    amount: { value: toPaykitDecimal(draft.amount, draft.asset), asset: draft.asset },
    paymentReference: reference,
    proposalExpiresAt,
    recurrence,
    acceptedPaymentEndpointIdentifiers: [identifier],
    paymentEndpoints: { [identifier]: draft.receivingDetail.payload },
    requiredAppId: PAYKIT_APP_ID,
    metadata: note ? { note } : {},
  };
}

/**
 * The proposal's size on the wire, as the spec's JSON event (with
 * placeholder UUIDs). Compared with REQUEST_MESSAGE_BUDGET_BYTES before
 * proposing, so a long note is refused here instead of by the SDK.
 */
export function proposalMessageBytes(terms: RequestTermsInput): number {
  const uuid = '00000000-0000-4000-8000-000000000000';
  const recurrence = terms.recurrence
    ? { every: terms.recurrence.every, unit: terms.recurrence.unit, starts_at: terms.recurrence.startsAt, anchor: terms.recurrence.anchor, ends_at: terms.recurrence.endsAt ?? null }
    : null;
  return utf8ByteLength(
    JSON.stringify({
      version: 1,
      kind: 'paykit.payment_request',
      app_id: terms.requiredAppId,
      event_id: uuid,
      payment_request_id: uuid,
      request: {
        amount: terms.amount,
        payment_reference: terms.paymentReference,
        proposal_expires_at: terms.proposalExpiresAt,
        recurrence,
        accepted_payment_endpoint_identifiers: terms.acceptedPaymentEndpointIdentifiers,
        required_app_id: terms.requiredAppId,
        payment_endpoints: terms.paymentEndpoints,
        metadata: terms.metadata,
      },
    }),
  );
}

// Reading terms -----------------------------------------------------------------

/** The SDK's terms as plain strings (./requests.ts exports the FFI objects' text). */
export type PlainTerms = {
  amountValue: string;
  amountAsset: string;
  reference: string;
  proposalExpiresAt?: string;
  recurrence?: Recurrence;
  acceptedIdentifiers: string[];
  /** Request-bound endpoints, identifier -> payload text. */
  paymentEndpoints?: [string, string][];
  requiredAppId?: string;
  metadataJson: string;
};

export type RequestTermsView = {
  /** Set when the asset is one this wallet holds. */
  asset?: RequestAsset;
  /** Base units, when the asset is known and the decimal parses. */
  amount?: bigint;
  /** The raw amount and asset, for a request this wallet cannot pay. */
  rawAmount: string;
  note?: string;
  reference: string;
  expiresAtMs?: number;
  recurrence?: Recurrence;
  /** The endpoint to pay, when this wallet can pay the request. */
  endpoint?: ParsedEndpoint;
  /** Why this wallet cannot pay it, in words; undefined when it can. */
  cannotPay?: string;
};

function noteFrom(metadataJson: string): string | undefined {
  try {
    const metadata: unknown = JSON.parse(metadataJson);
    if (metadata && typeof metadata === 'object' && typeof (metadata as { note?: unknown }).note === 'string') {
      return cleanNote((metadata as { note: string }).note);
    }
  } catch {
    // Metadata is someone else's JSON: unreadable means no note.
  }
  return undefined;
}

export function readRequestTerms(terms: PlainTerms): RequestTermsView {
  const asset = terms.amountAsset === 'btc' || terms.amountAsset === 'usdt' ? terms.amountAsset : undefined;
  const parsed = asset ? fromPaykitDecimal(terms.amountValue, asset) : undefined;
  const view: RequestTermsView = {
    asset,
    amount: parsed?.ok ? parsed.value : undefined,
    rawAmount: `${terms.amountValue} ${terms.amountAsset}`,
    note: noteFrom(terms.metadataJson),
    reference: terms.reference,
    expiresAtMs: parseTime(terms.proposalExpiresAt),
    recurrence: terms.recurrence,
  };
  if (!asset || view.amount === undefined) return { ...view, cannotPay: `It asks for ${view.rawAmount}, which this wallet can't pay.` };
  const identifier = ENDPOINT_FOR_ASSET[asset];
  if (!terms.acceptedIdentifiers.includes(identifier)) return { ...view, cannotPay: 'It asks to be paid in a way this wallet does not support.' };
  if (terms.paymentEndpoints) {
    const bound = terms.paymentEndpoints.find(([id]) => id === identifier);
    const endpoint = bound ? parseEndpoint(identifier, bound[1]) : undefined;
    if (!endpoint) return { ...view, cannotPay: 'The address in the request is not one this wallet can pay.' };
    return { ...view, endpoint };
  }
  // No bound address: the payer resolves the payee's Private Payment List.
  return view;
}
