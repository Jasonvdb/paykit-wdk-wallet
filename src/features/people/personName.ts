// The one rule for what to call a person on screen (docs/ARCHITECTURE.md
// "Profiles and avatars"):
//
//   1. your own label for them (you typed it: trusted),
//   2. else the name they published (they typed it: a claim, not a fact),
//   3. else their shortened pubky.
//
// `source` says which one it is, so a payment review can tell "Ben, in your
// contacts" from "someone who calls themselves Ben". Pure; unit tested.
// The hook that feeds it is ./usePersonName.ts.
import { middleEllipsis } from '../../ui/format';

export type PersonName = {
  name: string;
  source: 'label' | 'profile' | 'key';
};

export function personName(input: { publicKey: string; label?: string; publishedName?: string }): PersonName {
  const label = input.label?.trim();
  if (label) return { name: label, source: 'label' };
  const published = input.publishedName?.trim();
  if (published) return { name: published, source: 'profile' };
  return { name: middleEllipsis(input.publicKey), source: 'key' };
}
