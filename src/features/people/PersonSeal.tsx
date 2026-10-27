// A person's seal with their profile photo inside it, when they published
// one. The seal itself (src/ui/seal) is pure drawing; this wrapper adds the
// photo from the Paykit profile cache, so every screen that shows a person
// shows the same face without fetching it again.
//
// The ring follows your private link with them (docs/DESIGN.md, "The
// seal") wherever the seal appears: a request row, an activity row or the
// Send review shows the same ring as People. Without a ring, the edge of
// the tile pattern reads as a dashed ring, which says "still connecting"
// for a contact who is linked. A caller passes `ring` only to override it
// (Welcome's demo seals, a preview).
import { usePersonProfile, useLinkState, type PersonProfile } from '../../paykit';
import { Seal, sealRingFor, type SealProps } from '../../ui';

export type PersonSealProps = Omit<SealProps, 'imageUri'> & {
  /** What the caller already knows about the profile (a contact record), shown until the cache has more. */
  profileHint?: PersonProfile;
};

export function PersonSeal({ profileHint, ring, ...seal }: PersonSealProps) {
  const { image } = usePersonProfile(seal.pubky, profileHint);
  const linkState = useLinkState(seal.pubky);
  return <Seal {...seal} ring={ring ?? sealRingFor(linkState)} imageUri={image} />;
}
