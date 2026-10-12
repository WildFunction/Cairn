import { expect, test } from 'bun:test';
import { syncEnvironment, syncHelperPaths } from '../../src/main/sync-helper';

const IN_BUNDLE = 'Contents/Helpers/CairnSync.app/Contents/MacOS/CairnSync';
const DEV_EXEC = '/r/cairn/apps/desktop/build/dev-macos-arm64/Cairn-dev.app/Contents/MacOS/cottontail';

test('a packaged app uses the helper inside its own bundle', () => {
  expect(syncHelperPaths('/Applications/Cairn.app/Contents/MacOS/cottontail', {}, 'production'))
    .toEqual([`/Applications/Cairn.app/${IN_BUNDLE}`]);
});

test('a development build falls back to the helper built in the repository for its environment', () => {
  for (const environment of ['production', 'development'] as const) {
    expect(syncHelperPaths(DEV_EXEC, {}, environment)).toEqual([
      `/r/cairn/apps/desktop/build/dev-macos-arm64/Cairn-dev.app/${IN_BUNDLE}`,
      `/r/cairn/apps/desktop/sync-helper/build/${environment}/Build/Products/Debug/CairnSync.app/Contents/MacOS/CairnSync`,
    ]);
  }
});

// The old path holds a helper entitled to Development; found by a build that keeps the Production ledger, it would read every book as removed
test('a development build never picks up the helper built before the environments had their own folders', () => {
  expect(syncHelperPaths(DEV_EXEC, {}, 'production').join())
    .not.toContain('sync-helper/build/Build/Products');
});

test('a helper named in the environment is the only one tried', () => {
  expect(syncHelperPaths('/Applications/Cairn.app/Contents/MacOS/cottontail', { CAIRN_SYNC_HELPER: '/h' }, 'production'))
    .toEqual(['/h']);
});

test('a development build reaches the same iCloud as the release unless told otherwise', () => {
  expect(syncEnvironment(true, {})).toBe('production');
  expect(syncEnvironment(true, { CAIRN_SYNC_ENV: 'development' })).toBe('development');
});

test('a release never leaves Production', () => {
  expect(syncEnvironment(false, { CAIRN_SYNC_ENV: 'development' })).toBe('production');
});
