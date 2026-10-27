// A request's status words and its five-step timeline, from the separate
// sources: lifecycle, delivery, our payment, our check and receipts.
import { isPaymentHandled, isPaymentMade, isScheduleComplete, paymentWords, requestStatusWords, requestTimeline, type PaymentFacts, type RequestFacts } from '../requestStatus';

const facts = (overrides: Partial<RequestFacts> = {}): RequestFacts => ({
  role: 'payee',
  state: 'proposed',
  name: 'Ben',
  accepted: false,
  ourDelivery: 'sent',
  canceledByUs: false,
  recurring: false,
  payments: [],
  ...overrides,
});
const payment = (overrides: Partial<PaymentFacts> = {}): PaymentFacts => ({ key: 'k', proofRecorded: false, ...overrides });
const states = (f: RequestFacts, p?: PaymentFacts) => requestTimeline(f, p).map((s) => `${s.key}:${s.state}`);

describe('requestStatusWords', () => {
  it('words the payee side', () => {
    expect(requestStatusWords(facts({ ourDelivery: 'queued' }))).toBe('Waiting to reach them…');
    expect(requestStatusWords(facts())).toBe('Waiting for Ben');
    expect(requestStatusWords(facts({ state: 'accepted', accepted: true }))).toBe('Ben accepted, not paid yet');
    expect(requestStatusWords(facts({ state: 'proof-submitted', accepted: true, payments: [payment({ proofRecorded: true })] }))).toBe('Paid, checking on chain');
    expect(requestStatusWords(facts({ state: 'proof-submitted', accepted: true, payments: [payment({ proofRecorded: true, check: 'verified', receipt: 'sent' })] }))).toBe(
      'Paid, receipt sent',
    );
    expect(requestStatusWords(facts({ state: 'rejected' }))).toBe('Ben declined');
    expect(requestStatusWords(facts({ state: 'canceled', canceledByUs: true }))).toBe('You canceled it');
  });

  it('words the payer side', () => {
    const payer = (o: Partial<RequestFacts>) => facts({ role: 'payer', ...o });
    expect(requestStatusWords(payer({}))).toBe('Waiting for you');
    expect(requestStatusWords(payer({ state: 'expired' }))).toBe('Expired');
    expect(requestStatusWords(payer({ state: 'accepted', accepted: true, payments: [payment({ outgoing: 'unknown' })] }))).toBe('May have been paid. Check Activity');
    expect(requestStatusWords(payer({ state: 'proof-submitted', accepted: true, payments: [payment({ proofRecorded: true })] }))).toBe("Paid, waiting for Ben's receipt");
    expect(requestStatusWords(payer({ state: 'proof-submitted', accepted: true, payments: [payment({ proofRecorded: true, receipt: 'received' })] }))).toBe(
      'Paid, receipt received',
    );
    expect(requestStatusWords(payer({ state: 'canceled' }))).toBe('Ben canceled it');
  });

  it('counts recurring payments', () => {
    const recurring = facts({ recurring: true, state: 'active', accepted: true, totalPayments: 3, payments: [payment({ proofRecorded: true }), payment({ key: 'k2' })] });
    expect(requestStatusWords(recurring)).toBe('Active: 1 of 3 paid');
  });

  it('says a set schedule is done once every payment is made, though the SDK still calls it active', () => {
    const made = [payment({ proofRecorded: true }), payment({ key: 'k2', outgoing: 'broadcast' }), payment({ key: 'k3', proofRecorded: true, receipt: 'received' })];
    const done = facts({ role: 'payer', recurring: true, state: 'active', accepted: true, totalPayments: 3, payments: made });
    expect(isScheduleComplete(done)).toBe(true);
    expect(requestStatusWords(done)).toBe('All 3 paid');
    expect(isScheduleComplete({ ...done, payments: made.slice(0, 2) })).toBe(false);
    // An endless schedule is never done.
    expect(isScheduleComplete({ ...done, totalPayments: undefined })).toBe(false);
    expect(isScheduleComplete({ ...done, recurring: false })).toBe(false);
  });
});

describe('requestTimeline', () => {
  it('walks a one-time request through every step (payee)', () => {
    expect(states(facts())).toEqual(['requested:done', 'accepted:current', 'paid:todo', 'verified:todo', 'receipt:todo']);
    expect(states(facts({ accepted: true, state: 'accepted' }), payment())).toEqual(['requested:done', 'accepted:done', 'paid:current', 'verified:todo', 'receipt:todo']);
    const paid = facts({ accepted: true, state: 'proof-submitted' });
    expect(states(paid, payment({ proofRecorded: true }))).toEqual(['requested:done', 'accepted:done', 'paid:done', 'verified:current', 'receipt:todo']);
    expect(states(paid, payment({ proofRecorded: true, check: 'verified' }))).toEqual(['requested:done', 'accepted:done', 'paid:done', 'verified:done', 'receipt:current']);
    expect(states(paid, payment({ proofRecorded: true, check: 'verified', receipt: 'sent' }))).toEqual([
      'requested:done',
      'accepted:done',
      'paid:done',
      'verified:done',
      'receipt:done',
    ]);
  });

  it('marks the payer verified only when the receipt arrives', () => {
    const paid = facts({ role: 'payer', accepted: true, state: 'proof-submitted' });
    expect(states(paid, payment({ proofRecorded: true }))).toEqual(['requested:done', 'accepted:done', 'paid:done', 'verified:current', 'receipt:todo']);
    expect(states(paid, payment({ proofRecorded: true, receipt: 'received' }))).toEqual([
      'requested:done',
      'accepted:done',
      'paid:done',
      'verified:done',
      'receipt:done',
    ]);
  });

  it('stops where the request stopped', () => {
    expect(states(facts({ state: 'rejected' }))).toEqual(['requested:done', 'accepted:ended']);
    expect(states(facts({ state: 'invalid' }))).toEqual(['requested:done', 'accepted:failed']);
    expect(states(facts({ state: 'canceled', accepted: true }), payment())).toEqual(['requested:done', 'accepted:done', 'paid:ended']);
    expect(states(facts({ state: 'proof-submitted', accepted: true }), payment({ proofRecorded: true, check: 'rejected', checkReason: 'Too little' }))).toEqual([
      'requested:done',
      'accepted:done',
      'paid:done',
      'verified:failed',
    ]);
  });

  it('keeps a payment made before a cancellation', () => {
    expect(states(facts({ state: 'canceled', accepted: true }), payment({ proofRecorded: true }))).toEqual([
      'requested:done',
      'accepted:done',
      'paid:done',
      'verified:current',
      'receipt:todo',
    ]);
  });
});

it('words a payment in flight', () => {
  expect(paymentWords(payment({ outgoing: 'broadcast' }), { role: 'payer', name: 'Ana' })).toBe('Paid, sending the proof');
  expect(paymentWords(payment({ proofRecorded: true, check: 'rejected' }), { role: 'payee', name: 'Ana' })).toBe("The payment didn't check out");
  expect(paymentWords(undefined, { role: 'payer', name: 'Ana' })).toBeUndefined();
});

describe('what counts as paid', () => {
  it('counts money that left (a proof, or our broadcast) as made', () => {
    expect(isPaymentMade(payment({ proofRecorded: true }))).toBe(true);
    expect(isPaymentMade(payment({ outgoing: 'broadcast' }))).toBe(true);
    expect(isPaymentMade(payment({ outgoing: 'proof-sent' }))).toBe(true);
    expect(isPaymentMade(payment({ outgoing: 'sending' }))).toBe(false);
    expect(isPaymentMade(payment({ outgoing: 'unknown' }))).toBe(false);
  });

  it('never offers to pay again while a payment may be under way, but does after one that never left', () => {
    expect(isPaymentHandled(payment({ outgoing: 'sending' }))).toBe(true);
    expect(isPaymentHandled(payment({ outgoing: 'unknown' }))).toBe(true);
    expect(isPaymentHandled(payment({ outgoing: 'not-sent' }))).toBe(false);
    expect(isPaymentHandled(payment())).toBe(false);
  });
});

it('says when a payment was made automatically', () => {
  expect(paymentWords(payment({ outgoing: 'sending', automatic: true }), { role: 'payer', name: 'Ana' })).toBe('Paying automatically…');
  expect(paymentWords(payment({ proofRecorded: true, automatic: true }), { role: 'payer', name: 'Ana' })).toBe("Paid automatically, waiting for Ana's receipt");
  expect(paymentWords(payment({ proofRecorded: true, check: 'verified', receipt: 'sent', automatic: true }), { role: 'payee', name: 'Ana' })).toBe('Paid automatically, receipt sent');
});
