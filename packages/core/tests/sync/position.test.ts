import { describe, expect, test } from 'bun:test';
import { BOOK_RECORD, PROGRESS_RECORD, progressRecord, zoneOf } from '../../src/sync/book';
import { CloudError, type CloudAccount, type CloudRecord, type CloudStore } from '../../src/sync/cloud';
import { createPositionSync, PUSH_EVERY_MS, RECHECK_MS } from '../../src/sync/position';
import type { SyncedPlace } from '../../src/sync/progress';

const place: SyncedPlace = { nodeId: 'n1', ms: 4000, updatedAt: 100, device: 'Mac' };
const zone = zoneOf('book-one');

interface FakeOptions { account?: CloudAccount; inCloud?: boolean; failing?: boolean; stored?: CloudRecord }

function fake(options: FakeOptions = {}) {
  const saved: CloudRecord[] = [];
  const created: boolean[] = [];
  const store: CloudStore = {
    account: async () => options.account ?? 'available',
    read: async (z, name) => {
      if (options.failing) throw new CloudError('network', 'offline');
      return z === zone && name === PROGRESS_RECORD ? options.stored : undefined;
    },
    fingerprints: async (z) => new Map(options.inCloud === false || z !== zone ? [] : [[BOOK_RECORD, 'f']]),
    save: async (_z, records, saving) => {
      if (options.failing) throw new CloudError('network', 'offline');
      if (options.inCloud === false) throw new CloudError('zone_missing');
      created.push(saving?.createZone !== false);
      saved.push(...records);
    },
    remove: async () => undefined,
    dropZone: async () => undefined,
  };
  return { store, saved, created, options };
}

const harness = (store: CloudStore | undefined) => {
  const logged: string[] = [];
  const clock = { now: 0 };
  const sync = createPositionSync({ cloud: () => store, now: () => clock.now, log: (what) => logged.push(what) });
  return { sync, logged, clock };
};

describe('pull', () => {
  test('reads the place iCloud holds', async () => {
    const { store } = fake({ stored: progressRecord(place) });
    expect(await harness(store).sync.pull('book-one')).toEqual(place);
  });

  test('nothing without the helper, without an account, or for a book not in iCloud', async () => {
    expect(await harness(undefined).sync.pull('book-one')).toBeUndefined();
    expect(await harness(fake({ account: 'no_account', stored: progressRecord(place) }).store).sync.pull('book-one')).toBeUndefined();
    expect(await harness(fake({ inCloud: false, stored: progressRecord(place) }).store).sync.pull('book-one')).toBeUndefined();
  });

  test('a failure is logged and is nothing, not an error', async () => {
    const { sync, logged } = harness(fake({ failing: true }).store);
    expect(await sync.pull('book-one')).toBeUndefined();
    expect(logged).toEqual(['pulling the place in book-one']);
  });
});

describe('push', () => {
  test('writes the Progress record into the book zone', async () => {
    const { store, saved } = fake();
    await harness(store).sync.push('book-one', place);
    expect(saved).toEqual([progressRecord(place)]);
  });

  test('never creates a zone for a book that is not in iCloud', async () => {
    const { store, saved } = fake({ inCloud: false });
    await harness(store).sync.push('book-one', place, true);
    expect(saved).toEqual([]);
  });

  test('moving sends at most every thirty seconds; a forced push always goes', async () => {
    const { store, saved } = fake();
    const { sync, clock } = harness(store);
    await sync.push('book-one', place);
    clock.now = PUSH_EVERY_MS - 1;
    await sync.push('book-one', { ...place, ms: 5000 });
    expect(saved.length).toBe(1);
    await sync.push('book-one', { ...place, ms: 6000 }, true);
    clock.now = 2 * PUSH_EVERY_MS;
    await sync.push('book-one', { ...place, ms: 7000 });
    expect(saved.map((r) => (r.fields.ms as { int: number }).int)).toEqual([4000, 6000, 7000]);
  });

  test('a book pushed to iCloud while the app runs is picked up, without asking on every tick', async () => {
    const cloud = fake({ inCloud: false });
    const { sync, clock } = harness(cloud.store);
    await sync.push('book-one', place, true);
    cloud.options.inCloud = true;
    clock.now = RECHECK_MS - 1;
    await sync.push('book-one', place, true);
    expect(cloud.saved).toEqual([]);
    clock.now = RECHECK_MS;
    await sync.push('book-one', place, true);
    expect(cloud.saved.length).toBe(1);
  });

  test('a place never creates the zone, and a zone that has gone is quiet, not an error', async () => {
    const cloud = fake();
    const { sync, logged } = harness(cloud.store);
    await sync.push('book-one', place, true);
    expect(cloud.created).toEqual([false]);
    cloud.options.inCloud = false;
    await sync.push('book-one', place, true);
    await sync.push('book-one', place, true);
    expect(cloud.saved.length).toBe(1);
    expect(logged).toEqual([]);
  });

  test('a book the owner has switched off is left alone', async () => {
    const cloud = fake({ stored: progressRecord(place) });
    const logged: string[] = [];
    const sync = createPositionSync({
      cloud: () => cloud.store, allows: async () => false, now: () => 0, log: (what) => logged.push(what),
    });
    await sync.push('book-one', place, true);
    expect(await sync.pull('book-one')).toBeUndefined();
    expect(cloud.saved).toEqual([]);
  });

  test('a failed push is logged and swallowed', async () => {
    const { sync, logged } = harness(fake({ failing: true }).store);
    await sync.push('book-one', place, true);
    expect(logged).toEqual(['pushing the place in book-one']);
  });
});
