/**
 * On-disk layout for generated books.
 *
 * One directory per book so adding a second one never clobbers the first, plus a
 * flat index the app reads at startup to populate its switcher.
 *
 * Decks are one file per station rather than one array, because a book becomes
 * walkable before it is finished: the path lands first, then stations arrive one
 * at a time. A single `decks.json` would have to be rewritten on every arrival
 * and could only be read once it was whole.
 */

import type { ContentLocale } from '../parse/language';
import type { SourceKind } from '../types';

/**
 * What a run is worth, recorded rather than recomputed.
 *
 * Without a completion metric the only signal is whether the owner opens a
 * second book, which is true but useless for judging a prompt change. These are
 * the numbers the pipeline already computes and used to throw away.
 */
export interface PathQuality {
  /** Stations dropped for citing chapters that do not exist. Should be 0. */
  readonly dropped: number;
  /** Times reduce was re-run for overrunning the budget. */
  readonly retries: number;
  /** Stations whose deck could not be built. */
  readonly failed: number;
  /** Quote slides whose text was not found verbatim in any chapter note. */
  readonly unsourcedQuotes: number;
  /** What the model intended, before any audio existed. */
  readonly estMinutes: number;
  /** The budget's ceiling, so drift is readable without looking the budget up. */
  readonly budgetMaxMinutes: number;
}

export interface LibraryEntry {
  readonly id: string;
  readonly title: string;
  readonly author?: string;
  readonly stations: number;
  /** Real audio length once complete; the model's estimate before that. */
  readonly minutes: number;
  readonly budgetId: string;
  readonly generatedAt: string;
  /**
   * Absent in libraries written before decks were built progressively. Readers
   * must treat a missing value as "finished", because that is what it was.
   */
  readonly complete?: boolean;
  /** Stations with a playable deck. Absent means all of them. */
  readonly built?: number;
  readonly quality?: PathQuality;
  /**
   * What this book was written in, and the voice it was actually built with.
   *
   * Both are recorded rather than recomputed: changing the voice in settings
   * must not change what an existing book sounds like, and a half-built book
   * resumed after such a change has to keep using the voice its finished
   * stations already used — otherwise one book ends up in two voices.
   *
   * Absent on books built before this existed. Treat a missing voice as
   * `DEFAULT_VOICE`, because that is what those books were built with.
   */
  readonly language?: ContentLocale;
  readonly voice?: string;
  /** Recorded so a half-built path of notes resumes speaking of notes. Absent means a book. */
  readonly kind?: SourceKind;
  /** The file's own cover, relative to the library root, as everything here must be. */
  readonly cover?: string;
  /** The file's own blurb. */
  readonly intro?: string;
}

export const LIBRARY_INDEX = 'books.json';

export const bookDir = (id: string): string => `books/${id}`;
export const bookFile = (id: string, name: string): string => `${bookDir(id)}/${name}`;
export const audioFile = (id: string, nodeId: string): string =>
  `${bookDir(id)}/audio/${nodeId}.mp3`;

/** One station's deck. Written the moment that station becomes playable. */
export const deckFile = (id: string, nodeId: string): string =>
  `${bookDir(id)}/decks/${nodeId}.json`;

/**
 * Which stations are playable, as a plain file rather than an RPC call.
 *
 * The player already reads the library over the loopback server, so readiness
 * travelling the same way means the webview needs no new channel and the same
 * code works in `bun run dev`, where there is no main process at all.
 */
export const deckIndexFile = (id: string): string => `${bookDir(id)}/decks/index.json`;

export interface DeckIndex {
  readonly total: number;
  readonly ready: readonly string[];
  readonly failed: readonly string[];
  readonly complete: boolean;
}

/**
 * Fill in what an older library did not record.
 * A book written before progressive building was finished by definition.
 */
export function normalizeEntry(entry: LibraryEntry): LibraryEntry & {
  readonly complete: boolean;
  readonly built: number;
} {
  return {
    ...entry,
    complete: entry.complete ?? true,
    built: entry.built ?? entry.stations,
  };
}

/**
 * ASCII-safe directory name, derived from the title plus the source file.
 *
 * The file is part of the id because two different books can share a title — a
 * translation and its original, say — and keying on the title alone lets the
 * second one silently replace the first. Regenerating the *same* file at another
 * budget still lands on the same id, which is what you want.
 */
/**
 * Whether a string can be a book id, which is to say: whether `bookSlug` could
 * have produced it. Guards the one operation that is irreversible — a delete
 * joins this onto the library root, and `..` there would leave it.
 */
export function isBookId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

export function bookSlug(
  title: string,
  hash: (s: string) => string,
  sourcePath = '',
): string {
  const ascii = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const suffix = hash(sourcePath).slice(0, 6);
  return ascii.length >= 3 ? `${ascii.slice(0, 33)}-${suffix}` : `book-${suffix}`;
}
