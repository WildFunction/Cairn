/**
 * The reader's place, between this Mac and iCloud. Only for a book that is in
 * iCloud, only when the helper and the account are there; anything that fails
 * leaves the local place as it was and is logged, never thrown at the reader.
 */
import { BOOK_RECORD, PROGRESS_RECORD, progressRecord, zoneOf } from './book';
import { CloudError, type CloudStore } from './cloud';
import { placeFromFields, type SyncedPlace } from './progress';

/** The phone sends no more often than this while playing; nor does the Mac. */
export const PUSH_EVERY_MS = 30_000;

/** A book found not to be in iCloud is looked for again after this long: it may have been pushed since. */
export const RECHECK_MS = 10 * 60_000;

export interface PositionSync {
  /** The place iCloud holds for the book, or nothing. */
  pull(bookId: string): Promise<SyncedPlace | undefined>;
  /** `force` for a pause, a station change or leaving the book; otherwise throttled. */
  push(bookId: string, place: SyncedPlace, force?: boolean): Promise<void>;
}

export function createPositionSync({
  cloud, allows, now, log,
}: {
  /** Nothing when the helper is not installed. */
  readonly cloud: () => CloudStore | undefined;
  /** Whether the owner has this book syncing at all. Absent means yes. */
  readonly allows?: (bookId: string) => Promise<boolean>;
  readonly now: () => number;
  readonly log: (what: string, cause: unknown) => void;
}): PositionSync {
  let available = false;
  /** Books known to be in iCloud, and when the others were last looked for. */
  const inCloud = new Set<string>();
  const missingAt = new Map<string, number>();
  const pushedAt = new Map<string, number>();

  /** The store to use for this book, or nothing when it is not in iCloud or iCloud is not reachable. */
  const storeFor = async (bookId: string): Promise<CloudStore | undefined> => {
    const store = cloud();
    if (!store) return undefined;
    if (allows && !(await allows(bookId))) return undefined;
    if (!available) {
      if ((await store.account()) !== 'available') return undefined;
      available = true;
    }
    // A book's zone is never created from here: the push of the book creates it.
    if (inCloud.has(bookId)) return store;
    const looked = missingAt.get(bookId);
    if (looked !== undefined && now() - looked < RECHECK_MS) return undefined;
    if ((await store.fingerprints(zoneOf(bookId))).has(BOOK_RECORD)) {
      inCloud.add(bookId);
      return store;
    }
    missingAt.set(bookId, now());
    return undefined;
  };

  return {
    async pull(bookId) {
      try {
        const store = await storeFor(bookId);
        const record = await store?.read(zoneOf(bookId), PROGRESS_RECORD);
        return record ? placeFromFields(record.fields) : undefined;
      } catch (cause) {
        log(`pulling the place in ${bookId}`, cause);
        return undefined;
      }
    },

    async push(bookId, place, force = false) {
      const last = pushedAt.get(bookId);
      if (!force && last !== undefined && now() - last < PUSH_EVERY_MS) return;
      pushedAt.set(bookId, now());
      try {
        const store = await storeFor(bookId);
        // A place never creates the zone: one removed from the phone would come back holding only a place.
        await store?.save(zoneOf(bookId), [progressRecord(place)], { createZone: false });
      } catch (cause) {
        if (cause instanceof CloudError && cause.code === 'zone_missing') {
          inCloud.delete(bookId);
          missingAt.set(bookId, now());
          return;
        }
        log(`pushing the place in ${bookId}`, cause);
      }
    },
  };
}
