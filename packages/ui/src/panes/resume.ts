/**
 * Where the reader left off.
 *
 * A path is walked over several sittings, so closing the app and reopening it
 * should put the reader back on the station they were on, at the second they
 * stopped — not at the top of the book. The station alone is not enough: a
 * station is minutes long, and restarting it means listening to it twice.
 *
 * Plain functions with no React and no storage in sight. What is worth testing
 * is the arithmetic and the validation of stored JSON, which was written by an
 * older version of this app and may say anything at all.
 */

export interface Place {
  readonly nodeId: string;
  /** Audio offset inside that station. */
  readonly ms: number;
  /** When it was recorded, in epoch ms, so iCloud's copy can be compared with it. Absent in older stores. */
  readonly updatedAt?: number;
}

export interface ResumeStore {
  /** The book to reopen on launch. Absent means "start on the shelf". */
  readonly lastBookId?: string;
  readonly places: Readonly<Record<string, Place>>;
}

export const EMPTY_RESUME: ResumeStore = { places: {} };

/**
 * Resuming this close to a station's start is not worth it — the reader gets a
 * mid-sentence entry for a few saved seconds. Rewind to the top instead.
 */
const FLOOR_MS = 8_000;

/**
 * Nor is resuming this close to the end: the station is effectively finished and
 * landing on its last breath teaches nothing. Start it over.
 */
const TAIL_MS = 5_000;

/** Stored JSON is untrusted: it was written by an older build of this app. */
export function parseStored(raw: string | null, fallback: ResumeStore = EMPTY_RESUME): ResumeStore {
  if (raw === null) return fallback;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof value !== 'object' || value === null) return fallback;

  const record = value as { lastBookId?: unknown; places?: unknown };
  const places: Record<string, Place> = {};
  if (typeof record.places === 'object' && record.places !== null) {
    for (const [bookId, place] of Object.entries(record.places as Record<string, unknown>)) {
      const parsed = toPlace(place);
      if (parsed) places[bookId] = parsed;
    }
  }

  const lastBookId = typeof record.lastBookId === 'string' && record.lastBookId.length > 0
    ? record.lastBookId
    : undefined;

  return lastBookId ? { lastBookId, places } : { places };
}

function toPlace(value: unknown): Place | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const p = value as { nodeId?: unknown; ms?: unknown };
  if (typeof p.nodeId !== 'string' || p.nodeId.length === 0) return undefined;
  const ms = Number(p.ms);
  const at = (p as { updatedAt?: unknown }).updatedAt;
  return {
    nodeId: p.nodeId,
    ms: Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0,
    ...(typeof at === 'number' && Number.isFinite(at) ? { updatedAt: at } : {}),
  };
}

/** Record a position. Returns a new store; nothing is mutated. */
export function remember(store: ResumeStore, bookId: string, place: Place): ResumeStore {
  return {
    lastBookId: bookId,
    places: {
      ...store.places,
      [bookId]: {
        nodeId: place.nodeId,
        ms: Math.max(0, Math.round(place.ms)),
        ...(place.updatedAt !== undefined ? { updatedAt: place.updatedAt } : {}),
      },
    },
  };
}

/** Opening a book only changes which one to reopen; the stored positions stand. */
export function openBook(store: ResumeStore, bookId: string): ResumeStore {
  return { lastBookId: bookId, places: store.places };
}

/** Returning to the shelf is deliberate, so the next launch should open there too. */
export function closeBook(store: ResumeStore): ResumeStore {
  return { places: store.places };
}

/**
 * Drop a deleted book's position. Re-adding the same file lands on the same id
 * (`bookSlug` hashes the path), so a kept place would resume the new path at a
 * station that no longer exists.
 */
export function forgetBook(store: ResumeStore, bookId: string): ResumeStore {
  const { [bookId]: _gone, ...places } = store.places;
  return store.lastBookId === bookId ? { places } : { ...store, places };
}

/**
 * Where playback should start for a station, given what was stored.
 *
 * `durationMs` is the station's real length, so the tail rule can be applied; 0
 * means it is not known yet and only the floor rule applies.
 */
export function startAt(place: Place | undefined, nodeId: string, durationMs = 0): number {
  if (!place || place.nodeId !== nodeId) return 0;
  if (place.ms < FLOOR_MS) return 0;
  if (durationMs > 0 && place.ms > durationMs - TAIL_MS) return 0;
  return place.ms;
}

export function placeIn(store: ResumeStore, bookId: string): Place | undefined {
  return store.places[bookId];
}

/**
 * Whether a new position is worth writing yet.
 *
 * `timeupdate` fires several times a second and each write is a JSON
 * serialization of the whole store. Losing a few seconds of position costs the
 * reader nothing; writing 250ms apart costs it on every station.
 */
const WRITE_EVERY_MS = 5_000;

export function shouldWrite(previous: Place | undefined, next: Place): boolean {
  if (!previous || previous.nodeId !== next.nodeId) return true;
  return Math.abs(next.ms - previous.ms) >= WRITE_EVERY_MS;
}
