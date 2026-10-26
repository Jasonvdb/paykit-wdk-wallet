// Activity detail's Phase 5 slot: the payment request a transaction paid
// and its receipt.
//
// A transaction is linked to a request through the request's payment
// proof, which names the transaction hash (useRequestLinks in
// src/paykit/hooks.ts), or through a payment of ours still in flight. The
// receipt is the payee's: retrieved and decrypted on the payer's side,
// issued after the on-chain check on the payee's side.
import { StyleSheet, View } from 'react-native';

import { useRequestLinks, type RequestLink } from '../../../paykit';
import { DetailRow, Divider, Row, Text, space } from '../../../ui';
import type { ActivityItem } from '../../../wallet';
import { PersonSeal } from '../../people/PersonSeal';
import { usePersonName } from '../../people/usePersonName';

/** The row subtitle's words for a transaction that paid a request ("Paid Ana's request", "Receipt from Ana"). */
export function requestLinkWords(link: RequestLink, name: string): string {
  if (link.role === 'payer') return link.receipt === 'received' ? `Receipt from ${name}` : `Paid ${name}'s request`;
  if (link.receipt === 'sent') return 'Paid your request, receipt sent';
  if (link.check === 'rejected') return "Paid your request, didn't check out";
  return link.check === 'verified' ? 'Paid your request, checked on chain' : 'Paid your request, checking on chain';
}

export function useRequestLinkFor(item: ActivityItem): RequestLink | undefined {
  return useRequestLinks().get(item.hash.toLowerCase());
}

export function ActivityPaykitLinks({ item, onOpenRequest }: { item: ActivityItem; onOpenRequest: (link: RequestLink) => void }) {
  const link = useRequestLinkFor(item);
  const { name } = usePersonName(link?.counterparty);
  if (!link) return null;
  const payer = link.role === 'payer';
  return (
    <View style={styles.root} testID="activity-request-links">
      <Text variant="heading">Payment request</Text>
      <Row
        title={payer ? `${name}'s request` : `Your request to ${name}`}
        subtitle={link.period ? 'One payment of a recurring request' : 'Paid with this transaction'}
        leading={<PersonSeal pubky={link.counterparty} size={36} />}
        onPress={() => onOpenRequest(link)}
        testID="activity-request-link"
      />
      <Divider />
      <DetailRow
        label="Receipt"
        value={
          payer
            ? link.receipt === 'received'
              ? `Receipt from ${name}`
              : `Waiting for ${name} to check it and send a receipt`
            : link.receipt === 'sent'
              ? `Receipt sent to ${name}`
              : link.check === 'rejected'
                ? "The payment didn't check out: no receipt"
                : 'Sent once the payment is checked on chain'
        }
        testID="activity-receipt"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginBottom: space.xl, gap: space.xs },
});
