// Why a sign-up failed, in words a person can act on.
//
// PaykitSessionBootstrap.signUp does two things in a row
// (paykit-sdk/src/pubky_session.rs, `sign_up`):
//
//   1. create the account on the homeserver with the invite code
//      (`ensure_pubky_account`). If the account exists already (HTTP 409),
//      it republishes the identity's homeserver record instead;
//   2. sign in to that account (`sign_in`: start, approve and complete a
//      Pubky grant auth flow over the auth relay).
//
// Every failure is an Identity error and the HTTP cause is dropped at the
// FFI boundary, so "this code was used" and "this code is mistyped" look
// the same. What survives is the step that failed, as the error's context
// string. That is enough to tell the three cases apart:
//
//   'code-refused'     step 1 failed: the homeserver didn't create the
//                      account. A used or mistyped code, or no connection.
//   'already-exists'   step 1 found an existing account but couldn't
//                      republish its record. The phrase has an identity:
//                      sign in instead.
//   'not-signed-in'    step 1 worked, step 2 didn't. The code is spent
//                      and the account exists: sign in, no new code.
//
// The context strings are the SDK's own, at the commit build-paykit.sh
// pins. If a later SDK changes them, everything falls back to 'unknown'
// and the screen shows the generic message, which is still true.
//
// Pure (no SDK import), so it is unit tested; errors.ts passes it the tag
// and context of a PaykitFfiError.

export type SignUpFailure = 'code-refused' | 'already-exists' | 'not-signed-in' | 'unknown';

const ACCOUNT_CREATION = 'sign up Pubky identity';
const RECORD_REPUBLISH = 'restore Pubky homeserver record';
const SIGN_IN_STEPS = new Set([
  'start Pubky auth flow',
  'approve Pubky auth flow',
  'complete Pubky auth flow',
  'resolve Pubky homeserver record',
  'resolve Pubky identity record',
]);

export function signUpFailureFrom(tag: string | undefined, context: string | undefined): SignUpFailure {
  if (tag !== 'Identity' || context === undefined) return 'unknown';
  if (context === ACCOUNT_CREATION) return 'code-refused';
  if (context === RECORD_REPUBLISH) return 'already-exists';
  if (SIGN_IN_STEPS.has(context)) return 'not-signed-in';
  return 'unknown';
}

/** The sentence the invite code screen shows, or undefined for the screen's generic message. */
export function signUpFailureMessage(failure: SignUpFailure): string | undefined {
  switch (failure) {
    case 'code-refused':
      return "The server didn't create your identity. The invite code may be mistyped or already used (each code works once), or the server couldn't be reached. Check the code and your connection, then try again.";
    case 'already-exists':
      return 'This phrase already has an identity, so it needs no invite code. Sign in instead.';
    case 'not-signed-in':
      return "Your identity was created, but signing in didn't finish. Sign in to try again. The invite code is used up, and you don't need another one.";
    default:
      return undefined;
  }
}

/** After these failures the identity exists: the screen switches to signing in. */
export function identityExistsAfter(failure: SignUpFailure): boolean {
  return failure === 'already-exists' || failure === 'not-signed-in';
}
