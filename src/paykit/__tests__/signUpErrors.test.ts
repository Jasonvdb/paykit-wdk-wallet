// Which sign-up step failed, from the SDK's Identity error context
// (paykit-sdk/src/pubky_session.rs at the pinned commit).
import { identityExistsAfter, signUpFailureFrom, signUpFailureMessage } from '../signUpErrors';

describe('signUpFailureFrom', () => {
  it('tells a refused invite code from a sign-in that did not finish', () => {
    expect(signUpFailureFrom('Identity', 'sign up Pubky identity')).toBe('code-refused');
    expect(signUpFailureFrom('Identity', 'restore Pubky homeserver record')).toBe('already-exists');
    expect(signUpFailureFrom('Identity', 'start Pubky auth flow')).toBe('not-signed-in');
    expect(signUpFailureFrom('Identity', 'approve Pubky auth flow')).toBe('not-signed-in');
    expect(signUpFailureFrom('Identity', 'complete Pubky auth flow')).toBe('not-signed-in');
  });

  it('falls back to unknown for anything else', () => {
    expect(signUpFailureFrom('Transport', 'sign up Pubky identity')).toBe('unknown');
    expect(signUpFailureFrom('Identity', 'something new')).toBe('unknown');
    expect(signUpFailureFrom(undefined, undefined)).toBe('unknown');
  });
});

describe('signUpFailureMessage', () => {
  it('has a sentence with a next step for each known cause, none for unknown', () => {
    expect(signUpFailureMessage('code-refused')).toMatch(/mistyped or already used/);
    expect(signUpFailureMessage('already-exists')).toMatch(/Sign in instead/);
    expect(signUpFailureMessage('not-signed-in')).toMatch(/Sign in to try again/);
    expect(signUpFailureMessage('unknown')).toBeUndefined();
  });

  it('switches to signing in only when the identity exists', () => {
    expect(identityExistsAfter('code-refused')).toBe(false);
    expect(identityExistsAfter('already-exists')).toBe(true);
    expect(identityExistsAfter('not-signed-in')).toBe(true);
    expect(identityExistsAfter('unknown')).toBe(false);
  });
});
