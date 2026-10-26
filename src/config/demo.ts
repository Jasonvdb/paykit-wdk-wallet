// Dev-only prefill for the two simulator identities.
//
// `npm run demo-env` writes the git-ignored demo.local.ts from .env.demo.
// It holds a mnemonic and a single-use signup code per platform, so it must
// never be committed, logged, shown on screen or shipped in a release bundle. When the file is missing
// (a fresh clone), the app simply has no prefill.
import { Platform } from 'react-native';

export type DemoPrefill = {
  mnemonic?: string;
  signupCode?: string;
  /** The other simulator's pubky (public), to prefill the peer field. */
  peerPubky?: string;
};

type DemoLocal = { ios?: DemoPrefill; android?: DemoPrefill };

function loadDemoLocal(): DemoLocal {
  // The require must sit INSIDE `if (__DEV__)`. Metro collects a bundle's
  // dependencies after inlining __DEV__ and folding constants: a dead
  // branch is removed with its require, so release bundles never contain
  // demo.local.ts. An early `if (!__DEV__) return {}` is not enough; the
  // code after it survives folding, and so would the secrets.
  if (__DEV__) {
    try {
      // Metro treats a require inside try/catch as optional, so a missing
      // file is not a bundling error.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional file, see above
      return (require('./demo.local') as { default: DemoLocal }).default ?? {};
    } catch {
      return {};
    }
  }
  return {};
}

const local = loadDemoLocal();

export const demoPrefill: DemoPrefill =
  (Platform.OS === 'ios' ? local.ios : Platform.OS === 'android' ? local.android : undefined) ?? {};
