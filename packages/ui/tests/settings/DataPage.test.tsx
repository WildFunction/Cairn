import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataPage } from '../../src/settings/pages';
import { SettingsProvider } from '../../src/settings/SettingsProvider';
import { megabytes } from '../../src/settings/CloudSection';
import { switchedState, type CloudPanel, type ShellSettings } from '../../src/settings/shell';

const shell = (devBuild: boolean): ShellSettings => ({
  prefs: {
    providers: {}, generationProvider: 'openai', chatProvider: 'inherit',
    narration: 'follow', voices: { en: 'en-US-AndrewNeural', zh: 'zh-CN-YunjianNeural' },
    searchProvider: 'firecrawl', braveKey: '', firecrawlKey: '', tavilyKey: '', wereadKey: '', wereadAccount: '',
    trace: false, icloudSync: false,
  },
  setPref: () => {},
  setProvider: () => {},
  providers: [],
  voicesFor: () => [],
  recheckModel: () => {},
  previewVoice: () => {},
  dataDir: '/tmp',
  devBuild,
  revealDataDir: () => {},
  clearCache: async () => {},
});

const render = (devBuild: boolean): string =>
  renderToStaticMarkup(createElement(SettingsProvider, null, createElement(DataPage, { shell: shell(devBuild) })));

test('recording model calls is offered in a dev build only', () => {
  expect(render(true)).toContain('role="switch"');
  expect(render(false)).not.toContain('role="switch"');
});

const cloud = (over: Partial<CloudPanel> = {}): CloudPanel => ({
  reach: 'ready',
  running: false,
  books: [
    { id: 'a', title: 'A Long Book', bytes: 28_400_000, state: 'synced' },
    { id: 'b', title: 'Going Up', bytes: 7_100_000, state: 'uploading', done: 3, total: 6 },
    { id: 'c', title: 'Kept Home', bytes: 12_000_000, state: 'off' },
  ],
  setBook: () => {},
  syncNow: () => {},
  removeAll: async () => {},
  ...over,
});

const withCloud = (panel: CloudPanel | undefined, icloudSync: boolean): string => {
  const base = shell(false);
  return renderToStaticMarkup(createElement(SettingsProvider, null, createElement(DataPage, {
    shell: { ...base, prefs: { ...base.prefs, icloudSync }, ...(panel ? { cloud: panel } : {}) },
  })));
};

test('there is no iCloud section until the main process has answered', () => {
  expect(withCloud(undefined, true)).not.toContain('iCloud');
});

test('with syncing on, every book is listed with what it takes and where it stands', () => {
  const html = withCloud(cloud(), true);
  expect(html).toContain('1 book in iCloud');
  expect(html).toContain('A Long Book');
  expect(html).toContain('28 MB · In iCloud');
  expect(html).toContain('7.1 MB · Uploading 3 / 6');
  expect(html).toContain('12 MB · Not synced');
  // The main switch and one per book: on, on (uploading), off
  expect(html.match(/aria-checked="true"/g)?.length).toBe(3);
  expect(html.match(/aria-checked="false"/g)?.length).toBe(1);
});

test('with syncing off, the books can still be chosen, and nothing claims to be uploading', () => {
  const waiting = cloud({ books: [
    { id: 'a', title: 'A Long Book', bytes: 28_400_000, state: 'waiting' },
    { id: 'c', title: 'Kept Home', bytes: 12_000_000, state: 'off' },
  ] });
  const html = withCloud(waiting, false);
  expect(html).toContain('28 MB · Uploads once syncing is on');
  expect(html).toContain('12 MB · Not synced');
  expect(html).not.toContain('Sync now');
  expect(html).toContain('Remove everything from iCloud');
  // The main switch is off; of the two books, one is chosen and one is not
  expect(html.match(/aria-checked="true"/g)?.length).toBe(1);
  expect(html.match(/aria-checked="false"/g)?.length).toBe(2);
});

test('a build that cannot reach iCloud says why and offers no switch to throw', () => {
  const html = withCloud(cloud({ reach: 'no_helper' }), true);
  expect(html).toContain('no iCloud helper');
  expect(html).toContain('aria-checked="false" aria-label="Sync books to iCloud" disabled=""');
  expect(html).not.toContain('A Long Book');
});

test('sizes keep a decimal only where it tells two books apart', () => {
  expect(megabytes(7_140_000)).toBe('7.1 MB');
  expect(megabytes(28_400_000)).toBe('28 MB');
});

test('a book still being made can be switched on, and shows a spinner once it is being finished', () => {
  const making = cloud({ books: [
    { id: 'a', title: 'Half Made', bytes: 3_000_000, state: 'building' },
    { id: 'b', title: 'Being Finished', bytes: 5_000_000, state: 'generating' },
  ] });
  const html = withCloud(making, true);
  expect(html).toContain('aria-checked="false" aria-label="Sync Half Made"');
  expect(html).toContain('aria-checked="true" aria-label="Sync Being Finished"');
  expect(html).not.toContain('aria-label="Sync Half Made" disabled');
  expect(html).toContain('3.0 MB · Still being made');
  expect(html).toContain('<span class="set-spin" aria-hidden="true"></span>Making the rest');
});

test('throwing a switch reads at once as what the main process is about to do', () => {
  expect(switchedState('building', true)).toBe('generating');
  expect(switchedState('generating', false)).toBe('building');
  expect(switchedState('off', true)).toBe('waiting');
  expect(switchedState('synced', false)).toBe('off');
});
