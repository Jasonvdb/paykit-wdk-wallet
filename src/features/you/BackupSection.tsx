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
//             the foreground; it is never shown, stored or logged.
//   Check     open a backup from the clipboard and restore it into a
//             throwaway store, then say what it holds. Nothing here changes.
//
// Restoring for real happens in onboarding, after the recovery phrase
// (src/features/onboarding/InviteCodeScreen.tsx): Paykit restores only
// into an identity that has no contacts or requests on this phone yet.
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { backupOpenMessage, backupSummaryWords, checkBackup, describeError, exportBackup, readBackupStatus, usePaykit, userMessageFor, type BackupStatus } from '../../paykit';
import { Button, Text, formatDateTime, relativeTime, space, useForegroundSecret } from '../../ui';

export function BackupSection() {
  const { service, log } = usePaykit();
  const [status, setStatus] = useState<BackupStatus>();
  // The sealed backup, until it is copied or shared. Dropped when the app leaves the foreground.
  const [sealed, setSealed] = useForegroundSecret<string>();
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
    try {
      setSealed(await exportBackup(service));
      void loadStatus();
    } catch (e) {
      log.warn(`make backup: ${describeError(e)}`);
      setMessage({ text: userMessageFor(e, "Couldn't make the backup. Try again."), tone: 'alert' });
    } finally {
      setRunning(undefined);
    }
  };

  const onCopy = async () => {
    if (!sealed) return;
    await Clipboard.setStringAsync(sealed);
    setSealed(undefined);
    setMessage({ text: 'Backup copied. Paste it somewhere safe, such as a note or a file.', tone: 'graphite' });
  };

  const onShare = async () => {
    if (!sealed) return;
    try {
      const result = await Share.share({ message: sealed, title: 'Wallet contacts and requests backup' });
      if (result.action === Share.sharedAction) {
        setSealed(undefined);
        setMessage({ text: 'Backup saved.', tone: 'graphite' });
      }
    } catch (e) {
      log.warn(`share backup: ${describeError(e)}`);
    }
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
      <Text color="graphite" variant="secondary">
        Your recovery phrase brings back your money and your identity. Your contacts, private connections, requests and receipts live on this
        phone: back them up here.
      </Text>
      <Text color="graphite" variant="secondary">
        The backup is encrypted with a key from your recovery phrase, so only your phrase opens it.
      </Text>
      <Text testID="backup-status">
        {!status
          ? 'Checking…'
          : last
            ? `Last backup ${relativeTime(last.exportedAt).toLowerCase()}. ${status.changedSinceBackup ? 'Something changed since then.' : 'Nothing changed since then.'}`
            : 'Not backed up on this phone yet.'}
      </Text>
      {sealed ? (
        <View style={styles.buttons}>
          <Button label="Copy backup" onPress={() => void onCopy()} testID="backup-copy" />
          <Button label="Share backup…" variant="secondary" onPress={() => void onShare()} testID="backup-share" />
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
      {status ? (
        <Text variant="caption" color="graphite">
          Backup revision {status.revision.slice(0, 12)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.s, alignItems: 'stretch' },
  buttons: { gap: space.s },
});
