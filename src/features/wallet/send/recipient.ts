// Who a send goes to, separate from how the person chose them.
//
// The Send screen only needs, per asset, the address to pay and a label to
// show on the review. Each way of choosing a recipient is its own field
// component that reports a SendRecipient (or undefined while the input is
// not usable):
//
//   Phase 2  AddressRecipientField  a pasted or typed address ('address')
//   Phase 3  PubkyRecipientField    a person's pubky, resolved to their public
//                                   endpoints ('pubky', route 'public')
//   Phase 4                         the same field, for a linked contact:
//                                   their private addresses ('pubky', route
//                                   'private', from privatePaymentAddressesFor)
//
// A new kind is only needed for a recipient that is neither an address nor
// a pubky; the review, send and success steps stay the same either way.
import type { AssetId } from '../../../wallet';

export type SendRecipient =
  | {
      kind: 'address';
      /** What review and success show in "To": the address. */
      label: string;
      /** Where each asset this recipient accepts should be paid. */
      addresses: Partial<Record<AssetId, string>>;
    }
  | {
      kind: 'pubky';
      /** Their published name, or their shortened pubky. */
      label: string;
      publicKey: string;
      /**
       * Which of their endpoints the addresses came from: 'public' (anyone
       * can read them) or 'private' (shared only with you, as a linked
       * contact).
       */
      route: 'public' | 'private';
      /** Only the assets they accept; a missing asset cannot be sent. */
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
