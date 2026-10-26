// Who a send goes to, separate from how the person chose them.
//
// The Send screen only needs, per asset, the address to pay and a label to
// show on the review. Each way of choosing a recipient is its own field
// component that reports a SendRecipient (or undefined while the input is
// not usable):
//
//   Phase 2  AddressRecipientField  a pasted or typed address ('address')
//   Phase 3  a pubky field          resolves public endpoints ('pubky')
//   Phase 4  a contact picker       private endpoints of a linked contact ('contact')
//
// Later phases add their `kind` to the union and their field next to
// AddressRecipientField; the review, send and success steps stay the same.
import type { AssetId } from '../../../wallet';

export type SendRecipient = {
  kind: 'address';
  /** What review and success show in "To": an address here, a person's name later. */
  label: string;
  /** Where each asset this recipient accepts should be paid. */
  addresses: Partial<Record<AssetId, string>>;
};

/** Props every recipient field takes. */
export type RecipientFieldProps = {
  /** The asset being sent: the field validates against its chain. */
  asset: AssetId;
  /** Prefill, e.g. from a deep link or a "Pay" button. */
  initialText?: string;
  onChange: (recipient: SendRecipient | undefined) => void;
};

export function addressRecipient(address: string, asset: AssetId): SendRecipient {
  return { kind: 'address', label: address, addresses: { [asset]: address } };
}
