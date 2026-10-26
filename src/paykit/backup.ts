// Backing up and restoring contacts, private connections, payment requests
// and receipts: the Paykit state that the recovery phrase can't bring back.
//
// What the recovery phrase restores: the money (WDK derives every account
// from it) and the Pubky identity (Paykit derives the key from it). What it
// can't: everything that lives only on this phone, which is the Paykit
// SDK's state (contacts and labels, Encrypted Links, Private Payment Lists,
// requests, proofs, receipts, allowances and the payment ledger) and the
// app's own notes about it (each contact's Bitcoin account index, the
// request book, the public endpoint switches). This module backs those up.
//
// The SDK's backup is exportBackupString: plain hex, NOT encrypted (the
// SDK leaves that to the app; exportBackupState is the same bytes as an
// object). The service seals it with a key from the recovery phrase
// (./backupCrypto.ts has the details), so the phrase alone opens it. The
// person keeps the sealed text wherever they like (Copy or Share); the app
// never stores, logs or shows it.
//
// Three operations:
//   exportBackup   seal the SDK backup and the app keys; remember when and
//                  the backup revision (backupStateRevision) at that time
//   checkBackup    open a backup and restore it into a throwaway SDK handle
//                  with an in-memory store (PaykitService.inScratchState),
//                  then count what it holds. Nothing on this phone changes:
//                  this is how a backup is verified without wiping the
//                  identity that made it.
//   applyBackup    the real restore, during onboarding: restoreBackupString
//                  into this identity's fresh state (the SDK refuses to
//                  restore over existing state), then the app keys.
//
// Restores use FfiRestoredLinkPolicy.RequireRecovery: a backup may be older
// than the last message this identity sent, and resuming an Encrypted Link
// from a stale snapshot would reuse a transport key and nonce. Every linked
// contact comes back as "Reconnecting privately…" and the sync loop forms
// a fresh link (ensureLinkWithPeer). Messages the backup had not received
// yet are not read from the old link.
//
// The payment ledger always needs reconciling after a restore; requests.ts
// does that before the next payment (an empty history never erases what
// the backup brought back).
import * as Crypto from 'expo-crypto';
import { FfiRestoredLinkPolicy, type FfiPaykitSdkInterface } from '@synonymdev/react-native-paykit';

import { CONTACT_ACCOUNTS_KEY, PUBLIC_ENDPOINT_CHOICE_KEY, type StringStore } from './addressCache';
import { asciiJson, buildEnvelope, readEnvelope, type BackupEnvelope } from './backupCrypto';
import type { PaykitService } from './PaykitService';
import { BOOK_KEY } from './requestBook';

/** App store keys that travel with the backup. Nothing else is read from or written by one. */
export const BACKUP_APP_KEYS = [CONTACT_ACCOUNTS_KEY, PUBLIC_ENDPOINT_CHOICE_KEY, BOOK_KEY] as const;
const META_KEY = 'backup-meta-v1';

/** The last backup made on this phone. */
export type BackupMeta = { exportedAt: number; revision: string };

export type BackupStatus = {
  /** backupStateRevision: a fingerprint of what a backup would hold now. */
  revision: string;
  /**
   * observedBackupStateRevision: only for the SDK's shared-state storage
   * mode. This app keeps state on the phone (callback storage), so the SDK
   * returns nothing; shown in Network details for completeness.
   */
  observedRevision?: string;
  lastBackup?: BackupMeta;
  changedSinceBackup: boolean;
};

/** What a backup holds, counted after restoring it (into a throwaway store, or for real). */
export type BackupSummary = {
  createdAt?: string;
  contacts: number;
  requests: number;
  receipts: number;
  /** Contacts whose private connection forms again after a restore. */
  reconnecting: number;
};

function readMeta(store: StringStore): BackupMeta | undefined {
  try {
    const meta = JSON.parse(store.getString(META_KEY) ?? 'null') as BackupMeta | null;
    return meta && typeof meta.exportedAt === 'number' && typeof meta.revision === 'string' ? meta : undefined;
  } catch {
    return undefined;
  }
}

export async function readBackupStatus(service: PaykitService): Promise<BackupStatus> {
  const revision = await service.call('backupStateRevision', (sdk, signal) => sdk.backupStateRevision({ signal }), 'background');
  const observed = await service.call('observedBackupStateRevision', async (sdk) => sdk.observedBackupStateRevision(), 'background');
  const lastBackup = readMeta(service.appStore);
  return { revision, observedRevision: observed?.backupRevision, lastBackup, changedSinceBackup: lastBackup?.revision !== revision };
}

/**
 * Make a sealed backup of this identity's Paykit state and the app keys.
 * Returns the text to copy or share. It is never stored or logged here.
 */
export async function exportBackup(service: PaykitService): Promise<string> {
  const revision = await service.call('backupStateRevision', (sdk, signal) => sdk.backupStateRevision({ signal }));
  const paykit = await service.call('exportBackupString', (sdk, signal) => sdk.exportBackupString({ signal }));
  const app: Record<string, string> = {};
  for (const key of BACKUP_APP_KEYS) {
    const value = service.appStore.getString(key);
    if (value !== undefined) app[key] = value;
  }
  const now = Date.now();
  const envelope = buildEnvelope({ createdAtMs: now, publicKey: service.publicKey, paykit, app });
  const text = service.sealBackup(asciiJson(envelope), Crypto.getRandomBytes(24));
  service.appStore.set(META_KEY, JSON.stringify({ exportedAt: now, revision } satisfies BackupMeta));
  service.log.info(`made a backup (revision ${revision.slice(0, 8)})`);
  return text;
}

/**
 * Open a backup and restore it into a throwaway SDK handle (in-memory
 * store, same identity and session), then count what came back. Proves the
 * backup opens with this phrase and the SDK accepts it, without changing
 * anything on this phone. Throws BackupOpenError or the SDK's error.
 */
export async function checkBackup(service: PaykitService, text: string): Promise<BackupSummary> {
  const envelope = readEnvelope(service.openBackup(text), service.publicKey, BACKUP_APP_KEYS);
  const summary = await service.inScratchState('checkBackup', (sdk, signal) => restoreAndCount(sdk, signal, envelope));
  service.log.info(`checked a backup: ${summary.contacts} contacts, ${summary.requests} requests, ${summary.receipts} receipts`);
  return summary;
}

/**
 * The real restore (PaykitService.connect, during onboarding, before the
 * sync loop starts): the SDK state first, then the app keys. The SDK
 * refuses to restore over existing state, so a phone that already has
 * this identity's contacts keeps them.
 */
export async function applyBackup(
  run: <T>(label: string, task: (sdk: FfiPaykitSdkInterface, signal: AbortSignal) => Promise<T>) => Promise<T>,
  envelope: BackupEnvelope,
  appStore: StringStore,
): Promise<BackupSummary> {
  const summary = await run('restoreBackupString', (sdk, signal) => restoreAndCount(sdk, signal, envelope));
  for (const [key, value] of Object.entries(envelope.app)) appStore.set(key, value);
  return summary;
}

async function restoreAndCount(sdk: FfiPaykitSdkInterface, signal: AbortSignal, envelope: BackupEnvelope): Promise<BackupSummary> {
  const report = await sdk.restoreBackupString(envelope.paykit, FfiRestoredLinkPolicy.RequireRecovery, { signal });
  const state = await sdk.observeState({ signal });
  return {
    createdAt: envelope.createdAt || undefined,
    contacts: Number(report.contactRecords),
    requests: state.paymentRequests.length,
    receipts: state.receipts.length,
    reconnecting: report.recoveryRequiredPeers.length,
  };
}

/** "1 contact, 6 requests and 3 receipts". */
export function backupSummaryWords(summary: BackupSummary): string {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return `${count(summary.contacts, 'contact', 'contacts')}, ${count(summary.requests, 'request', 'requests')} and ${count(summary.receipts, 'receipt', 'receipts')}`;
}
