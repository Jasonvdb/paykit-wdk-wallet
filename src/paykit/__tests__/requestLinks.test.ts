// Which transactions Activity links to a payment request: only payments we
// know about, never a hash someone merely named in a proof.
import { requestLinksOf } from '../requestLinks';
import type { OutgoingPayment, ProofCheck } from '../requestBook';
import type { ProofView, RequestView } from '../requests';

const BEN_TX = 'aa'.repeat(32);
const STRANGER_TX = 'bb'.repeat(32);

const proof = (overrides: Partial<ProofView>): ProofView => ({
  eventId: 'e1',
  paymentAppId: 'wdk-paykit-demo',
  endpointIdentifier: 'btc-mutinynet-p2wpkh',
  proofJson: '{}',
  ours: false,
  ...overrides,
});

const view = (overrides: Partial<RequestView>): RequestView => ({
  counterparty: 'pubkyben',
  requestId: 'r1',
  role: 'payee',
  state: 'proof-submitted',
  accepted: true,
  canceledByUs: false,
  proofs: [],
  ...overrides,
});

function bookWith(checks: Record<string, ProofCheck>, outgoing: OutgoingPayment[] = []) {
  return { check: (key: string) => checks[key], allOutgoing: () => outgoing };
}

const check = (status: ProofCheck['status'], txHash: string): ProofCheck => ({ status, proofEventId: 'e1', txHash, checkedAt: 1, nextCheckAt: 2 });

describe('requestLinksOf', () => {
  it('links a payment to us once our check verified it', () => {
    const links = requestLinksOf([view({ proofs: [proof({ txHash: BEN_TX })] })], bookWith({ 'pubkyben|r1|': check('verified', BEN_TX) }), new Set());
    expect(links.get(BEN_TX)).toMatchObject({ counterparty: 'pubkyben', role: 'payee' });
  });

  it("never links a proof that names someone else's transaction and didn't check out, or is still being checked", () => {
    const mallory = view({ counterparty: 'pubkymallory', proofs: [proof({ txHash: STRANGER_TX })] });
    expect(requestLinksOf([mallory], bookWith({ 'pubkymallory|r1|': check('rejected', STRANGER_TX) }), new Set()).size).toBe(0);
    expect(requestLinksOf([mallory], bookWith({ 'pubkymallory|r1|': check('pending', STRANGER_TX) }), new Set()).size).toBe(0);
    expect(requestLinksOf([mallory], bookWith({}), new Set()).size).toBe(0);
  });

  it("won't let a bogus proof replace a verified link for the same transaction", () => {
    const ben = view({ proofs: [proof({ txHash: BEN_TX })] });
    const mallory = view({ counterparty: 'pubkymallory', requestId: 'r2', proofs: [proof({ txHash: BEN_TX.toUpperCase() })] });
    const book = bookWith({ 'pubkyben|r1|': check('verified', BEN_TX), 'pubkymallory|r2|': check('rejected', BEN_TX) });
    expect(requestLinksOf([ben, mallory], book, new Set()).get(BEN_TX)?.counterparty).toBe('pubkyben');
    expect(requestLinksOf([mallory, ben], book, new Set()).get(BEN_TX)?.counterparty).toBe('pubkyben');
  });

  it('links our own payments: proofs we sent and payments in flight', () => {
    const ours = view({ role: 'payer', counterparty: 'pubkyana', proofs: [proof({ txHash: BEN_TX, ours: true })] });
    const inFlight = { counterparty: 'pubkyana', requestId: 'r9', txHash: STRANGER_TX } as OutgoingPayment;
    const links = requestLinksOf([ours], bookWith({}, [inFlight]), new Set(['pubkyana|r1|']));
    expect(links.get(BEN_TX)).toMatchObject({ role: 'payer', receipt: 'received' });
    expect(links.get(STRANGER_TX)).toMatchObject({ role: 'payer', requestId: 'r9' });
  });

  it('marks automatic payments: ours from the book or our proof, theirs from a verified proof that names an Allowance', () => {
    const ours = view({ role: 'payer', counterparty: 'pubkyana', proofs: [proof({ txHash: BEN_TX, ours: true, allowanceId: 'a1' })] });
    const inFlight = { counterparty: 'pubkyana', requestId: 'r9', txHash: STRANGER_TX, allowanceId: 'a1' } as OutgoingPayment;
    const links = requestLinksOf([ours], bookWith({}, [inFlight]), new Set());
    expect(links.get(BEN_TX)?.automatic).toBe(true);
    expect(links.get(STRANGER_TX)?.automatic).toBe(true);
    const theirs = view({ proofs: [proof({ txHash: BEN_TX, allowanceId: 'a1' })] });
    expect(requestLinksOf([theirs], bookWith({ 'pubkyben|r1|': check('verified', BEN_TX) }), new Set()).get(BEN_TX)?.automatic).toBe(true);
  });
});
