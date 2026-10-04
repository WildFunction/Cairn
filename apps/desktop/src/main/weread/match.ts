/**
 * WeChat Reading replies read into Cairn's terms, with no network in sight.
 *
 * Every reply is untrusted JSON from a gateway that trims fields as it likes,
 * so each reader here validates rather than casts. A book is matched by title
 * and author because the reader's file carries no WeChat Reading id.
 */
import type { ChapterNote, PathNode } from '@cairn/core/types';
import type { WereadShelfBook } from '../../shared/types';
import { normalize } from '../../shared/title';

export interface SearchHit {
  readonly bookId: string;
  readonly title: string;
  readonly author?: string;
  readonly cover?: string;
  readonly intro?: string;
  /** 0–100. */
  readonly rating?: number;
}

export interface ReaderPosition {
  readonly chapterUid: number;
  /** 0–100, where only 100 means finished. */
  readonly progress: number;
}

type Json = Record<string, unknown>;

const record = (value: unknown): Json | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : undefined;
const list = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export { normalize };

function overlaps(a: string, b: string): boolean {
  const [x, y] = [normalize(a), normalize(b)];
  if (!x || !y) return false;
  const shorter = x.length <= y.length ? x : y;
  return shorter.length >= 2 && (x.includes(y) || y.includes(x));
}

export function searchHits(raw: unknown): readonly SearchHit[] {
  return list(record(raw)?.results).flatMap((group) => list(record(group)?.books)).flatMap((item) => {
    const row = record(item);
    const info = record(row?.bookInfo);
    const bookId = text(info?.bookId);
    const title = text(info?.title);
    if (!row || !info || !bookId || !title) return [];
    const author = text(info.author);
    const cover = text(info.cover);
    const intro = text(info.intro);
    const rating = num(row.newRating);
    return [{
      bookId, title,
      ...(author ? { author } : {}),
      ...(cover ? { cover } : {}),
      ...(intro ? { intro } : {}),
      ...(rating !== undefined && rating > 0 ? { rating } : {}),
    }];
  });
}

/** Ebooks only: albums are audio, and Cairn has nothing to make of one. */
export function shelfBooks(raw: unknown): readonly WereadShelfBook[] {
  return list(record(raw)?.books).flatMap((item) => {
    const row = record(item);
    const bookId = text(row?.bookId);
    const title = text(row?.title);
    if (!row || !bookId || !title) return [];
    const author = text(row.author);
    const cover = text(row.cover);
    const safe = cover?.startsWith('https://') ? cover : undefined;
    const larger = safe ? largerCover(safe) : undefined;
    return [{
      bookId, title,
      ...(author ? { author } : {}),
      ...(larger ? { cover: larger, coverFallback: safe } : safe ? { cover: safe } : {}),
    }];
  });
}

/**
 * The same cover at 428×616. Search and the shelf hand out a 70×101 thumbnail
 * (`s_`); the CDN serves each size under its own prefix.
 */
export function largerCover(url: string): string | undefined {
  const larger = url.replace(/\/(?:s|t\d)_([^/]+)$/, '/t9_$1');
  return larger === url ? undefined : larger;
}

export function introOf(raw: unknown): string | undefined {
  return text(record(raw)?.intro);
}

/**
 * An exact title first, a containing one second — "三体" must not land on
 * "三体Ⅱ" when the first volume is also listed. An author both sides name must agree.
 */
export function pickHit(hits: readonly SearchHit[], title: string, author?: string): SearchHit | undefined {
  const authorAgrees = (hit: SearchHit): boolean =>
    !author || !hit.author || overlaps(author, hit.author);
  const wanted = normalize(title);
  return hits.find((hit) => normalize(hit.title) === wanted && authorAgrees(hit))
    ?? hits.find((hit) => overlaps(hit.title, title) && authorAgrees(hit));
}

/** Longer than this and a quote no longer fits the progress modal's few lines. */
const MAX_QUOTE_CHARS = 140;

export function quotesOf(raw: unknown): readonly string[] {
  const seen = new Set<string>();
  return list(record(raw)?.items).flatMap((item) => {
    const quote = text(record(item)?.markText)?.replace(/\s+/g, ' ');
    if (!quote || seen.has(quote) || [...quote].length > MAX_QUOTE_CHARS) return [];
    seen.add(quote);
    return [quote];
  });
}

export function positionOf(raw: unknown): ReaderPosition | undefined {
  const book = record(record(raw)?.book);
  const chapterUid = num(book?.chapterUid);
  const progress = num(book?.progress);
  return chapterUid === undefined || progress === undefined ? undefined : { chapterUid, progress };
}

export function chapterTitleOf(raw: unknown, chapterUid: number): string | undefined {
  const chapter = list(record(raw)?.chapters).map(record).find((c) => num(c?.chapterUid) === chapterUid);
  return text(chapter?.title);
}

/**
 * The station that teaches the chapter the reader stopped in, or the first one
 * after it when a tighter budget dropped that chapter.
 */
export function stationFor(
  nodes: readonly PathNode[], notes: readonly ChapterNote[], chapterTitle: string,
): string | undefined {
  const wanted = normalize(chapterTitle);
  const chapter = notes.find((n) => normalize(n.title) === wanted)
    ?? notes.find((n) => overlaps(n.title, chapterTitle));
  if (!chapter) return undefined;
  const stations = nodes.filter((n) => n.kind !== 'recap' && n.sourceChapters.length > 0);
  return (stations.find((n) => n.sourceChapters.includes(chapter.idx))
    ?? stations.find((n) => Math.min(...n.sourceChapters) > chapter.idx))?.id;
}
