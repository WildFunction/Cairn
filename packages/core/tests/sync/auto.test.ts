import { describe, expect, test } from 'bun:test';
import type { LibraryEntry } from '../../src/store/library';
import {
  type CloudSyncStatus, createAutoSync, EMPTY_LEDGER, parseLedger, type SyncLedger,
} from '../../src/sync/auto';
import { BOOK_RECORD, type BookSource, PROGRESS_RECORD, zoneOf } from '../../src/sync/book';
import { CloudError, type CloudAccount, type CloudRecord, type CloudStore } from '../../src/sync/cloud';
import type { Path } from '../../src/types';

const entryOf = (id: string, complete = true): LibraryEntry => ({
  id, title: `Title of ${id}`, stations: 1, minutes: 2, budgetId: 'brief', generatedAt: '2026-01-01T00:00:00Z', complete,
});

const sourceOf = (entry: LibraryEntry): BookSource => {
  const path: Path = {
    bookId: entry.id, title: entry.title, type: 'knowledge',
    nodes: [{ id: 'n0', idx: 0, title: 'One', kind: 'concept', brief: '', keyPoints: [], sourceChapters: [0], estMinutes: 2 }],
    stages: [{ title: 'Stage', nodeIds: ['n0'] }], totalMinutes: 2, generatedAt: entry.generatedAt,
  };
  return { entry, path, stations: [{ nodeId: 'n0', deck: '{}', audio: `/a/${entry.id}.mp3`, audioHash: entry.id }] };
};

/** iCloud as zones of record names, with every call written down. */
function world(options: { books?: LibraryEntry[]; ledger?: SyncLedger; enabled?: boolean; account?: CloudAccount; helper?: boolean } = {}) {
  const zones = new Map<string, Map<string, string>>();
  const calls: string[] = [];
  const statuses: CloudSyncStatus[] = [];
  const logged: string[] = [];
  const state = {
    books: options.books ?? [entryOf('book-a'), entryOf('book-b')],
    ledger: options.ledger ?? EMPTY_LEDGER,
    enabled: options.enabled ?? true,
    failing: undefined as CloudError | undefined,
    onSave: undefined as (() => Promise<void>) | undefined,
  };
  const store: CloudStore = {
    account: async () => options.account ?? 'available',
    read: async () => undefined,
    fingerprints: async (zone) => new Map(zones.get(zone) ?? []),
    save: async (zone, records: readonly CloudRecord[]) => {
      if (state.failing) throw state.failing;
      await state.onSave?.();
      const held = zones.get(zone) ?? new Map<string, string>();
      for (const record of records) held.set(record.name, (record.fields.fingerprint as { string: string }).string);
      zones.set(zone, held);
      calls.push(`save ${zone} ${records.map((r) => r.name).join(',')}`);
    },
    remove: async () => undefined,
    dropZone: async (zone) => {
      if (state.failing) throw state.failing;
      zones.delete(zone);
      calls.push(`drop ${zone}`);
    },
  };
  const sync = createAutoSync({
    cloud: () => (options.helper === false ? undefined : store),
    enabled: async () => state.enabled,
    books: async () => state.books,
    source: async (entry) => sourceOf(entry),
    sizeOf: async () => 1000,
    ledger: { read: async () => state.ledger, write: async (next) => { state.ledger = next; } },
    onStatus: (status) => statuses.push(status),
    log: (what) => logged.push(what),
  });
  return { sync, zones, calls, statuses, logged, state };
}

const inCloud = (w: ReturnType<typeof world>): string[] => [...w.zones.keys()].sort();

describe('run', () => {
  test('uploads every finished book and remembers that it did', async () => {
    const w = world({ books: [entryOf('book-a'), entryOf('book-b'), entryOf('book-c', false)] });
    await w.sync.run();
    expect(inCloud(w)).toEqual([zoneOf('book-a'), zoneOf('book-b')]);
    expect(w.state.ledger.sent).toEqual(['book-a', 'book-b']);
    expect((await w.sync.status()).books.map((b) => b.state)).toEqual(['synced', 'synced', 'building']);
  });

  test('does nothing while the switch is off', async () => {
    const w = world({ enabled: false });
    await w.sync.run();
    expect(w.calls).toEqual([]);
  });

  test('does nothing without the helper or without an account, and says which', async () => {
    const noHelper = world({ helper: false });
    await noHelper.sync.run();
    expect((await noHelper.sync.status()).reach).toBe('no_helper');
    const signedOut = world({ account: 'no_account' });
    await signedOut.sync.run();
    expect(signedOut.calls).toEqual([]);
    expect((await signedOut.sync.status()).reach).toBe('no_account');
  });

  test('a book already in iCloud costs no upload and is counted as sent', async () => {
    const w = world({ books: [entryOf('book-a')] });
    await w.sync.run();
    const saves = w.calls.length;
    w.state.ledger = EMPTY_LEDGER;
    await w.sync.run();
    expect(w.calls.length).toBe(saves);
    expect(w.state.ledger.sent).toEqual(['book-a']);
  });

  test('a book removed on the phone is switched off here, not uploaded again', async () => {
    const w = world({ books: [entryOf('book-a')] });
    await w.sync.run();
    w.zones.delete(zoneOf('book-a'));
    const saves = w.calls.filter((c) => c.startsWith('save')).length;
    await w.sync.run();
    expect(w.calls.filter((c) => c.startsWith('save')).length).toBe(saves);
    expect(w.state.ledger).toEqual({ off: ['book-a'], sent: [], drop: [] });
    expect((await w.sync.status()).books[0]?.state).toBe('off');
  });

  test("a zone left holding only the reader's place counts as removed, and is cleared away", async () => {
    const w = world({ books: [entryOf('book-a')] });
    await w.sync.run();
    w.zones.set(zoneOf('book-a'), new Map([[PROGRESS_RECORD, '']]));
    await w.sync.run();
    expect(inCloud(w)).toEqual([]);
    expect(w.state.ledger.off).toEqual(['book-a']);
  });

  test('a book that fails does not stop the next one, and is tried again next run', async () => {
    const w = world();
    let first = true;
    w.state.onSave = async () => {
      if (first) {
        first = false;
        throw new CloudError('network', 'dropped');
      }
    };
    await w.sync.run();
    expect(inCloud(w)).toEqual([zoneOf('book-b')]);
    expect((await w.sync.status()).books.map((b) => b.state)).toEqual(['failed', 'synced']);
    expect(w.logged).toEqual(['syncing book-a to iCloud']);
    await w.sync.run();
    expect(w.state.ledger.sent.slice().sort()).toEqual(['book-a', 'book-b']);
  });

  test('a run asked for during a run happens once more, not at the same time', async () => {
    const w = world({ books: [entryOf('book-a')] });
    let asked = false;
    w.state.onSave = async () => {
      if (asked) return;
      asked = true;
      w.state.books = [entryOf('book-a'), entryOf('book-b')];
      void w.sync.run();
    };
    await w.sync.run();
    expect(inCloud(w)).toEqual([zoneOf('book-a'), zoneOf('book-b')]);
  });

  test('the status reports the upload as it goes', async () => {
    const w = world({ books: [entryOf('book-a')] });
    await w.sync.run();
    const during = w.statuses.find((s) => s.books[0]?.state === 'uploading' && (s.books[0]?.done ?? 0) > 0);
    expect(during?.books[0]).toMatchObject({ id: 'book-a', bytes: 1000, total: 2 });
    expect(w.statuses.at(-1)).toMatchObject({ running: false, enabled: true, reach: 'ready' });
  });
});

describe('setBook', () => {
  test('off takes the book out of iCloud and keeps it out', async () => {
    const w = world();
    await w.sync.run();
    await w.sync.setBook('book-a', false);
    expect(inCloud(w)).toEqual([zoneOf('book-b')]);
    expect(w.state.ledger).toEqual({ off: ['book-a'], sent: ['book-b'], drop: [] });
    await w.sync.run();
    expect(inCloud(w)).toEqual([zoneOf('book-b')]);
  });

  test('on uploads it again', async () => {
    const w = world({ ledger: { off: ['book-a'], sent: [], drop: [] } });
    await w.sync.run();
    expect(inCloud(w)).toEqual([zoneOf('book-b')]);
    await w.sync.setBook('book-a', true);
    expect(inCloud(w)).toEqual([zoneOf('book-a'), zoneOf('book-b')]);
    expect(w.state.ledger.off).toEqual([]);
  });

  test('switching a book off while it is uploading leaves nothing behind', async () => {
    const w = world({ books: [entryOf('book-a')] });
    let once = false;
    w.state.onSave = async () => {
      if (once) return;
      once = true;
      await w.sync.setBook('book-a', false);
    };
    await w.sync.run();
    expect(inCloud(w)).toEqual([]);
    expect(w.state.ledger).toEqual({ off: ['book-a'], sent: [], drop: [] });
  });

  test('a removal that cannot reach iCloud still keeps the book from being uploaded', async () => {
    const w = world({ books: [entryOf('book-a')] });
    await w.sync.run();
    w.state.failing = new CloudError('network', 'offline');
    await w.sync.setBook('book-a', false);
    expect(w.state.ledger.off).toEqual(['book-a']);
    expect(w.logged).toEqual(['removing book-a from iCloud']);
    expect(inCloud(w)).toEqual([zoneOf('book-a')]);

    w.state.failing = undefined;
    await w.sync.run();
    expect(inCloud(w)).toEqual([]);
    expect(w.state.ledger).toEqual({ off: ['book-a'], sent: [], drop: [] });
  });

  test('chosen while syncing is off, a book is left where it is until syncing is on', async () => {
    const w = world();
    await w.sync.run();
    w.state.enabled = false;
    const before = w.calls.length;
    await w.sync.setBook('book-a', false);
    expect(w.calls.length).toBe(before);
    expect(inCloud(w)).toEqual([zoneOf('book-a'), zoneOf('book-b')]);
    expect((await w.sync.status()).books[0]?.state).toBe('off');

    w.state.enabled = true;
    await w.sync.run();
    expect(inCloud(w)).toEqual([zoneOf('book-b')]);
  });

  test('a book switched off before syncing was ever on is never uploaded', async () => {
    const w = world({ enabled: false });
    await w.sync.setBook('book-b', false);
    w.state.enabled = true;
    await w.sync.run();
    expect(inCloud(w)).toEqual([zoneOf('book-a')]);
    expect(w.calls.filter((call) => call.startsWith('save') && call.includes('book-b'))).toEqual([]);
  });

  test('changing your mind before syncing is on cancels the removal too', async () => {
    const w = world();
    await w.sync.run();
    w.state.enabled = false;
    await w.sync.setBook('book-a', false);
    await w.sync.setBook('book-a', true);
    w.state.enabled = true;
    await w.sync.run();
    expect(inCloud(w)).toEqual([zoneOf('book-a'), zoneOf('book-b')]);
    expect(w.calls.filter((call) => call.startsWith('drop'))).toEqual([]);
  });
});

describe('removeAll, forget, allows', () => {
  test('removeAll empties iCloud and leaves the per-book choices alone', async () => {
    const w = world({ ledger: { off: ['book-b'], sent: [], drop: [] } });
    await w.sync.run();
    w.state.enabled = false;
    await w.sync.removeAll();
    expect(inCloud(w)).toEqual([]);
    expect(w.state.ledger).toEqual({ off: ['book-b'], sent: [], drop: [] });
  });

  test('a book deleted from the library leaves iCloud and the ledger', async () => {
    const w = world();
    await w.sync.run();
    await w.sync.forget('book-a');
    expect(inCloud(w)).toEqual([zoneOf('book-b')]);
    expect(w.state.ledger.sent).toEqual(['book-b']);
  });

  test('with the switch off, deleting a book does not touch iCloud', async () => {
    const w = world();
    await w.sync.run();
    w.state.enabled = false;
    await w.sync.forget('book-a');
    expect(inCloud(w)).toEqual([zoneOf('book-a'), zoneOf('book-b')]);
  });

  test("a place syncs only for a book that is on, with the switch on", async () => {
    const w = world({ ledger: { off: ['book-b'], sent: [], drop: [] } });
    expect(await w.sync.allows('book-a')).toBe(true);
    expect(await w.sync.allows('book-b')).toBe(false);
    w.state.enabled = false;
    expect(await w.sync.allows('book-a')).toBe(false);
  });
});

test('a ledger written by anything is read without trusting it', () => {
  expect(parseLedger({ off: ['a', 'a', 3], sent: 'x' })).toEqual({ off: ['a'], sent: [], drop: [] });
  expect(parseLedger({ off: [], sent: ['a'], drop: ['b'] }).drop).toEqual(['b']);
  expect(parseLedger(null)).toEqual(EMPTY_LEDGER);
  expect(BOOK_RECORD).toBe('book');
});
