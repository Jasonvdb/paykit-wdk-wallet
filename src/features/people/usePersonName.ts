// What to call a person, and whether they are one of your contacts. Every
// screen that names a person uses this (with ./PersonSeal for the face), so
// the same person reads the same everywhere. The rule is ./personName.ts.
import { useContacts, usePersonProfile } from '../../paykit';
import { personName, type PersonName } from './personName';

export type PersonNameInfo = PersonName & { isContact: boolean };

export function usePersonName(publicKey: string | undefined): PersonNameInfo {
  const contact = useContacts().find((c) => c.publicKey === publicKey);
  const hint = contact ? { displayName: contact.publishedName, imageUri: contact.imageUri } : undefined;
  const profile = usePersonProfile(publicKey, hint);
  if (!publicKey) return { name: '', source: 'key', isContact: false };
  return { ...personName({ publicKey, label: contact?.label, publishedName: profile.displayName }), isContact: !!contact };
}
