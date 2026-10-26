// EXTENSION POINT — Phase 5 (payment requests and receipts) fills this in.
//
// What belongs here:
// - Propose one-time and recurring requests (`proposePaymentRequest`),
//   accept / reject / cancel them, pay them (`prepareAndResolvePrivatePaymentRequest`
//   + the wallet's send), submit proofs (`submitPaymentProof`), verify
//   on chain (WDK `getTransaction` / `getTransactionReceipt`, allowed in
//   wdk.config.js) and issue / retrieve receipts.
// - The inbox is already in the observeState snapshot
//   (`usePaykitState().paymentRequests`, `.receipts`), refreshed every sync
//   round. Add a round hook if requests need work each round (e.g. due
//   recurring periods):
//     service.syncLoop.addRoundHook('payment-requests', async (ctx) => { ... })
//
// Amounts at this boundary are Paykit decimal strings; convert with
// toPaykitDecimal / fromPaykitDecimal (src/wallet/amounts.ts). Run every SDK
// call through `service.call(label, task)` and flush the loop after a user
// action. Never log request records: they are not redacted in JS.
export {};
