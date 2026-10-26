// The four ring states of a seal (docs/DESIGN.md, "The seal").
//
//   none         not a contact: no ring
//   linking      contact, handshake running: dashed Seal ring, rotating slowly
//   linked       solid Seal ring plus a closed-envelope badge
//   unreachable  peer unreachable or blocked: dashed Graphite ring
export type SealRing = 'none' | 'linking' | 'linked' | 'unreachable';
