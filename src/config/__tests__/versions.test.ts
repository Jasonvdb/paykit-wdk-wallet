import { readFileSync } from 'fs';
import { join } from 'path';

import { PAYKIT_PACKAGE, WDK_PACKAGES } from '../versions';

const root = join(__dirname, '..', '..', '..');
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));

describe('SDK versions shown in Network details', () => {
  it('match the exact WDK pins in package.json', () => {
    const { dependencies } = readJson('package.json');
    for (const { name, version } of WDK_PACKAGES) expect(dependencies[name]).toBe(version);
  });

  it('match the installed Paykit package and the commit it is built from', () => {
    expect(readJson(`node_modules/${PAYKIT_PACKAGE.name}/package.json`).version).toBe(PAYKIT_PACKAGE.version);
    const buildScript = readFileSync(join(root, 'scripts/build-paykit.sh'), 'utf8');
    expect(buildScript).toMatch(new RegExp(`PAYKIT_COMMIT="${PAYKIT_PACKAGE.commit}[0-9a-f]+"`));
  });
});
