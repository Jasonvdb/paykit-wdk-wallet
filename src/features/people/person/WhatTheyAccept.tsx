// What a contact accepts, and how private it is:
//
//   Public                 what anyone can pay them in by pubky (their
//                          public endpoints, read live)
//   Private addresses      what they shared with you over the private
//   shared with you        connection (their Private Payment List). Send
//                          uses these first.
//   Your private addresses what your list for them says, and whether it
//   shared with them       reached them (the sync loop shares it).
//
// The private rows come from the sync loop's record of lists
// (usePrivateLists); opening the page also reads their list again.
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import {
  describeError,
  loadReceivedPrivateList,
  resolvePublicPaymentOptions,
  usePaykit,
  usePrivateLists,
  type LinkState,
  type PublicPaymentOptions,
} from '../../../paykit';
import { DetailRow, Divider, relativeTime } from '../../../ui';
import { incomingListWords, outgoingListWords, publicAcceptsWords } from './personWords';

export function WhatTheyAccept({ publicKey, name, linkState }: { publicKey: string; name: string; linkState: LinkState }) {
  const { service, log } = usePaykit();
  const { incoming, outgoing } = usePrivateLists(publicKey);
  const [publicOptions, setPublicOptions] = useState<PublicPaymentOptions | 'failed'>();

  useEffect(() => {
    if (!service) return;
    let cancelled = false;
    resolvePublicPaymentOptions(service, publicKey)
      .then(({ options }) => !cancelled && setPublicOptions(options))
      .catch((e) => {
        log.warn(`what they accept: ${describeError(e)}`);
        if (!cancelled) setPublicOptions('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [service, publicKey, log]);

  // Read their private list again whenever the page opens on a linked contact.
  const linked = linkState === 'linked';
  useEffect(() => {
    if (!service || !linked) return;
    loadReceivedPrivateList(service, publicKey, 'background').catch((e) => log.warn(`read private list: ${describeError(e)}`));
  }, [service, publicKey, linked, log]);

  const fromThem = incomingListWords(linkState, incoming, name);
  const fromYou = outgoingListWords(linkState, outgoing);
  const receivedAt = incoming?.receivedAt ? Date.parse(incoming.receivedAt) : undefined;
  const sharedAt = outgoing?.state === 'shared' ? outgoing.at : undefined;

  return (
    <View testID="person-accepts">
      <DetailRow
        label="From anyone, by pubky"
        value={publicOptions === undefined ? 'Checking…' : publicOptions === 'failed' ? `Couldn't load what ${name} publishes right now.` : publicAcceptsWords(publicOptions, name)}
        testID="person-accepts-public"
      />
      <Divider />
      <DetailRow
        label="Private addresses shared with you"
        value={fromThem.text}
        hint={[fromThem.hint, receivedAt && !Number.isNaN(receivedAt) ? `Updated ${relativeTime(receivedAt).toLowerCase()}` : undefined].filter(Boolean).join(' ') || undefined}
        testID="person-private-incoming"
      />
      <Divider />
      <DetailRow
        label="Your private addresses shared with them"
        value={fromYou.text}
        hint={[fromYou.hint, sharedAt ? `Shared ${relativeTime(sharedAt).toLowerCase()}` : undefined].filter(Boolean).join(' ') || undefined}
        testID="person-private-outgoing"
      />
    </View>
  );
}
