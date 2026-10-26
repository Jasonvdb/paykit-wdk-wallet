// A person's seal with their profile photo inside it, when they published
// one. The seal itself (src/ui/seal) is pure drawing; this wrapper adds the
// photo from the Paykit profile cache, so every screen that shows a person
// shows the same face without fetching it again.
import { usePersonProfile, type PersonProfile } from '../../paykit';
import { Seal, type SealProps } from '../../ui';

export type PersonSealProps = Omit<SealProps, 'imageUri'> & {
  /** What the caller already knows about the profile (a contact record), shown until the cache has more. */
  profileHint?: PersonProfile;
};

export function PersonSeal({ profileHint, ...seal }: PersonSealProps) {
  const { image } = usePersonProfile(seal.pubky, profileHint);
  return <Seal {...seal} imageUri={image} />;
}
