// Paykit payment adapter backed by WDK addresses.
//
// Every method here is called synchronously on the JS thread while a Rust
// worker waits. WDK runs in a separate worklet and answers asynchronously, so
// we can never ask WDK from inside a callback. Instead the app loads the
// addresses first and puts them in this cache; the callbacks only read it.
//
// For now the same addresses are used publicly and for every contact
// (account 0 on each chain). Per-contact BTC accounts come in a later phase.
import {
  FfiPaymentPayload,
  FfiPrivateReceivingDetailReservationResponseKind,
  PaykitFfiError,
  type FfiPaymentTarget,
  type FfiPrivatePaymentEndpointCandidate,
  type FfiPrivatePaymentEndpointReservationCancellation,
  type FfiPrivatePaymentEndpointSelectionRequest,
  type FfiPrivateReceivingDetail,
  type FfiPrivateReceivingDetailReservationResponse,
  type FfiPublicPaymentEndpointCandidate,
  type FfiPublicPaymentEndpointSelectionRequest,
  type FfiPublicReceivingDetail,
  type FfiSdkPaymentAdapter,
} from '@synonymdev/react-native-paykit';

import { ENDPOINT_BTC, ENDPOINT_USDT, SUPPORTED_ENDPOINTS } from '../config/paykit';
import { SEPOLIA_CHAIN_ID, SEPOLIA_USDT } from '../config/wdk';

export type AddressCache = {
  btc?: string;
  evm?: string;
};

/** Endpoint payloads: small JSON, so they fit Paykit's message size limit. */
export function receivingDetails(addresses: AddressCache): Array<{ identifier: string; payload: string }> {
  const details: Array<{ identifier: string; payload: string }> = [];
  if (addresses.btc) {
    details.push({ identifier: ENDPOINT_BTC, payload: JSON.stringify({ value: addresses.btc }) });
  }
  if (addresses.evm) {
    details.push({
      identifier: ENDPOINT_USDT,
      payload: JSON.stringify({
        value: addresses.evm,
        chain_id: String(SEPOLIA_CHAIN_ID),
        token: SEPOLIA_USDT,
      }),
    });
  }
  return details;
}

export class WdkPaymentAdapter implements FfiSdkPaymentAdapter {
  private addresses: AddressCache = {};

  /** Called by the app after WDK has derived the addresses. */
  setAddresses(addresses: AddressCache): void {
    this.addresses = { ...addresses };
  }

  private details(): Array<FfiPublicReceivingDetail & FfiPrivateReceivingDetail> {
    return receivingDetails(this.addresses).map(({ identifier, payload }) => ({
      identifier,
      payload: new FfiPaymentPayload(payload),
    }));
  }

  currentPublicReceivingDetails(): Array<FfiPublicReceivingDetail> {
    return this.details();
  }

  currentPrivateReceivingDetails(_counterparty: string): Array<FfiPrivateReceivingDetail> {
    return this.details();
  }

  /** No reservations yet: the same details serve every contact. */
  reservePrivateReceivingDetails(_counterparty: string): FfiPrivateReceivingDetailReservationResponse {
    return {
      kind: FfiPrivateReceivingDetailReservationResponseKind.UseCurrentReceivingDetails,
      reservations: [],
    };
  }

  cancelPrivateReceivingDetailReservation(
    _cancellation: FfiPrivatePaymentEndpointReservationCancellation,
  ): void {
    // Nothing reserved, so nothing to cancel.
  }

  selectPublicPaymentEndpointIds(request: FfiPublicPaymentEndpointSelectionRequest): Array<string> {
    return preferredCandidateIds(request.candidates);
  }

  buildPublicPaymentTarget(endpoint: FfiPublicPaymentEndpointCandidate): FfiPaymentTarget {
    return buildTarget(endpoint.payload.exportText());
  }

  selectPrivatePaymentEndpointIds(request: FfiPrivatePaymentEndpointSelectionRequest): Array<string> {
    return preferredCandidateIds(request.candidates);
  }

  buildPrivatePaymentTarget(endpoint: FfiPrivatePaymentEndpointCandidate): FfiPaymentTarget {
    return buildTarget(endpoint.payload.exportText());
  }
}

function buildTarget(payloadText: string): FfiPaymentTarget {
  try {
    return { payload: new FfiPaymentPayload(payloadText) };
  } catch {
    throw new PaykitFfiError.PaymentAdapter({ code: 'invalid_payload', context: 'payload' });
  }
}

/** Candidates we can pay, in our preference order. */
function preferredCandidateIds(
  candidates: ReadonlyArray<{ candidateId: string; identifier: string }>,
): string[] {
  return SUPPORTED_ENDPOINTS.flatMap((identifier) =>
    candidates.filter((c) => c.identifier === identifier).map((c) => c.candidateId),
  );
}
