import { expect, test } from 'bun:test';
import { syncHelperPath } from '../../src/main/sync-helper';

test('a development build finds the helper beside it in the repository', () => {
  expect(syncHelperPath('/r/cairn/apps/desktop/build/dev-macos-arm64/Cairn-dev.app/Contents/MacOS/cottontail', {}))
    .toBe('/r/cairn/apps/desktop/sync-helper/build/Build/Products/Debug/CairnSync.app/Contents/MacOS/CairnSync');
});

test('an installed app has none unless one is named', () => {
  expect(syncHelperPath('/Applications/Cairn.app/Contents/MacOS/cottontail', {})).toBeUndefined();
  expect(syncHelperPath('/Applications/Cairn.app/Contents/MacOS/cottontail', { CAIRN_SYNC_HELPER: '/h' })).toBe('/h');
});
