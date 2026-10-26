// Person (pushed): their seal and name, the link state, what they accept
// (public / private), Pay, Request, history with them, Block / Forget.
//
// Phase 1 shows the seal with its live ring, the link state and the key.
// When the link closes while this screen is open, the seal plays its
// closing animation.
//
// TODO(Phase 4 — Contacts): profile and avatar, what they accept
// (public endpoints vs private list), Pay (Send with `to`), Request
// (RequestMoney), history, Block / Forget with confirmation, collect BTC
// from their account (useBtcContactAccount).
import { StyleSheet, View } from 'react-native';

import type { RootScreenProps } from '../../navigation/types';
import { useContacts, useLinkState } from '../../paykit';
import { KeyText, PushedScreen, Seal, Text, linkStateWords, middleEllipsis, sealRingFor, space } from '../../ui';

export function PersonScreen({ navigation, route }: RootScreenProps<'Person'>) {
  const { pubky } = route.params;
  const linkState = useLinkState(pubky);
  const contact = useContacts().find((c) => c.publicKey === pubky);

  return (
    <PushedScreen onBack={() => navigation.goBack()} testID="person-screen">
      <View style={styles.body}>
        <Seal pubky={pubky} size={112} ring={sealRingFor(linkState)} testID="person-seal" />
        <Text variant="title">{contact?.name ?? middleEllipsis(pubky)}</Text>
        <Text color={linkState === 'linked' ? 'seal' : 'graphite'} testID="person-link-state">
          {linkStateWords(linkState)}
        </Text>
        <KeyText value={pubky} full small />
      </View>
    </PushedScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.l, alignItems: 'flex-start' },
});
