// You > Contacts and requests backup.
//
// The recovery phrase brings back the money and the identity, not the
// contacts, private connections, requests and receipts that live on this
// phone. This section backs those up (src/paykit/backup.ts):
//
//   status    when the last backup was made here, and whether anything
//             changed since (backupStateRevision, a fingerprint of what a
//             backup would hold now)
//   Back up   seal a backup with a key from the recovery phrase, then Copy
//             it or Share it (Files, AirDrop, a note). The text is held in
//             memory only until it is copied or shared, or the app leaves
//             the foreground; it is never shown, stored or logged. "Last
//             backup" changes only once it was kept: on Copy, or a Share
//             that iOS confirms. Android's share sheet never says whether
//             anything was saved, so there the person says so ("I saved
//             it").
//   Check     open a backup from the clipboard and restore it into a
//             throwaway store, then say what it holds. Nothing here changes.
//   Resume    after a restore that paused automatic payments
//             (src/paykit/restoreReview.ts): the person confirms they
//             checked Activity for payments made after the backup.
//
// Restoring for real happens in onboarding, after the recovery phrase
// (src/features/onboarding/InviteCodeScreen.tsx): Paykit restores only
// into an identity that has no contacts or requests on this phone yet.
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Share, StyleSheet, View } from 'react-native';

import {
  backupOpenMessage,
  backupSummaryWords,
  checkBackup,
  describeError,
  exportBackup,
  readBackupStatus,
  recordBackupKept,
  resumeAfterRestore,
  usePaykit,
  userMessageFor,
  useRestoreReview,
  type BackupMeta,
  type BackupStatus,
} from '../../paykit';
import { Button, Text, formatDateTime, relativeTime, space, useForegroundSecret } from '../../ui';

export function BackupSection() {
  const { service, log } = usePaykit();
  const [status, setStatus] = useState<BackupStatus>();
  // The sealed backup, until it is copied or shared. Dropped when the app leaves the foreground.
  const [sealed, setSealed] = useForegroundSecret<{ text: string; meta: BackupMeta }>();
  // Android only: shared, but the platform can't say whether it was saved. Not secret.
  const [unconfirmed, setUnconfirmed] = useState<BackupMeta>();
  const [running, setRunning] = useState<'export' | 'check'>();
  const [message, setMessage] = useState<{ text: string; tone: 'graphite' | 'alert' }>();

  const loadStatus = useCallback(async () => {
    if (!service) return;
    try {
      setStatus(await readBackupStatus(service));
    } catch (e) {
      log.warn(`backup status: ${describeError(e)}`);
    }
  }, [service, log]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const onExport = async () => {
    if (!service || running) return;
    setRunning('export');
    setMessage(undefined);
    setUnconfirmed(undefined);
    try {
      setSealed(await exportBackup(service));
    } catch (e) {
      log.warn(`make backup: ${describeError(e)}`);
      setMessage({ text: userMessageFor(e, "Couldn't make the backup. Try again."), tone: 'alert' });
    } finally {
      setRunning(undefined);
    }
  };

  const kept = (meta: BackupMeta) => {
    if (!service) return;
    recordBackupKept(service, meta);
    setUnconfirmed(undefined);
    void loadStatus();
  };

  const onCopy = async () => {
    if (!sealed) return;
    await Clipboard.setStringAsync(sealed.text);
    kept(sealed.meta);
    setSealed(undefined);
    setMessage({ text: 'Backup copied. Paste it somewhere safe, such as a note or a file.', tone: 'graphite' });
  };

  const onShare = async () => {
    if (!sealed) return;
    const { text, meta } = sealed;
    try {
      const result = await Share.share({ message: text, title: 'Wallet contacts and requests backup' });
      if (Platform.OS === 'ios') {
        // iOS says whether the person picked somewhere to send it.
        if (result.action === Share.sharedAction) {
          kept(meta);
          setSealed(undefined);
          setMessage({ text: 'Backup saved.', tone: 'graphite' });
        }
      } else {
        // Android always reports "shared", even when the sheet was dismissed.
        setUnconfirmed(meta);
        setMessage({ text: "Android doesn't tell the app whether you saved it. If you did, tap “I saved it”. If not, copy it instead.", tone: 'graphite' });
      }
    } catch (e) {
      log.warn(`share backup: ${describeError(e)}`);
    }
  };

  const onSavedOnAndroid = () => {
    if (!unconfirmed) return;
    kept(unconfirmed);
    setSealed(undefined);
    setMessage({ text: 'Backup saved.', tone: 'graphite' });
  };

  const onCheck = async () => {
    if (!service || running) return;
    setRunning('check');
    setMessage(undefined);
    try {
      const text = await Clipboard.getStringAsync();
      const summary = await checkBackup(service, text);
      const made = summary.createdAt ? ` It was made ${formatDateTime(Date.parse(summary.createdAt))}.` : '';
      setMessage({ text: `This backup opens with your recovery phrase and holds ${backupSummaryWords(summary)}.${made}`, tone: 'graphite' });
    } catch (e) {
      log.warn(`check backup: ${describeError(e)}`);
      setMessage({ text: backupOpenMessage(e) ?? userMessageFor(e, "Couldn't check the backup. Copy it again and try again."), tone: 'alert' });
    } finally {
      setRunning(undefined);
    }
  };

  const last = status?.lastBackup;
  return (
    <View style={styles.root} testID="backup-section">
      <PausedAfterRestore />
      {/* In their own View: as direct siblings of the status line, whose height changes once it loads, iOS kept their old frames and cut off the last line. */}
      <View style={styles.intro}>
        <Text color="graphite" variant="secondary">
          Your recovery phrase brings back your money and your identity. Your contacts, private connections, requests and receipts live on this
          phone: back them up here.
        </Text>
        <Text color="graphite" variant="secondary">
          The backup is encrypted with a key from your recovery phrase, so only your phrase opens it.
        </Text>
      </View>
      <Text testID="backup-status">
        {!status
          ? 'Checking…'
          : last
            ? `Last backup ${relativeTime(last.exportedAt).toLowerCase()}. ${status.changedSinceBackup ? 'Something changed since then.' : 'Nothing changed since then.'}`
            : 'Not backed up on this phone yet.'}
      </Text>
      {sealed || unconfirmed ? (
        <View style={styles.buttons}>
          {sealed ? <Button label="Copy backup" onPress={() => void onCopy()} testID="backup-copy" /> : null}
          {sealed ? <Button label="Share backup…" variant="secondary" onPress={() => void onShare()} testID="backup-share" /> : null}
          {unconfirmed ? <Button label="I saved it" variant="secondary" onPress={onSavedOnAndroid} testID="backup-saved" /> : null}
          {sealed ? null : <Button label="Make it again" variant="secondary" compact onPress={() => void onExport()} loading={running === 'export'} testID="backup-again" />}
        </View>
      ) : (
        <Button
          label="Back up contacts and requests"
          variant="secondary"
          onPress={() => void onExport()}
          loading={running === 'export'}
          disabled={!service || running === 'check'}
          testID="backup-export"
        />
      )}
      <Button
        label="Check a copied backup"
        variant="secondary"
        compact
        onPress={() => void onCheck()}
        loading={running === 'check'}
        disabled={!service || running === 'export'}
        testID="backup-check"
      />
      {message ? (
        <Text variant="secondary" color={message.tone} testID="backup-message">
          {message.text}
        </Text>
      ) : null}
    </View>
  );
}

/** Automatic payments paused by a restore: what to check, and Resume after a confirmation. */
function PausedAfterRestore() {
  const { service, log } = usePaykit();
  const review = useRestoreReview();
  if (!service || !review?.paused) return null;
  const made = review.backupCreatedAtMs !== undefined ? `, made ${formatDateTime(review.backupCreatedAtMs)}` : '';
  const resume = () =>
    Alert.alert(
      'Resume automatic payments?',
      'Do this only once you have checked Activity for payments made after the backup: your limits count only the payments in the backup. Requests from the backup stay paid by hand.',
      [
        { text: 'Back', style: 'cancel' },
        {
          text: 'Resume',
          onPress: () => {
            resumeAfterRestore(service.appStore);
            log.info('resumed automatic payments after a restore');
            service.syncLoop.flush();
          },
        },
      ],
    );
  return (
    <View style={styles.paused} testID="backup-restore-paused">
      <Text variant="bodyStrong">Automatic payments are paused</Text>
      <Text color="graphite">
        {`This phone was restored from a backup${made}. Payments made after it aren't in the backup, so the wallet can't tell what was already paid automatically.`}
      </Text>
      <Button label="Resume automatic payments" variant="secondary" compact onPress={resume} testID="backup-restore-resume" />
    </View>
  );
}

const styles = StyleSheet.create({
  paused: { gap: space.s, alignItems: 'flex-start', marginBottom: space.s },
  root: { gap: space.s, alignItems: 'stretch' },
  buttons: { gap: space.s },
  intro: { gap: space.s },
});
