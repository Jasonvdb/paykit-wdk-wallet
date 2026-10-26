// Allowances ("automatic payments"): the lifecycle with a contact, and what
// screens read. The limits and words are in ./allowanceTerms.ts; paying
// automatically is in ./automaticPayments.ts.
//
// Lifecycle (specs/allowances.md, the SDK derives the state from the
// private Event Messages over the Encrypted Link):
//
//   either side: proposeAllowance(role, terms) ─▶ Proposed
//   the other side: acceptAllowance(id, proposal stream item) ─▶ Accepted
//                   rejectAllowance(id) ─▶ Rejected (terminal)
//   either side, any time: endAllowance(id) ─▶ Ended (terminal; the
//                   proposer can also withdraw a proposal this way)
//   two different proposals with one id ─▶ Conflicted (never usable)
//
// In this app the payer proposes, as the Allower ("Ana offers to pay
// Ben's requests automatically, up to ..."), and the payee accepts. A
// proposal from a wallet that asks to be paid (the peer proposes as
// Allowee) is shown the same way, and accepting it is the payer's consent.
// Acceptance names the proposal's stream item, so terms that changed after
// the person read them are refused.
//
// What is cached here (memory only, rebuilt from the SDK):
//   views    listAllowances() for every contact that isn't blocked, as
//            plain data: the terms through their getters (the FFI objects
//            are sensitive and never logged)
//   ledger   allowanceAccountingState(): which request uses which
//            Allowance (associations), and each automatic payment counted
//            against one (usage). The payment ledger is shared with manual
//            payments (./requests.ts), so it also says which payments are
//            already taken or were answered by hand.
// A round hook refreshes both when a contact sent something, after our own
// actions, and every 30 s.
import {
  FfiAllowanceHistoryStatus,
  FfiAllowanceLifecycleState,
  FfiAllowanceLocalRole,
  FfiAllowanceAmountRange,
  FfiAllowancePeriod,
  FfiAllowancePeriodLimit,
  FfiAllowanceTerms,
  FfiOutboundPrivateMessageStatus,
  FfiPaymentDisposition_Tags,
  FfiPaymentExecutionMode,
  FfiPaymentExecutionStatus,
  type FfiAllowanceAccountingState,
  type FfiAllowanceRecord,
  type FfiAllowanceTermsInterface,
} from '@synonymdev/react-native-paykit';

import { fromPaykitDecimal } from '../wallet/amounts';
import { readAllowanceTerms, type AllowanceTermsView, type PlainAllowanceTerms, type UsageEntry } from './allowanceTerms';
import { describeError, UserFacingError } from './errors';
import { shortKey } from './keys';
import type { PaykitService } from './PaykitService';
import { parseTime } from './recurrence';
import { paymentKey } from './requestBook';
import type { Delivery } from './requestStatus';
import type { SyncRoundContext } from './syncLoop';

export type AllowanceRole = 'allower' | 'allowee' | 'unknown';
export type AllowanceState = 'proposed' | 'accepted' | 'rejected' | 'ended' | 'conflicted' | 'unknown';

/** One Allowance with one contact, as plain data for screens. */
export type AllowanceView = {
  counterparty: string;
  allowanceId: string;
  /** Allower: we pay them. Allowee: they pay us. */
  role: AllowanceRole;
  state: AllowanceState;
  /** The SDK found its history consistent (anything else never pays). */
  healthy: boolean;
  terms?: AllowanceTermsView;
  proposedByUs: boolean;
  /** The proposal the person approves (acceptAllowance names it). */
  proposalStreamItemId?: bigint;
  /** Our last message about it (proposal, answer or end) has left, or not. */
  ourDelivery?: Delivery;
  lastEventAtMs?: number;
};

/** The payment ledger, read for display and for the automatic payment hook. */
export type AllowanceLedger = {
  /** allowanceId -> automatic payments counted against it (not failed ones). */
  usage: Map<string, UsageEntry[]>;
  /** counterparty|requestId -> the Allowance chosen for that request, latest revision. */
  associations: Map<string, { allowanceId: string; revision: bigint }>;
  /** paymentKey -> what the ledger holds for that payment. */
  occurrences: Map<string, { live: boolean; automatic: boolean; manualOnly: boolean; allowanceId?: string }>;
  /** counterparty|requestId of requests answered by hand: never paid automatically (sticky). */
  manualRequests: Set<string>;
  /** False until the wallet has reconciled the ledger once (./requests.ts). */
  reconciled: boolean;
};

export function requestKey(counterparty: string, requestId: string): string {
  return `${counterparty}|${requestId}`;
}

const ROLE_OF: Record<FfiAllowanceLocalRole, AllowanceRole> = {
  [FfiAllowanceLocalRole.Allower]: 'allower',
  [FfiAllowanceLocalRole.Allowee]: 'allowee',
  [FfiAllowanceLocalRole.Unknown]: 'unknown',
};
const STATE_OF: Record<FfiAllowanceLifecycleState, AllowanceState> = {
  [FfiAllowanceLifecycleState.Proposed]: 'proposed',
  [FfiAllowanceLifecycleState.Accepted]: 'accepted',
  [FfiAllowanceLifecycleState.Rejected]: 'rejected',
  [FfiAllowanceLifecycleState.Ended]: 'ended',
  [FfiAllowanceLifecycleState.Conflicted]: 'conflicted',
  [FfiAllowanceLifecycleState.Unknown]: 'unknown',
};

function deliveryOf(status: FfiOutboundPrivateMessageStatus | undefined): Delivery | undefined {
  switch (status) {
    case FfiOutboundPrivateMessageStatus.Pending:
    case FfiOutboundPrivateMessageStatus.Sending:
      return 'queued';
    case FfiOutboundPrivateMessageStatus.Sent:
      return 'sent';
    case undefined:
      return undefined;
    default:
      return 'failed';
  }
}

/** The terms through their getters: the FFI object's text is exported explicitly. */
function plainTermsOf(terms: FfiAllowanceTermsInterface): PlainAllowanceTerms {
  const range = terms.perPaymentAmount();
  return {
    asset: terms.asset(),
    perPayment: range ? { minimum: range.minimum(), maximum: range.maximum() } : undefined,
    periodLimits: terms.periodLimits().map((limit) => {
      const period = limit.period();
      const count = limit.paymentCountLimit();
      return {
        amountLimit: limit.amountLimit(),
        paymentCountLimit: count === undefined ? undefined : Number(count),
        period: { kind: period.kind(), every: Number(period.every()), unit: period.unit(), anchor: period.anchor() },
      };
    }),
    lifetimeAmountLimit: terms.lifetimeAmountLimit(),
    activeFrom: terms.activeFrom(),
    expiresAt: terms.expiresAt(),
    allowedEndpointIdentifiers: terms.allowedPaymentEndpointIdentifiers(),
  };
}

export function allowanceViewOf(record: FfiAllowanceRecord): AllowanceView {
  let terms: AllowanceTermsView | undefined;
  try {
    terms = record.terms ? readAllowanceTerms(plainTermsOf(record.terms)) : undefined;
  } catch {
    terms = undefined;
  }
  return {
    counterparty: record.counterparty,
    allowanceId: record.allowanceId,
    role: record.localRole === undefined ? 'unknown' : ROLE_OF[record.localRole],
    state: STATE_OF[record.state] ?? 'unknown',
    healthy: record.historyStatus === FfiAllowanceHistoryStatus.Consistent,
    terms,
    proposedByUs: record.proposalOutboundMessageId !== undefined,
    proposalStreamItemId: record.proposalStreamItemId,
    ourDelivery: deliveryOf(record.lastOutboundStatus),
    lastEventAtMs: parseTime(record.lastEventAt),
  };
}

function ledgerOf(state: FfiAllowanceAccountingState | undefined): AllowanceLedger {
  const ledger: AllowanceLedger = { usage: new Map(), associations: new Map(), occurrences: new Map(), manualRequests: new Set(), reconciled: !!state && !state.requiresReconciliation };
  if (!state) return ledger;
  for (const association of state.history.associations) {
    const latest = association.revisions[association.revisions.length - 1];
    if (latest) ledger.associations.set(requestKey(association.request.counterparty, association.request.paymentRequestId), { allowanceId: latest.allowanceId, revision: latest.revision });
  }
  for (const occurrence of state.history.occurrences) {
    const { counterparty, paymentRequestId } = occurrence.key.request;
    const key = paymentKey(counterparty, paymentRequestId, occurrence.key.billingPeriod);
    const live = occurrence.attempts.find((a) => a.status !== FfiPaymentExecutionStatus.Failed);
    const manualOnly = occurrence.disposition.tag === FfiPaymentDisposition_Tags.ManualOnly;
    ledger.occurrences.set(key, { live: !!live, automatic: live?.mode === FfiPaymentExecutionMode.Automatic, manualOnly, allowanceId: live?.allowanceId });
    if (manualOnly && !occurrence.key.billingPeriod) ledger.manualRequests.add(requestKey(counterparty, paymentRequestId));
    for (const attempt of occurrence.attempts) {
      if (attempt.mode !== FfiPaymentExecutionMode.Automatic || !attempt.allowanceId || attempt.status === FfiPaymentExecutionStatus.Failed) continue;
      const asset = attempt.amount.asset();
      const parsed = asset === 'btc' || asset === 'usdt' ? fromPaykitDecimal(attempt.amount.value(), asset) : undefined;
      if (!parsed?.ok) continue;
      const list = ledger.usage.get(attempt.allowanceId) ?? [];
      list.push({ amount: parsed.value, admittedAtMs: parseTime(attempt.admittedAt) ?? 0 });
      ledger.usage.set(attempt.allowanceId, list);
    }
  }
  return ledger;
}

/** How often the cache is refreshed when nothing else asks for it. */
const REFRESH_MS = 30_000;

/** Per-service cache of Allowances and the payment ledger. */
export class Allowances {
  private views: AllowanceView[] = [];
  private ledger: AllowanceLedger = ledgerOf(undefined);
  private revision = 0;
  private lastRefreshAt = 0;
  private dirty = true;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly service: PaykitService) {}

  all(): AllowanceView[] {
    return this.views;
  }

  withPerson(counterparty: string): AllowanceView[] {
    return this.views.filter((v) => v.counterparty === counterparty);
  }

  /** Accepted Allowances we pay under (we are the Allower), healthy only. */
  usableAsPayer(counterparty?: string): AllowanceView[] {
    return this.views.filter((v) => v.role === 'allower' && v.state === 'accepted' && v.healthy && (!counterparty || v.counterparty === counterparty));
  }

  getLedger(): AllowanceLedger {
    return this.ledger;
  }

  getRevision(): number {
    return this.revision;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Ask for a refresh on the next round (after our own action, or a payment). */
  markDirty(): void {
    this.dirty = true;
  }

  async refreshIfDue(context?: SyncRoundContext): Promise<void> {
    const due = this.dirty || (context?.receivedFrom.length ?? 0) > 0 || Date.now() - this.lastRefreshAt > REFRESH_MS;
    if (due) await this.refresh('background');
  }

  async refresh(priority: 'user' | 'background' = 'user'): Promise<void> {
    this.dirty = false;
    this.lastRefreshAt = Date.now();
    try {
      const records = await this.service.call('listAllowances', (sdk, signal) => sdk.listAllowances({ counterparty: undefined, localRole: undefined, states: [] }, { signal }), priority);
      this.views = records.map(allowanceViewOf);
      const accounting = await this.service.call('allowanceAccountingState', (sdk, signal) => sdk.allowanceAccountingState({ signal }), priority);
      this.ledger = ledgerOf(accounting);
    } catch (error) {
      this.service.log.warn(`allowances: ${describeError(error)}`);
      this.dirty = true;
      return;
    }
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }
}

const perService = new WeakMap<PaykitService, Allowances>();

export function allowancesOf(service: PaykitService): Allowances {
  let allowances = perService.get(service);
  if (!allowances) {
    allowances = new Allowances(service);
    perService.set(service, allowances);
  }
  return allowances;
}

// Actions ------------------------------------------------------------------------------

function ffiTermsOf(plain: PlainAllowanceTerms): FfiAllowanceTerms {
  return new FfiAllowanceTerms(
    plain.asset,
    plain.perPayment ? new FfiAllowanceAmountRange(plain.perPayment.minimum, plain.perPayment.maximum) : undefined,
    plain.periodLimits.map(
      (limit) =>
        new FfiAllowancePeriodLimit(
          limit.amountLimit,
          limit.paymentCountLimit === undefined ? undefined : BigInt(limit.paymentCountLimit),
          new FfiAllowancePeriod(limit.period.kind, BigInt(limit.period.every), limit.period.unit, limit.period.anchor),
        ),
    ),
    plain.lifetimeAmountLimit,
    plain.activeFrom,
    plain.expiresAt,
    plain.allowedEndpointIdentifiers,
  );
}

async function afterAction(service: PaykitService): Promise<void> {
  const allowances = allowancesOf(service);
  await allowances.refresh();
  service.syncLoop.flush();
}

/**
 * Offer to pay `counterparty`'s requests automatically within `terms`
 * (proposeAllowance as the Allower). Nothing is paid until they accept.
 */
export async function offerAutomaticPayments(service: PaykitService, counterparty: string, terms: PlainAllowanceTerms): Promise<void> {
  const ffiTerms = ffiTermsOf(terms);
  await service.call('proposeAllowance', (sdk, signal) => sdk.proposeAllowance(counterparty, FfiAllowanceLocalRole.Allower, ffiTerms, { signal }));
  service.log.info(`offered automatic payments to ${shortKey(counterparty)}`);
  await afterAction(service);
}

/** Accept their proposal, naming the exact one the person read. */
export async function acceptAutomaticPayments(service: PaykitService, view: AllowanceView): Promise<void> {
  const streamItemId = view.proposalStreamItemId;
  if (streamItemId === undefined) throw new UserFacingError("This offer can't be accepted. Ask them to send it again.");
  await service.call('acceptAllowance', (sdk, signal) => sdk.acceptAllowance(view.counterparty, view.allowanceId, streamItemId, { signal }));
  service.log.info(`accepted automatic payments with ${shortKey(view.counterparty)}: ${view.allowanceId.slice(0, 8)}`);
  await afterAction(service);
}

export async function declineAutomaticPayments(service: PaykitService, view: AllowanceView): Promise<void> {
  await service.call('rejectAllowance', (sdk, signal) => sdk.rejectAllowance(view.counterparty, view.allowanceId, { signal }));
  service.log.info(`declined automatic payments with ${shortKey(view.counterparty)}: ${view.allowanceId.slice(0, 8)}`);
  await afterAction(service);
}

/** End accepted authority, or withdraw our own proposal (endAllowance). Payments already made stay made. */
export async function endAutomaticPayments(service: PaykitService, view: AllowanceView): Promise<void> {
  await service.call('endAllowance', (sdk, signal) => sdk.endAllowance(view.counterparty, view.allowanceId, { signal }));
  service.log.info(`ended automatic payments with ${shortKey(view.counterparty)}: ${view.allowanceId.slice(0, 8)}`);
  await afterAction(service);
}
