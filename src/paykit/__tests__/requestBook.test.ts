// The wallet's own notes about requests, persisted in the app store.
import { RequestBook, paymentKey, type OutgoingPayment } from '../requestBook';

function memoryStore() {
  const data = new Map<string, string>();
  return { getString: (key: string) => data.get(key), set: (key: string, value: string) => void data.set(key, value) };
}

const payment: OutgoingPayment = {
  counterparty: 'pubkyben',
  requestId: 'r1',
  asset: 'btc',
  amount: '10000',
  address: 'tb1q',
  endpointIdentifier: 'btc-mutinynet-p2wpkh',
  paymentAppId: 'wdk-paykit-demo',
  attemptId: 'a1',
  stage: 'sending',
  updatedAt: 1,
};

it('keys one-time requests and periods apart', () => {
  expect(paymentKey('ben', 'r1')).toBe('ben|r1|');
  expect(paymentKey('ben', 'r1', { startsAt: '2026-10-26T12:00:00.000Z', endsAt: '2026-10-26T12:01:00Z' })).toBe('ben|r1|2026-10-26T12:00:00Z');
});

it('keeps payments in flight across restarts', () => {
  const store = memoryStore();
  const book = new RequestBook(store);
  book.setOutgoing('k', payment);
  book.updateOutgoing('k', { stage: 'broadcast', txHash: 'ab' });
  const reopened = new RequestBook(store);
  expect(reopened.outgoing('k')).toMatchObject({ stage: 'broadcast', txHash: 'ab', attemptId: 'a1' });
  reopened.forgetOutgoing('k');
  expect(new RequestBook(store).outgoing('k')).toBeUndefined();
});

it('claims a transfer for the payment it verified', () => {
  const book = new RequestBook(memoryStore());
  book.setCheck('k1', { status: 'pending', proofEventId: 'e1', transferKey: 'bitcoin:ab', checkedAt: 0, nextCheckAt: 0 });
  expect(book.claimedBy('bitcoin:ab')).toBeUndefined();
  book.updateCheck('k1', { status: 'verified' });
  expect(book.claimedBy('bitcoin:ab')).toBe('k1');
});

it('notifies listeners and survives unreadable storage', () => {
  const store = memoryStore();
  store.set('payment-requests-v1', '{not json');
  const book = new RequestBook(store);
  const listener = jest.fn();
  book.subscribe(listener);
  book.setDeferred('k', 5);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(book.isDeferred('k')).toBe(true);
  expect(book.getRevision()).toBe(1);
});
