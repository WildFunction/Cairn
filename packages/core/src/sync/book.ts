/**
 * What a book is once it leaves the Mac: one zone, a record per station, and a
 * book record that lands last. The phone is a player only, so nothing here is
 * generation-side — and the chapter text never travels (`chapters.json`,
 * `notes.json` stay out by construction: this module is never handed them).
 */
import { fingerprint } from '../pipeline/fingerprint';
import type { LibraryEntry } from '../store/library';
import type { Path, SourceKind } from '../types';
import type { ContentLocale } from '../parse/language';
import type { CloudRecord } from './cloud';
import type { SyncedPlace } from './progress';

export const BOOK_RECORD = 'book';
export const PROGRESS_RECORD = 'progress';

/** Book ids never hold an underscore, so the prefix cannot collide with one. */
export const zoneOf = (bookId: string): string => `book_${bookId}`;

/** The player's whole view of a book. Bump `format` when a player built for the old shape would misread it. */
export interface SyncedBook {
  readonly format: 1;
  readonly id: string;
  readonly title: string;
  readonly author?: string;
  readonly language?: ContentLocale;
  readonly kind?: SourceKind;
  readonly intro?: string;
  readonly minutes: number;
  readonly path: Path;
}

export interface StationSource {
  readonly nodeId: string;
  /** The deck file's text, verbatim. */
  readonly deck: string;
  readonly audio: string;
  readonly audioHash: string;
}

export interface BookSource {
  readonly entry: LibraryEntry;
  readonly path: Path;
  readonly cover?: { readonly file: string; readonly hash: string };
  /** Stations with a deck on disk. A station that failed to build is simply absent. */
  readonly stations: readonly StationSource[];
}

/** Stations in walking order, the book record last: a reader that sees the book sees all of it. */
export function bookRecords(source: BookSource): readonly CloudRecord[] {
  const { entry, path, cover } = source;
  const byId = new Map(source.stations.map((station) => [station.nodeId, station]));

  const stations = path.nodes.flatMap((node): CloudRecord[] => {
    const station = byId.get(node.id);
    if (!station) return [];
    return [{
      type: 'Station',
      name: station.nodeId,
      fields: {
        deck: { string: station.deck },
        audio: { asset: station.audio },
        fingerprint: { string: fingerprint({ deck: station.deck, audio: station.audioHash }) },
      },
    }];
  });

  const synced: SyncedBook = {
    format: 1,
    id: entry.id,
    title: entry.title,
    ...(entry.author ? { author: entry.author } : {}),
    ...(entry.language ? { language: entry.language } : {}),
    ...(entry.kind ? { kind: entry.kind } : {}),
    ...(entry.intro ? { intro: entry.intro } : {}),
    minutes: entry.minutes,
    path,
  };
  const manifest = JSON.stringify(synced);

  return [...stations, {
    type: 'Book',
    name: BOOK_RECORD,
    fields: {
      manifest: { string: manifest },
      ...(cover ? { cover: { asset: cover.file } } : {}),
      fingerprint: { string: fingerprint({ manifest, cover: cover?.hash }) },
    },
  }];
}

/** The reader's place in a book. Both devices write it; see `progress.ts` for which one wins. */
export function progressRecord(place: SyncedPlace): CloudRecord {
  return {
    type: 'Progress',
    name: PROGRESS_RECORD,
    fields: {
      nodeId: { string: place.nodeId },
      ms: { int: Math.max(0, Math.round(place.ms)) },
      updatedAt: { int: place.updatedAt },
      device: { string: place.device },
    },
  };
}

export interface PushPlan {
  readonly save: readonly CloudRecord[];
  readonly remove: readonly string[];
}

/** `existing` is what the zone holds now, as `CloudStore.fingerprints` reports it. */
export function planPush(
  records: readonly CloudRecord[],
  existing: ReadonlyMap<string, string>,
): PushPlan {
  const wanted = new Set(records.map((record) => record.name));
  return {
    save: records.filter((record) => existing.get(record.name) !== printOf(record)),
    remove: [...existing.keys()].filter((name) => !wanted.has(name) && name !== PROGRESS_RECORD),
  };
}

function printOf(record: CloudRecord): string | undefined {
  const value = record.fields.fingerprint;
  return value && 'string' in value ? value.string : undefined;
}
