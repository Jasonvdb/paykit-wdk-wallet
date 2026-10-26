// Paykit error helpers: classify errors and describe them safely.
//
// The SDK throws `PaykitFfiError` with a tag (Transport, NotFound, ...) and
// `{ code, context }`. Codes and tags are safe to log and show in the
// developer log; the context is a short redacted string from the SDK.
// Anything else (a plain Error) is described by its message only.
import { PaykitFfiError, PaykitFfiError_Tags } from '@synonymdev/react-native-paykit';

import { CallTimeoutError } from './callQueue';

/** A short, secret-free description of an error for logs and the event log. */
export function describeError(error: unknown): string {
  if (PaykitFfiError.instanceOf(error)) {
    return `${error.tag}/${error.inner.code}: ${error.inner.context}`;
  }
  if (error instanceof CallTimeoutError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export function paykitErrorTag(error: unknown): PaykitFfiError_Tags | undefined {
  return PaykitFfiError.instanceOf(error) ? error.tag : undefined;
}

/** SharedStateBusy means "a state transaction is in progress; try again shortly". */
export function isRetryablePaykitError(error: unknown): boolean {
  return paykitErrorTag(error) === PaykitFfiError_Tags.SharedStateBusy;
}

/** Network trouble: says nothing about whether an account or record exists. */
export function isTransportError(error: unknown): boolean {
  return paykitErrorTag(error) === PaykitFfiError_Tags.Transport;
}

/** The peer has not published what we need yet (usually: not onboarded to Paykit). */
export function isNotFoundError(error: unknown): boolean {
  return paykitErrorTag(error) === PaykitFfiError_Tags.NotFound;
}

/** Callbacks must throw PaykitFfiError only; wrap anything else as a Storage error. */
export function asCallbackError(error: unknown, code: string, context: string): unknown {
  if (PaykitFfiError.instanceOf(error)) return error;
  return new PaykitFfiError.Storage({ code, context });
}
