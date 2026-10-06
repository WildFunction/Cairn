/**
 * Keeping iCloud in step with the library once the owner has switched that on:
 * every finished book goes up, a book they switched off comes down and stays
 * down, and a book removed from the phone is noticed and left alone. With the
 * switch off, nothing here touches iCloud except `removeAll`.
 */
import { normalizeEntry, type LibraryEntry } from '../store/library';
import { type BookSource, PROGRESS_RECORD, zoneOf } from './book';
import { CloudError, type CloudAccount, type CloudStore } from './cloud';
import { pushBook } from './push';

/** What this Mac remembers between runs. `sent` is how a removal made elsewhere is told from a book never uploaded. */
export interface SyncLedger {
  /** Books the owner does not want in iCloud. */
  readonly off: readonly string[];
  /** Books this Mac has uploaded whole. */
  readonly sent: readonly string[];
  /** Books switched off whose copy in iCloud is still to be removed: chosen while syncing was off, or while offline. */
  readonly drop: readonly string[];
}

export const EMPTY_LEDGER: SyncLedger = { off: [], sent: [], drop: [] };

/** The ledger file is untrusted: an older build wrote it. */
export function parseLedger(raw: unknown): SyncLedger {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as { off?: unknown; sent?: unknown; drop?: unknown };
  const ids = (value: unknown): readonly string[] =>
    (Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : []);
  return { off: ids(record.off), sent: ids(record.sent), drop: ids(record.drop) };
}

export type BookSyncState = 'synced' | 'waiting' | 'uploading' | 'off' | 'building' | 'failed';

export interface BookSync {
  readonly id: string;
  readonly title: string;
  /** What the book takes in iCloud, and again on the phone. */
  readonly bytes: number;
  readonly state: BookSyncState;
  /** Records sent so far, while uploading. */
  readonly done?: number;
  readonly total?: number;
}

/** Whether iCloud can be used from here at all. */
export type CloudReach = 'ready' | 'no_helper' | Exclude<CloudAccount, 'available'>;

export interface CloudSyncStatus {
  readonly reach: CloudReach;
  readonly enabled: boolean;
  readonly running: boolean;
  readonly books: readonly BookSync[];
}

export interface AutoSync {
  status(): Promise<CloudSyncStatus>;
  /** Upload what is missing and notice what was removed elsewhere. A call during a run queues one more. */
  run(): Promise<void>;
  /**
   * Off keeps the book out of iCloud; on lets the next run upload it. The copy already there is
   * removed at once when syncing is on, and at the next run otherwise.
   */
  setBook(bookId: string, on: boolean): Promise<void>;
  /** Take every book out of iCloud. The caller switches syncing off first, or the next run puts them back. */
  removeAll(): Promise<void>;
  /** The book was deleted from the library. */
  forget(bookId: string): Promise<void>;
  /** Whether a book's place may be read from and written to iCloud. */
  allows(bookId: string): Promise<boolean>;
}

export function createAutoSync(deps: {
  /** Nothing when the helper is not installed. */
  readonly cloud: () => CloudStore | undefined;
  readonly enabled: () => Promise<boolean>;
  readonly books: () => Promise<readonly LibraryEntry[]>;
  readonly source: (entry: LibraryEntry) => Promise<BookSource>;
  readonly sizeOf: (entry: LibraryEntry) => Promise<number>;
  readonly ledger: { read(): Promise<SyncLedger>; write(next: SyncLedger): Promise<void> };
  readonly onStatus: (status: CloudSyncStatus) => void;
  readonly log: (what: string, cause: unknown) => void;
}): AutoSync {
  let running = false;
  let again = false;
  let uploading: { readonly id: string; readonly done: number; readonly total: number } | undefined;
  const failed = new Set<string>();

  const without = (ids: readonly string[], id: string): readonly string[] => ids.filter((other) => other !== id);
  const withId = (ids: readonly string[], id: string): readonly string[] => (ids.includes(id) ? ids : [...ids, id]);

  const reach = async (): Promise<CloudReach> => {
    const store = deps.cloud();
    if (!store) return 'no_helper';
    try {
      const account = await store.account();
      return account === 'available' ? 'ready' : account;
    } catch (cause) {
      deps.log('asking for the iCloud account', cause);
      return 'unknown';
    }
  };

  const status = async (): Promise<CloudSyncStatus> => {
    const [ledger, entries, enabled, reached] = await Promise.all([
      deps.ledger.read(), deps.books(), deps.enabled(), reach(),
    ]);
    const books = await Promise.all(entries.map(async (entry): Promise<BookSync> => {
      const state: BookSyncState = !normalizeEntry(entry).complete ? 'building'
        : ledger.off.includes(entry.id) ? 'off'
        : uploading?.id === entry.id ? 'uploading'
        : failed.has(entry.id) ? 'failed'
        : ledger.sent.includes(entry.id) ? 'synced'
        : 'waiting';
      return {
        id: entry.id, title: entry.title, bytes: await deps.sizeOf(entry), state,
        ...(state === 'uploading' && uploading ? { done: uploading.done, total: uploading.total } : {}),
      };
    }));
    return { reach: reached, enabled, running, books };
  };

  const announce = async (): Promise<void> => {
    try {
      deps.onStatus(await status());
    } catch (cause) {
      deps.log('reporting the iCloud sync status', cause);
    }
  };

  /** Whether the zone holds any of the book itself; a place alone is not the book. */
  const hasBook = (prints: ReadonlyMap<string, string>): boolean =>
    [...prints.keys()].some((name) => name !== PROGRESS_RECORD);

  const syncOne = async (store: CloudStore, entry: LibraryEntry): Promise<void> => {
    const zone = zoneOf(entry.id);
    const before = await deps.ledger.read();
    if (before.off.includes(entry.id)) return;

    // Uploaded from here and gone from there: someone removed it, on the phone or from the terminal.
    if (before.sent.includes(entry.id)) {
      const prints = await store.fingerprints(zone);
      if (!hasBook(prints)) {
        if (prints.size > 0) await store.dropZone(zone);
        await deps.ledger.write({ ...before, off: withId(before.off, entry.id), sent: without(before.sent, entry.id) });
        return;
      }
    }

    uploading = { id: entry.id, done: 0, total: 0 };
    await announce();
    await pushBook(store, await deps.source(entry), (done, total) => {
      uploading = { id: entry.id, done, total };
      void announce();
    });

    const after = await deps.ledger.read();
    if (after.off.includes(entry.id)) {
      // Switched off while it was going up: the upload finished after the zone was dropped.
      await store.dropZone(zone);
      await deps.ledger.write({ ...after, drop: without(after.drop, entry.id) });
      return;
    }
    await deps.ledger.write({ ...after, sent: withId(after.sent, entry.id) });
  };

  /** Take out of iCloud what was switched off while nothing could be removed. */
  const dropPending = async (store: CloudStore): Promise<void> => {
    for (const id of (await deps.ledger.read()).drop) {
      try {
        await store.dropZone(zoneOf(id));
        const now = await deps.ledger.read();
        await deps.ledger.write({ ...now, drop: without(now.drop, id) });
        failed.delete(id);
      } catch (cause) {
        failed.add(id);
        deps.log(`removing ${id} from iCloud`, cause);
      }
    }
  };

  const pass = async (): Promise<void> => {
    if (!(await deps.enabled())) return;
    const store = deps.cloud();
    if (!store || (await reach()) !== 'ready') return;
    await dropPending(store);

    for (const entry of await deps.books()) {
      if (!normalizeEntry(entry).complete) continue;
      if (!(await deps.enabled())) return;
      try {
        await syncOne(store, entry);
        failed.delete(entry.id);
      } catch (cause) {
        failed.add(entry.id);
        deps.log(`syncing ${entry.id} to iCloud`, cause);
        // The account or the network is gone for every book, not this one: stop rather than fail each in turn.
        if (cause instanceof CloudError && (cause.code === 'no_account' || cause.code === 'helper_missing')) return;
      } finally {
        uploading = undefined;
        await announce();
      }
    }
  };

  const run = async (): Promise<void> => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await pass();
      } while (again);
    } finally {
      running = false;
      await announce();
    }
  };

  return {
    status,

    run,

    async setBook(bookId, on) {
      const ledger = await deps.ledger.read();
      if (on) {
        await deps.ledger.write({ off: without(ledger.off, bookId), sent: ledger.sent, drop: without(ledger.drop, bookId) });
        failed.delete(bookId);
        await announce();
        return run();
      }
      // Marked off first, so it is never uploaded again whatever happens to the removal.
      await deps.ledger.write({
        off: withId(ledger.off, bookId), sent: without(ledger.sent, bookId), drop: withId(ledger.drop, bookId),
      });
      const store = deps.cloud();
      // With syncing off this Mac leaves iCloud alone; the copy there goes when syncing is next on.
      if (store && (await deps.enabled())) await dropPending(store);
      await announce();
    },

    async removeAll() {
      const store = deps.cloud();
      if (!store) return;
      const ledger = await deps.ledger.read();
      const ids = new Set([...(await deps.books()).map((entry) => entry.id), ...ledger.sent]);
      let sent = ledger.sent;
      for (const id of ids) {
        try {
          await store.dropZone(zoneOf(id));
          sent = without(sent, id);
        } catch (cause) {
          deps.log(`removing ${id} from iCloud`, cause);
        }
      }
      await deps.ledger.write({ off: ledger.off, sent, drop: ledger.drop.filter((id) => sent.includes(id)) });
      await announce();
    },

    async forget(bookId) {
      const ledger = await deps.ledger.read();
      try {
        if (await deps.enabled()) await deps.cloud()?.dropZone(zoneOf(bookId));
      } catch (cause) {
        deps.log(`removing ${bookId} from iCloud`, cause);
      }
      await deps.ledger.write({
        off: without(ledger.off, bookId), sent: without(ledger.sent, bookId), drop: without(ledger.drop, bookId),
      });
      failed.delete(bookId);
      await announce();
    },

    async allows(bookId) {
      return (await deps.enabled()) && !(await deps.ledger.read()).off.includes(bookId);
    },
  };
}
