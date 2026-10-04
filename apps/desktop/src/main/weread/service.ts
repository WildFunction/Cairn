import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bookFile, isBookId } from '@cairn/core/store/library';
import type { Library } from '@cairn/core/store/library-disk';
import type { BookMeta, WereadShelfBook } from '../../shared/types';
import { wereadClient, type WereadCall } from './client';
import {
  chapterTitleOf, introOf, largerCover, pickHit, shelfBooks, positionOf, quotesOf, searchHits, stationFor, type SearchHit,
} from './match';

export interface Weread {
  /** Popular highlights for a book about to be built; empty when anything is missing. */
  quotes(title: string, author?: string): Promise<readonly string[]>;
  /** Cover, intro and rating, looked up once per book and kept beside it. */
  meta(bookId: string): Promise<BookMeta | null>;
  /** The station matching where the reader stopped in WeChat Reading. */
  startStation(bookId: string): Promise<string | null>;
  /** The reader's own WeChat Reading shelf, ebooks only. */
  shelf(): Promise<readonly WereadShelfBook[]>;
  /** One shelf book's intro; the shelf reply carries none. */
  intro(wereadId: string): Promise<string | null>;
}

/** What is kept in `books/<id>/weread.json`. No `wereadId` means "looked, not found". */
interface Stored extends BookMeta {
  readonly wereadId?: string;
}

/** The home screen asks on every visit; the shelf does not change that often. */
const SHELF_TTL_MS = 5 * 60_000;
const WEREAD_ID = /^[\w-]{1,64}$/;

const MAX_COVER_BYTES = 2 * 1024 * 1024;
const COVER_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};

export function createWeread({ library, keyOf, fetcher = fetch }: {
  readonly library: Library;
  readonly keyOf: () => Promise<string | undefined>;
  readonly fetcher?: typeof fetch;
}): Weread {
  const found = new Map<string, Promise<SearchHit | undefined>>();
  const intros = new Map<string, Promise<string | null>>();
  let shelfCache: { readonly key: string; readonly at: number; readonly books: Promise<readonly WereadShelfBook[]> } | undefined;
  const storedPath = (bookId: string): string => join(library.root, bookFile(bookId, 'weread.json'));

  const client = async (): Promise<WereadCall | undefined> => {
    const key = await keyOf();
    return key ? wereadClient(key, fetcher) : undefined;
  };

  const find = (call: WereadCall, title: string, author?: string): Promise<SearchHit | undefined> => {
    const cacheKey = `${title}\n${author ?? ''}`;
    const hit = found.get(cacheKey) ?? call('/store/search', { keyword: title, scope: 10 })
      .then((raw) => pickHit(searchHits(raw), title, author));
    found.set(cacheKey, hit);
    // A failed search is worth retrying on the next ask; a miss is not
    hit.catch(() => found.delete(cacheKey));
    return hit;
  };

  const readStored = async (bookId: string): Promise<Stored | undefined> => {
    try {
      return JSON.parse(await readFile(storedPath(bookId), 'utf8')) as Stored;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw cause;
    }
  };

  const saveCover = async (bookId: string, url: string): Promise<string | undefined> => {
    if (!url.startsWith('https://')) return undefined;
    const larger = largerCover(url);
    return (larger ? await saveCoverFrom(bookId, larger).catch(() => undefined) : undefined)
      ?? saveCoverFrom(bookId, url);
  };

  const saveCoverFrom = async (bookId: string, url: string): Promise<string | undefined> => {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8_000) });
    const ext = COVER_TYPES[response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''];
    if (!response.ok || !ext) return undefined;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_COVER_BYTES) return undefined;
    const relative = bookFile(bookId, `cover.${ext}`);
    await writeFile(join(library.root, relative), bytes);
    return relative;
  };

  const lookUp = async (bookId: string): Promise<Stored | undefined> => {
    const cached = await readStored(bookId);
    if (cached) return cached;
    const entry = (await library.list()).find((b) => b.id === bookId);
    const call = await client();
    if (!entry || !call) return undefined;

    const hit = await find(call, entry.title, entry.author);
    // The file's own cover is the exact edition, and shares this file name
    const cover = hit?.cover && !entry.cover ? await saveCover(bookId, hit.cover) : undefined;
    const stored: Stored = hit ? {
      wereadId: hit.bookId,
      ...(cover ? { cover } : {}),
      ...(hit.intro ? { intro: hit.intro } : {}),
      ...(hit.rating !== undefined ? { rating: hit.rating } : {}),
    } : {};
    const target = storedPath(bookId);
    await writeFile(`${target}.tmp`, JSON.stringify(stored));
    await rename(`${target}.tmp`, target);
    return stored;
  };

  return {
    async shelf() {
      const key = await keyOf();
      if (!key) return [];
      if (shelfCache?.key !== key || Date.now() - shelfCache.at > SHELF_TTL_MS) {
        const books = wereadClient(key, fetcher)('/shelf/sync').then(shelfBooks);
        shelfCache = { key, at: Date.now(), books };
        books.catch(() => { shelfCache = undefined; });
      }
      return shelfCache.books;
    },

    async intro(wereadId) {
      if (!WEREAD_ID.test(wereadId)) return null;
      const call = await client();
      if (!call) return null;
      const cached = intros.get(wereadId) ?? call('/book/info', { bookId: wereadId })
        .then((raw) => introOf(raw) ?? null);
      intros.set(wereadId, cached);
      cached.catch(() => intros.delete(wereadId));
      return cached;
    },

    async quotes(title, author) {
      const call = await client();
      if (!call) return [];
      const hit = await find(call, title, author);
      return hit ? quotesOf(await call('/book/bestbookmarks', { bookId: hit.bookId })) : [];
    },

    async meta(bookId) {
      if (!isBookId(bookId)) return null;
      const stored = await lookUp(bookId);
      if (!stored) return null;
      const { wereadId: _id, ...meta } = stored;
      return meta;
    },

    async startStation(bookId) {
      if (!isBookId(bookId)) return null;
      const [stored, call] = await Promise.all([lookUp(bookId), client()]);
      if (!stored?.wereadId || !call) return null;
      const position = positionOf(await call('/book/getprogress', { bookId: stored.wereadId }));
      // 0 is unread and 100 is finished: neither says where to pick up
      if (!position || position.progress <= 0 || position.progress >= 100) return null;
      const title = chapterTitleOf(
        await call('/book/chapterinfo', { bookId: stored.wereadId }), position.chapterUid,
      );
      if (!title) return null;
      const [path, notes] = await Promise.all([library.loadPath(bookId), library.loadNotes(bookId)]);
      return stationFor(path.nodes, notes, title) ?? null;
    },
  };
}
