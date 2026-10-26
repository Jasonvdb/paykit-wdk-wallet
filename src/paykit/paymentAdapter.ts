// The Paykit payment adapter: how Paykit asks this wallet what to publish,
// what to share privately, and which of a peer's endpoints it can pay.
//
// Every method here is called synchronously on the JS thread while a Rust
// worker waits, and must not call back into the SDK. WDK answers
// asynchronously from its worklet, so the adapter never talks to WDK: it
// reads the ReceivingAddressCache, which the app fills ahead of time.
// Callbacks may only throw PaykitFfiError; anything else becomes an
// "unexpected callback error" on the Rust side.
//
// Receiving:
// - Public details: BTC account 0 + EVM account 0.
// - Private details per contact: that contact's own BTC account + EVM 0.
// - Reservations: our per-contact addresses are stable, not one-time, so
//   `reservePrivateReceivingDetails` answers "use current details" and the
//   SDK then calls `currentPrivateReceivingDetails`. Cancelling therefore
//   has nothing to release; it must still be idempotent, and it is.
//   `reservationInputsFor` builds the explicit-input form for
//   `syncPrivatePaymentListsWithReservationsAndProcessOutbound` (Phase 4).
//
// Paying:
// - select*: our supported identifiers in preference order (USD₮, then BTC),
//   dropping payloads we do not accept (wrong chain id or token, malformed).
// - build*Target: re-validate and return a canonical payload.
import {
  FfiPaymentPayload,
  FfiPrivateReceivingDetailReservationResponseKind,
  PaykitFfiError,
  type FfiPaymentTarget,
  type FfiPrivatePaymentEndpointCandidate,
  type FfiPrivatePaymentEndpointReservationCancellation,
  type FfiPrivatePaymentEndpointReservationInput,
  type FfiPrivatePaymentEndpointSelectionRequest,
  type FfiPrivateReceivingDetail,
  type FfiPrivateReceivingDetailReservationResponse,
  type FfiPublicPaymentEndpointCandidate,
  type FfiPublicPaymentEndpointSelectionRequest,
  type FfiPublicReceivingDetail,
  type FfiSdkPaymentAdapter,
} from '@synonymdev/react-native-paykit';

import type { ReceivingAddressCache } from './addressCache';
import { canonicalPayload, parseEndpoint, payableCandidateIds, type ReceivingDetail } from './endpoints';

function toFfiDetails(details: ReceivingDetail[]): (FfiPublicReceivingDetail & FfiPrivateReceivingDetail)[] {
  return details.map(({ identifier, payload }) => ({ identifier, payload: new FfiPaymentPayload(payload) }));
}

function adapterError(code: string, context: string): PaykitFfiError {
  return new PaykitFfiError.PaymentAdapter({ code, context });
}

function guard<T>(code: string, body: () => T): T {
  try {
    return body();
  } catch (error) {
    if (PaykitFfiError.instanceOf(error)) throw error;
    throw adapterError(code, 'wallet adapter');
  }
}

export class WdkPaymentAdapter implements FfiSdkPaymentAdapter {
  constructor(private readonly cache: ReceivingAddressCache) {}

  currentPublicReceivingDetails(): FfiPublicReceivingDetail[] {
    return guard('public_details_failed', () => toFfiDetails(this.cache.publicReceivingDetails()));
  }

  currentPrivateReceivingDetails(counterparty: string): FfiPrivateReceivingDetail[] {
    return guard('private_details_failed', () => toFfiDetails(this.cache.privateReceivingDetails(counterparty)));
  }

  reservePrivateReceivingDetails(_counterparty: string): FfiPrivateReceivingDetailReservationResponse {
    return {
      kind: FfiPrivateReceivingDetailReservationResponseKind.UseCurrentReceivingDetails,
      reservations: [],
    };
  }

  cancelPrivateReceivingDetailReservation(_cancellation: FfiPrivatePaymentEndpointReservationCancellation): void {
    // Stable per-contact addresses: nothing to release. Idempotent by construction.
  }

  selectPublicPaymentEndpointIds(request: FfiPublicPaymentEndpointSelectionRequest): string[] {
    return guard('select_failed', () =>
      payableCandidateIds(
        request.candidates.map((c) => ({ candidateId: c.candidateId, identifier: c.identifier, payloadText: c.payload.exportText() })),
      ),
    );
  }

  buildPublicPaymentTarget(endpoint: FfiPublicPaymentEndpointCandidate): FfiPaymentTarget {
    return buildTarget(endpoint.identifier, endpoint.payload.exportText());
  }

  selectPrivatePaymentEndpointIds(request: FfiPrivatePaymentEndpointSelectionRequest): string[] {
    return guard('select_failed', () =>
      payableCandidateIds(
        request.candidates.map((c) => ({ candidateId: c.candidateId, identifier: c.identifier, payloadText: c.payload.exportText() })),
      ),
    );
  }

  buildPrivatePaymentTarget(endpoint: FfiPrivatePaymentEndpointCandidate): FfiPaymentTarget {
    return buildTarget(endpoint.identifier, endpoint.payload.exportText());
  }
}

function buildTarget(identifier: string, payloadText: string): FfiPaymentTarget {
  return guard('invalid_payload', () => {
    const parsed = parseEndpoint(identifier, payloadText);
    if (!parsed) throw adapterError('invalid_payload', identifier);
    return { payload: new FfiPaymentPayload(canonicalPayload(parsed)) };
  });
}

/**
 * The explicit-input form of a contact's private details, for
 * `syncPrivatePaymentListsWithReservationsAndProcessOutbound`. Reservation
 * ids are stable per identifier and account, so re-sending the same list is
 * idempotent; the attribution records which BTC account it came from.
 */
export function reservationInputsFor(
  cache: ReceivingAddressCache,
  counterparty: string,
): FfiPrivatePaymentEndpointReservationInput[] {
  const accountIndex = cache.ensureContactAccount(counterparty);
  return cache.privateReceivingDetails(counterparty).map(({ identifier, payload }) => ({
    reservationId: `${identifier}:${identifier.startsWith('btc') ? accountIndex : 0}`,
    identifier,
    payload,
    expiresAt: undefined,
    attribution: new Map([['account_index', String(identifier.startsWith('btc') ? accountIndex : 0)]]),
  }));
}
