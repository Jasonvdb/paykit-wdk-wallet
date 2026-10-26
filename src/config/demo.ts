// Dev-only prefill for the two simulator identities.
//
// `npm run demo-env` writes the git-ignored demo.local.ts from .env.demo.
// It holds a mnemonic and a single-use signup code per platform, so it must
// never be committed, logged or shown on screen. When the file is missing
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
  if (!__DEV__) return {};
  try {
    // Metro treats a require inside try/catch as optional, so a missing
    // file is not a bundling error.
    return (require('./demo.local') as { default: DemoLocal }).default ?? {};
  } catch {
    return {};
  }
}

const local = loadDemoLocal();

export const demoPrefill: DemoPrefill =
  (Platform.OS === 'ios' ? local.ios : Platform.OS === 'android' ? local.android : undefined) ?? {};
