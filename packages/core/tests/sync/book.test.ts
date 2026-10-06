import { describe, expect, test } from 'bun:test';
import type { LibraryEntry } from '../../src/store/library';
import {
  BOOK_RECORD, type BookSource, bookRecords, planPush, PROGRESS_RECORD, type SyncedBook, zoneOf,
} from '../../src/sync/book';
import type { Path } from '../../src/types';

const path: Path = {
  bookId: 'book-one', title: 'Book', type: 'knowledge',
  nodes: [
    { id: 'n0', idx: 0, title: 'Start', kind: 'concept', brief: '', keyPoints: [], sourceChapters: [0], estMinutes: 2 },
    { id: 'n1', idx: 1, title: 'Next', kind: 'concept', brief: '', keyPoints: [], sourceChapters: [1], estMinutes: 2 },
  ],
  stages: [{ title: 'Stage', nodeIds: ['n0', 'n1'] }], totalMinutes: 4, generatedAt: '2026-01-01T00:00:00Z',
};
const entry: LibraryEntry = {
  id: 'book-one', title: 'Book', author: 'Someone', stations: 2, minutes: 5, budgetId: 'brief',
  generatedAt: path.generatedAt, complete: true, language: 'en', voice: 'en-US-AvaNeural',
  cover: 'books/book-one/cover.jpg', intro: 'About it.',
  quality: { dropped: 0, retries: 1, failed: 0, unsourcedQuotes: 0, estMinutes: 4, budgetMaxMinutes: 6 },
};
const source: BookSource = {
  entry, path,
  cover: { file: '/lib/books/book-one/cover.jpg', hash: 'c0' },
  // Out of path order on purpose
  stations: [
    { nodeId: 'n1', deck: '{"nodeId":"n1"}', audio: '/lib/books/book-one/audio/n1.mp3', audioHash: 'a1' },
    { nodeId: 'n0', deck: '{"nodeId":"n0"}', audio: '/lib/books/book-one/audio/n0.mp3', audioHash: 'a0' },
  ],
};

const stringOf = (value: unknown): string => (value as { string: string }).string;

describe('bookRecords', () => {
  test('stations come in path order and the book record comes last', () => {
    expect(bookRecords(source).map((r) => `${r.type}:${r.name}`)).toEqual([
      'Station:n0', 'Station:n1', `Book:${BOOK_RECORD}`,
    ]);
  });

  test('a station carries its deck as text and its audio as a file', () => {
    const station = bookRecords(source)[0];
    expect(station?.fields.deck).toEqual({ string: '{"nodeId":"n0"}' });
    expect(station?.fields.audio).toEqual({ asset: '/lib/books/book-one/audio/n0.mp3' });
  });

  test('the manifest holds what a player needs and nothing generation-side', () => {
    const book = bookRecords(source).at(-1);
    const manifest = JSON.parse(stringOf(book?.fields.manifest)) as SyncedBook & Record<string, unknown>;
    expect(manifest).toEqual({
      format: 1, id: 'book-one', title: 'Book', author: 'Someone', language: 'en',
      intro: 'About it.', minutes: 5, path,
    });
    expect(book?.fields.cover).toEqual({ asset: '/lib/books/book-one/cover.jpg' });
  });

  test('a book without a cover has no cover field', () => {
    const { cover: _cover, ...bare } = source;
    expect(bookRecords(bare).at(-1)?.fields.cover).toBeUndefined();
  });

  test('a fingerprint follows the content, not the file location', () => {
    const [before] = bookRecords(source);
    const moved = bookRecords({
      ...source,
      stations: source.stations.map((s) => ({ ...s, audio: s.audio.replace('/lib', '/elsewhere') })),
    })[0];
    const respoken = bookRecords({
      ...source,
      stations: source.stations.map((s) => ({ ...s, audioHash: `${s.audioHash}x` })),
    })[0];
    expect(moved?.fields.fingerprint).toEqual(before?.fields.fingerprint);
    expect(respoken?.fields.fingerprint).not.toEqual(before?.fields.fingerprint);
  });

  test('a new cover changes the book fingerprint', () => {
    const before = bookRecords(source).at(-1)?.fields.fingerprint;
    const after = bookRecords({ ...source, cover: { file: '/lib/books/book-one/cover.jpg', hash: 'c1' } })
      .at(-1)?.fields.fingerprint;
    expect(after).not.toEqual(before);
  });
});

describe('planPush', () => {
  const records = bookRecords(source);
  const prints = new Map(records.map((r) => [r.name, stringOf(r.fields.fingerprint)]));

  test('an empty zone gets everything', () => {
    expect(planPush(records, new Map())).toEqual({ save: records, remove: [] });
  });

  test('records already there with the same fingerprint are skipped', () => {
    const plan = planPush(records, new Map([...prints, ['n1', 'stale']]));
    expect(plan.save.map((r) => r.name)).toEqual(['n1']);
    expect(plan.remove).toEqual([]);
  });

  test('stations the path no longer has are removed', () => {
    expect(planPush(records, new Map([...prints, ['n7', 'old']])).remove).toEqual(['n7']);
  });

  test("the reader's progress is not the book's to remove", () => {
    expect(planPush(records, new Map([...prints, [PROGRESS_RECORD, '']])).remove).toEqual([]);
  });
});

test('a zone name maps back to exactly one book', () => {
  expect(zoneOf('book-one')).toBe('book_book-one');
});
