/**
 * The library on disk: the one module that knows how a book is laid out under
 * the data directory, and the only one that writes it. The app and `add-book`
 * both go through it, so a book made by either is the same book to the player.
 * The file layout itself is `store/library.ts`, which the webview can import.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { BookCover, Chapter, ChapterNote, CoverType, NodeDeck, Path } from '../types';
import {
  audioFile, bookDir, bookFile, type DeckIndex, deckFile, deckIndexFile, isBookId,
  LIBRARY_INDEX, type LibraryEntry, normalizeEntry,
} from './library';

const COVER_EXT: Readonly<Record<CoverType, string>> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
};

export interface Library {
  readonly root: string;
  /** Generation-side scratch for one book: map results, build cache, audio, traces. Never travels. */
  cacheDir(bookId: string): string;

  list(): Promise<readonly LibraryEntry[]>;
  /** Put the path on disk and make the book openable, before a single deck exists. */
  installPath(
    path: Path, notes: readonly ChapterNote[], chapters: readonly Chapter[], entry: LibraryEntry,
  ): Promise<LibraryEntry>;
  /** Writes the file's cover beside the book and returns its path relative to the root. */
  installCover(bookId: string, cover: BookCover): Promise<string>;
  /** One station becomes playable: its deck and its audio, together. */
  installDeck(bookId: string, deck: NodeDeck, audioDir: string): Promise<void>;
  writeDeckIndex(bookId: string, index: DeckIndex): Promise<void>;
  readDeckIndex(bookId: string): Promise<DeckIndex | undefined>;
  /** Replace the path once its real audio length is known. */
  rewritePath(path: Path): Promise<void>;
  patchEntry(bookId: string, patch: Partial<LibraryEntry>): Promise<LibraryEntry | undefined>;
  /** Delist the book, then remove its files and its cache. Irreversible. */
  remove(bookId: string): Promise<boolean>;

  loadPath(bookId: string): Promise<Path>;
  loadNotes(bookId: string): Promise<ChapterNote[]>;
  /** Chapter text stays out of what the player loads; anchored questions read it here. */
  loadChapter(bookId: string, idx: number): Promise<Chapter | undefined>;
}

const APP_DIR = 'Cairn';

/**
 * `~/Library/Application Support/Cairn` on macOS, `%APPDATA%\Cairn` on Windows,
 * XDG elsewhere. Never cwd-derived: the app starts inside its own bundle, which
 * the next build wipes.
 */
export function defaultLibraryDir(
  platform: NodeJS.Platform = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  const override = env.CAIRN_DATA_DIR;
  if (override) return override;

  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', APP_DIR);
  }
  if (platform === 'win32') {
    return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), APP_DIR);
  }
  const xdg = env.XDG_DATA_HOME;
  return xdg ? join(xdg, APP_DIR) : join(home, '.local', 'share', 'cairn');
}

/**
 * One per root per process: the write chain and the read cache are per
 * instance, and a second instance would race the first and serve stale reads.
 */
export function openLibrary(root: string): Library {
  const at = (relative: string): string => join(root, relative);
  const dirOf = (bookId: string): string => at(bookDir(bookId));

  // Decks land from several lanes at once; a read-modify-write of the index
  // from two of them at the same time loses one of the updates.
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  const cache = new Map<string, unknown>();
  const forget = (bookId: string): void => {
    for (const key of [...cache.keys()]) {
      if (key.startsWith(`books/${bookId}/`)) cache.delete(key);
    }
  };
  const json = async <T>(relative: string): Promise<T> => {
    const hit = cache.get(relative);
    if (hit !== undefined) return hit as T;
    const value = JSON.parse(await readFile(at(relative), 'utf8')) as T;
    cache.set(relative, value);
    return value;
  };

  const list = async (): Promise<readonly LibraryEntry[]> => {
    try {
      const raw = JSON.parse(await readFile(at(LIBRARY_INDEX), 'utf8')) as LibraryEntry[];
      return raw.map(normalizeEntry);
    } catch {
      return [];
    }
  };
  // Whole-file replace: a torn index reads as empty, and the next write would then drop every book
  const writeIndex = (entries: readonly LibraryEntry[]): Promise<void> =>
    writeAtomic(at(LIBRARY_INDEX), JSON.stringify(entries));

  const writeDeckIndex = async (bookId: string, index: DeckIndex): Promise<void> => {
    await mkdir(join(dirOf(bookId), 'decks'), { recursive: true });
    await writeFile(at(deckIndexFile(bookId)), JSON.stringify(index));
  };

  const upsert = (entry: LibraryEntry): Promise<LibraryEntry> => serialize(async () => {
    const index = await list();
    await writeIndex([entry, ...index.filter((b) => b.id !== entry.id)]);
    return entry;
  });

  return {
    root,
    cacheDir: (bookId) => at(join('.cache', bookId)),
    list,

    async installPath(path, notes, chapters, entry) {
      // Decks and audio go, not the directory: a re-run at another budget need
      // not reuse the same node ids, and stale stations would linger.
      const dir = dirOf(path.bookId);
      await rm(join(dir, 'decks'), { recursive: true, force: true });
      await rm(join(dir, 'audio'), { recursive: true, force: true });
      await mkdir(join(dir, 'decks'), { recursive: true });
      await mkdir(join(dir, 'audio'), { recursive: true });

      await writeFile(join(dir, 'path.json'), JSON.stringify(path));
      await writeFile(join(dir, 'notes.json'), JSON.stringify(notes));
      await writeFile(join(dir, 'chapters.json'), JSON.stringify(chapters));
      await writeDeckIndex(path.bookId, {
        total: path.nodes.length, ready: [], failed: [], complete: path.nodes.length === 0,
      });

      forget(path.bookId);
      return upsert(entry);
    },

    async installCover(bookId, cover) {
      const relative = bookFile(bookId, `cover.${COVER_EXT[cover.mediaType]}`);
      await mkdir(dirOf(bookId), { recursive: true });
      await writeFile(at(relative), cover.data);
      return relative;
    },

    async installDeck(bookId, deck, audioDir) {
      await mkdir(join(dirOf(bookId), 'audio'), { recursive: true });
      // Source is content-keyed (`deckKey`), destination is the station id the
      // player builds its URL from; rebuilding the source from the id shipped
      // one budget's audio under another budget's subtitles.
      await Bun.write(at(audioFile(bookId, deck.nodeId)), Bun.file(join(audioDir, basename(deck.audioPath))));

      // Relative to the book, never the build cache: see `NodeDeck.audioPath`
      await mkdir(join(dirOf(bookId), 'decks'), { recursive: true });
      await writeFile(
        at(deckFile(bookId, deck.nodeId)),
        JSON.stringify({ ...deck, audioPath: `audio/${deck.nodeId}.mp3` }),
      );
    },

    writeDeckIndex,

    async readDeckIndex(bookId) {
      try {
        return JSON.parse(await readFile(at(deckIndexFile(bookId)), 'utf8')) as DeckIndex;
      } catch {
        return undefined;
      }
    },

    async rewritePath(path) {
      await writeFile(at(bookFile(path.bookId, 'path.json')), JSON.stringify(path));
      forget(path.bookId);
    },

    patchEntry: (bookId, patch) => serialize(async () => {
      const index = await list();
      const current = index.find((b) => b.id === bookId);
      if (!current) return undefined;
      const updated = { ...current, ...patch };
      await writeIndex(index.map((b) => (b.id === bookId ? updated : b)));
      return updated;
    }),

    // The id crosses the RPC bridge and is joined onto the root, so it must be a
    // shape `bookSlug` produces *and* already listed. Delisting goes first: a
    // failed removal then leaves an absent book, not a listed one that cannot open.
    remove: (bookId) => serialize(async () => {
      if (!isBookId(bookId)) return false;
      const index = await list();
      if (!index.some((b) => b.id === bookId)) return false;

      await writeIndex(index.filter((b) => b.id !== bookId));
      await rm(dirOf(bookId), { recursive: true, force: true });
      await rm(at(join('.cache', bookId)), { recursive: true, force: true });
      forget(bookId);
      return true;
    }),

    loadPath: (bookId) => json<Path>(bookFile(bookId, 'path.json')),
    loadNotes: (bookId) => json<ChapterNote[]>(bookFile(bookId, 'notes.json')),
    async loadChapter(bookId, idx) {
      const chapters = await json<Chapter[]>(bookFile(bookId, 'chapters.json')).catch(() => []);
      return chapters.find((c) => c.idx === idx);
    },
  };
}

async function writeAtomic(file: string, contents: string): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, contents);
  await rename(tmp, file);
}
