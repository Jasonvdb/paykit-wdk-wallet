// ESLint flat config: Expo's recommended rules plus a few project rules.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['ios/*', 'android/*', 'dist/*', '.expo/*', '.wdk/*', '.wdk-bundle/*', '.paykit-build/*', 'vendor/*'],
  },
  {
    rules: {
      // Logs end up in device logs and screenshots. Paykit records are not
      // redacted in JS, and secrets (mnemonic, session secret, signup code)
      // must never be printed. Use the Paykit event log (src/paykit/eventLog.ts)
      // for developer diagnostics instead of console.log.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Node CLI scripts print progress on purpose (never secret values).
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
]);
