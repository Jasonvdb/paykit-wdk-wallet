// Expo config plugin: build iOS simulator code for arm64 only.
//
// The Paykit xcframework ships an arm64 simulator slice and no x86_64 one.
// Any simulator build that compiles every architecture (Release, or
// ONLY_ACTIVE_ARCH=NO) then fails to link with "library 'paykit' not found".
// Excluding x86_64 for the simulator SDK fixes that for the app target and
// for every pod target.
const { withPodfile, withXcodeProject } = require('expo/config-plugins');

const SETTING = 'EXCLUDED_ARCHS[sdk=iphonesimulator*]';
const MARKER = '# paykit: arm64-only simulator builds';

function withAppTargetSetting(config) {
  return withXcodeProject(config, (cfg) => {
    const configurations = cfg.modResults.pbxXCBuildConfigurationSection();
    for (const entry of Object.values(configurations)) {
      if (entry && typeof entry === 'object' && entry.buildSettings) {
        entry.buildSettings[`"${SETTING}"`] = 'x86_64';
      }
    }
    return cfg;
  });
}

function withPodsSetting(config) {
  return withPodfile(config, (cfg) => {
    const podfile = cfg.modResults.contents;
    if (podfile.includes(MARKER)) return cfg;
    const hook = 'post_install do |installer|';
    if (!podfile.includes(hook)) {
      throw new Error('withPaykitSimulatorArchs: no post_install hook found in the Podfile');
    }
    cfg.modResults.contents = podfile.replace(
      hook,
      [
        hook,
        `    ${MARKER}`,
        '    installer.pods_project.build_configurations.each do |bc|',
        `      bc.build_settings['${SETTING}'] = 'x86_64'`,
        '    end',
        '    installer.pods_project.targets.each do |target|',
        '      target.build_configurations.each do |bc|',
        `        bc.build_settings['${SETTING}'] = 'x86_64'`,
        '      end',
        '    end',
      ].join('\n'),
    );
    return cfg;
  });
}

module.exports = function withPaykitSimulatorArchs(config) {
  return withPodsSetting(withAppTargetSetting(config));
};
