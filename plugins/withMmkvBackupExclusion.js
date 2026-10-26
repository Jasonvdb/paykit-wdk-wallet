// Expo config plugin: keep MMKV's files out of iCloud and Finder backups on iOS.
//
// react-native-mmkv stores its files in Documents/mmkv, and iOS backs up
// Documents by default. This app's MMKV files hold the Paykit state (link
// keys, requests, receipts) and the app's own records, encrypted with a key
// in the Keychain that never leaves the device (WHEN_UNLOCKED_THIS_DEVICE_ONLY).
// A backup copy could never be opened elsewhere, so it is only a stale
// encrypted copy of private data sitting in the cloud. Restoring it onto a
// new phone without its key would also leave files the app cannot read.
//
// So at every launch, before React Native starts, the app creates
// Documents/mmkv if needed and sets NSURLIsExcludedFromBackupKey on it.
// Apple: excluding a directory excludes everything inside it, including
// files created later. Moving the files elsewhere instead (MMKV's `path`)
// would orphan the data of existing installs.
//
// Android needs no plugin: app.json sets android.allowBackup to false.
const { withAppDelegate } = require('expo/config-plugins');

const MARKER = '// paykit-wdk-wallet: MMKV backup exclusion';
const LAUNCH_ANCHOR = 'let delegate = ReactNativeDelegate()';

const HELPER = `
${MARKER}
/// Keeps Documents/mmkv out of iCloud and Finder backups (plugins/withMmkvBackupExclusion.js).
private func excludeMmkvFromBackup() {
  guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
  var directory = documents.appendingPathComponent("mmkv", isDirectory: true)
  do {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try directory.setResourceValues(values)
  } catch {
    NSLog("Could not exclude the MMKV directory from backups: %@", error.localizedDescription)
  }
}
`;

module.exports = function withMmkvBackupExclusion(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('withMmkvBackupExclusion: expected a Swift AppDelegate');
    }
    let contents = cfg.modResults.contents;
    if (contents.includes(MARKER)) return cfg;
    if (!contents.includes(LAUNCH_ANCHOR)) {
      throw new Error('withMmkvBackupExclusion: no ReactNativeDelegate() setup found in AppDelegate.swift');
    }
    contents = contents.replace(LAUNCH_ANCHOR, `excludeMmkvFromBackup()\n    ${LAUNCH_ANCHOR}`);
    cfg.modResults.contents = `${contents.trimEnd()}\n${HELPER}`;
    return cfg;
  });
};
