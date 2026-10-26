// The synchronous address cache behind the Paykit payment adapter.
//
// Why it exists: Paykit calls the payment adapter synchronously on the JS
// thread while a Rust worker waits for the answer. WDK derives addresses in
// its worklet and answers asynchronously, so the adapter can never ask WDK.
// Instead the app derives addresses ahead of time (src/paykit/
// PaykitProvider.tsx does this through WDK hooks) and stores them here; the
// adapter only reads.
//
// Account model (docs/research/06-critic.md §4.1):
// - Public endpoints: BTC account 0 and EVM account 0. Index 0 is also the
//   spending account for every send.
// - Private endpoints per contact: a stable BTC account index allocated per
//   contact (1, 2, 3, ...), so incoming BTC is attributable to that contact,
//   plus the shared EVM account 0 (each EVM index would need its own gas).
//   "Collect" moves contact BTC accounts back to account 0.
//
// The contact -> account index map is persisted (injected key-value store)
// and indices are never reused, even if a contact is removed: a removed and
// re-added contact gets its old index back, and nobody else ever gets it.
// This file has no native imports and is unit tested.
import { btcReceivingDetail, usdtReceivingDetail, type ReceivingDetail } from './endpoints';

/** The subset of MMKV this cache needs. */
export interface StringStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

const CONTACT_ACCOUNTS_KEY = 'contact-btc-accounts-v1';

/** BTC account 0 is the public and spending account; contacts start here. */
export const FIRST_CONTACT_BTC_ACCOUNT = 1;

type PersistedContactAccounts = {
  /** Next index to hand out. Only ever grows. */
  next: number;
  /** Normalized pubky -> BTC account index. */
  accounts: Record<string, number>;
};

export type PublicAddresses = { btc?: string; evm?: string };

type Listener = () => void;

export class ReceivingAddressCache {
  private publicAddresses: PublicAddresses = {};
  private readonly btcAddresses = new Map<number, string>();
  private contactAccounts: PersistedContactAccounts;
  private readonly changeListeners = new Set<Listener>();
  private readonly missingListeners = new Set<(pubky: string, accountIndex: number) => void>();

  constructor(private readonly store: StringStore) {
    this.contactAccounts = this.load();
  }

  private load(): PersistedContactAccounts {
    const text = this.store.getString(CONTACT_ACCOUNTS_KEY);
    if (!text) return { next: FIRST_CONTACT_BTC_ACCOUNT, accounts: {} };
    try {
      const parsed = JSON.parse(text) as PersistedContactAccounts;
      const used = Object.values(parsed.accounts ?? {});
      const next = Math.max(parsed.next ?? FIRST_CONTACT_BTC_ACCOUNT, FIRST_CONTACT_BTC_ACCOUNT, ...used.map((i) => i + 1));
      return { next, accounts: { ...(parsed.accounts ?? {}) } };
    } catch {
      // A corrupt map must not silently restart at 1: that could hand a
      // second contact an address the first one already knows.
      throw new Error('Contact account map is unreadable');
    }
  }

  private persist(): void {
    this.store.set(CONTACT_ACCOUNTS_KEY, JSON.stringify(this.contactAccounts));
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) listener();
  }

  /** Called whenever addresses or the contact map change. */
  subscribe(listener: Listener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /**
   * Called (asynchronously, never inside the adapter call) when the adapter
   * needed a contact's BTC address that has not been derived yet. The
   * provider derives it with WDK and calls `setBtcAddress`.
   */
  onMissingContactAddress(listener: (pubky: string, accountIndex: number) => void): () => void {
    this.missingListeners.add(listener);
    return () => this.missingListeners.delete(listener);
  }

  // Public (account 0) -------------------------------------------------------

  setPublicAddresses(addresses: PublicAddresses): void {
    if (addresses.btc === this.publicAddresses.btc && addresses.evm === this.publicAddresses.evm) return;
    this.publicAddresses = { ...addresses };
    if (addresses.btc) this.btcAddresses.set(0, addresses.btc);
    this.emitChange();
  }

  getPublicAddresses(): PublicAddresses {
    return this.publicAddresses;
  }

  /** What we publish as public payment endpoints. */
  publicReceivingDetails(): ReceivingDetail[] {
    const details: ReceivingDetail[] = [];
    if (this.publicAddresses.evm) details.push(usdtReceivingDetail(this.publicAddresses.evm));
    if (this.publicAddresses.btc) details.push(btcReceivingDetail(this.publicAddresses.btc));
    return details;
  }

  // Per-contact BTC accounts ---------------------------------------------------

  contactAccountIndex(pubky: string): number | undefined {
    return this.contactAccounts.accounts[pubky];
  }

  /** The contact's BTC account index, allocating (and persisting) one on first use. */
  ensureContactAccount(pubky: string): number {
    const existing = this.contactAccounts.accounts[pubky];
    if (existing !== undefined) return existing;
    const index = this.contactAccounts.next;
    this.contactAccounts = {
      next: index + 1,
      accounts: { ...this.contactAccounts.accounts, [pubky]: index },
    };
    this.persist();
    this.emitChange();
    return index;
  }

  /** All contacts that have a BTC account, for deriving addresses and balances. */
  allContactAccounts(): { pubky: string; accountIndex: number }[] {
    return Object.entries(this.contactAccounts.accounts)
      .map(([pubky, accountIndex]) => ({ pubky, accountIndex }))
      .sort((a, b) => a.accountIndex - b.accountIndex);
  }

  /** The contact whose BTC account has this address, if any. Used in Phase 4 to attribute incoming BTC. */
  contactForBtcAddress(address: string): string | undefined {
    for (const [pubky, index] of Object.entries(this.contactAccounts.accounts)) {
      if (this.btcAddresses.get(index) === address) return pubky;
    }
    return undefined;
  }

  setBtcAddress(accountIndex: number, address: string): void {
    if (this.btcAddresses.get(accountIndex) === address) return;
    this.btcAddresses.set(accountIndex, address);
    this.emitChange();
  }

  btcAddress(accountIndex: number): string | undefined {
    return this.btcAddresses.get(accountIndex);
  }

  /**
   * What we share privately with one contact: their own BTC address plus the
   * shared USD₮ address, or `undefined` if either is not known yet.
   *
   * Never a partial list: Paykit treats every Private Payment List as
   * complete, so a list without BTC would remove BTC from what the contact
   * sees, and an empty one would clear it. When something is missing, the
   * caller fails this round and a later round retries; a missing contact
   * address is also reported to the missing-address listeners (on a later
   * tick) so the provider derives it.
   *
   * Synchronous and side-effect free apart from allocating the index, so it
   * is safe inside a Paykit callback.
   */
  privateReceivingDetails(pubky: string): ReceivingDetail[] | undefined {
    const accountIndex = this.ensureContactAccount(pubky);
    const btc = this.btcAddresses.get(accountIndex);
    if (!btc) {
      // Never call back into Paykit or WDK from here; just schedule the work.
      setTimeout(() => {
        for (const listener of this.missingListeners) listener(pubky, accountIndex);
      }, 0);
    }
    const evm = this.publicAddresses.evm;
    if (!btc || !evm) return undefined;
    return [usdtReceivingDetail(evm), btcReceivingDetail(btc)];
  }
}
