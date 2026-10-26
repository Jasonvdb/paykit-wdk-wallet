// Paykit error helpers: classify errors and describe them safely.
//
// The SDK throws `PaykitFfiError` with a tag (Transport, NotFound, ...) and
// `{ code, context }`. Codes and tags are safe to log and show in the
// developer log; the context is a short redacted string from the SDK.
// Anything else (a plain Error) is described by its message only.
//
// Two audiences, two functions:
// - describeError: tag/code/context for the event log (You > Sync status).
// - userMessageFor: a plain sentence with a next step, for screens. Raw
//   codes and the word "Paykit" stay out of the main UI (docs/DESIGN.md).
import { PaykitFfiError, PaykitFfiError_Tags } from '@synonymdev/react-native-paykit';

import { CallTimeoutError } from './callQueue';
import { signUpFailureFrom, type SignUpFailure } from './signUpErrors';

/** An error whose message was written for people. Screens show it as is. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

/** A short, secret-free description of an error for logs and the event log. */
export function describeError(error: unknown): string {
  if (PaykitFfiError.instanceOf(error)) {
    return `${error.tag}/${error.inner.code}: ${error.inner.context}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * What to tell people when something failed. `fallback` says what failed in
 * this screen's words ("Couldn't sign in. Try again in a minute.").
 */
export function userMessageFor(error: unknown, fallback: string): string {
  if (error instanceof UserFacingError) return error.message;
  if (error instanceof CallTimeoutError) return 'That took too long. Check your connection and try again.';
  switch (paykitErrorTag(error)) {
    case PaykitFfiError_Tags.Transport:
      return "Can't reach the server right now. Check your connection and try again.";
    case PaykitFfiError_Tags.SharedStateBusy:
    case PaykitFfiError_Tags.ConcurrentUpdate:
      return 'Still finishing another change. Try again in a moment.';
    default:
      return fallback;
  }
}

export function paykitErrorTag(error: unknown): PaykitFfiError_Tags | undefined {
  return PaykitFfiError.instanceOf(error) ? error.tag : undefined;
}

/** SharedStateBusy means "a state transaction is in progress; try again shortly". */
export function isRetryablePaykitError(error: unknown): boolean {
  return paykitErrorTag(error) === PaykitFfiError_Tags.SharedStateBusy;
}

/** Callbacks must throw PaykitFfiError only; wrap anything else as a Storage error. */
export function asCallbackError(error: unknown, code: string, context: string): unknown {
  if (PaykitFfiError.instanceOf(error)) return error;
  return new PaykitFfiError.Storage({ code, context });
}

/** Which step of a sign-up failed (./signUpErrors.ts), read from the error's tag and context. */
export function signUpFailureOf(error: unknown): SignUpFailure {
  return PaykitFfiError.instanceOf(error) ? signUpFailureFrom(error.tag, error.inner.context) : 'unknown';
}
