import { expect, test } from 'bun:test';
import { syncHelperPaths } from '../../src/main/sync-helper';

const IN_BUNDLE = 'Contents/Helpers/CairnSync.app/Contents/MacOS/CairnSync';

test('a packaged app uses the helper inside its own bundle', () => {
  expect(syncHelperPaths('/Applications/Cairn.app/Contents/MacOS/cottontail', {}))
    .toEqual([`/Applications/Cairn.app/${IN_BUNDLE}`]);
});

test('a development build falls back to the helper built in the repository', () => {
  expect(syncHelperPaths('/r/cairn/apps/desktop/build/dev-macos-arm64/Cairn-dev.app/Contents/MacOS/cottontail', {}))
    .toEqual([
      `/r/cairn/apps/desktop/build/dev-macos-arm64/Cairn-dev.app/${IN_BUNDLE}`,
      '/r/cairn/apps/desktop/sync-helper/build/Build/Products/Debug/CairnSync.app/Contents/MacOS/CairnSync',
    ]);
});

test('a helper named in the environment is the only one tried', () => {
  expect(syncHelperPaths('/Applications/Cairn.app/Contents/MacOS/cottontail', { CAIRN_SYNC_HELPER: '/h' })).toEqual(['/h']);
});
