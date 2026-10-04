import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLibrary } from '@cairn/core/store/library-disk';
import type { Path } from '@cairn/core/types';
import { createWeread } from '../../../src/main/weread/service';

const dir = await mkdtemp(join(tmpdir(), 'cairn-weread-'));
const library = openLibrary(dir);
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

const path: Path = {
  bookId: 'pro-git-abc123', title: 'Pro Git', type: 'knowledge', totalMinutes: 4,
  generatedAt: '2026-01-01T00:00:00Z', stages: [],
  nodes: [
    { id: 'n0', idx: 0, title: 'a', kind: 'concept', brief: '', keyPoints: [], sourceChapters: [0], estMinutes: 2 },
    { id: 'n1', idx: 1, title: 'b', kind: 'concept', brief: '', keyPoints: [], sourceChapters: [1], estMinutes: 2 },
  ],
};

beforeAll(async () => {
  await library.installPath(path, [
    { idx: 0, title: 'Getting Started', gist: '', keyPoints: [], quotes: [] },
    { idx: 1, title: 'Git Branching', gist: '', keyPoints: [], quotes: [] },
  ], [], {
    id: path.bookId, title: 'Pro Git', author: 'Scott Chacon', stations: 2, minutes: 4,
    budgetId: 'brief', generatedAt: path.generatedAt,
  });
});

/** The gateway, answering by `api_name`, and counting what it was asked. */
function fakeGateway(progress = 40) {
  const asked: string[] = [];
  const reply = (body: unknown, type = 'application/json'): Response =>
    new Response(type === 'application/json' ? JSON.stringify(body) : body as BodyInit, { headers: { 'content-type': type } });
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://cdn.example/')) return reply(new Uint8Array([1, 2, 3]), 'image/jpeg');
    const { api_name: api, skill_version: version } = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(version).toBeString();
    asked.push(String(api));
    switch (api) {
      case '/store/search': return reply({ results: [{ books: [{
        bookInfo: { bookId: 'w1', title: 'Pro Git（第2版）', author: 'Scott Chacon', cover: 'https://cdn.example/c.jpg', intro: 'Git, all of it.' },
        newRating: 91,
      }] }] });
      case '/book/bestbookmarks': return reply({ items: [{ markText: 'Commit early.' }] });
      case '/book/getprogress': return reply({ book: { chapterUid: 22, progress } });
      case '/shelf/sync': return reply({ books: [
        { bookId: 'w9', title: '置身事内', author: '兰小欢', cover: 'https://cdn.example/s.jpg' },
        { bookId: 'w8', title: 'Plain', cover: 'http://insecure.example/c.jpg' },
        { title: 'no id' },
      ], albums: [{ albumInfo: { albumId: 'a1', name: 'An album' } }] });
      case '/book/info': return reply({ bookId: 'w9', intro: '政府与经济发展。' });
      case '/book/chapterinfo': return reply({ chapters: [{ chapterUid: 22, title: 'Git Branching' }] });
      default: return reply({ errcode: -1 });
    }
  }) as typeof fetch;
  return { fetcher, asked };
}

test('no key means no call and nothing written', async () => {
  const { fetcher, asked } = fakeGateway();
  const weread = createWeread({ library, keyOf: async () => undefined, fetcher });
  expect(await weread.quotes('Pro Git')).toEqual([]);
  expect(await weread.meta(path.bookId)).toBeNull();
  expect(asked).toEqual([]);
});

test('meta is looked up once, cover saved beside the book, and kept', async () => {
  const { fetcher, asked } = fakeGateway();
  const weread = createWeread({ library, keyOf: async () => 'wrk-test', fetcher });
  const meta = await weread.meta(path.bookId);
  expect(meta).toEqual({ cover: `books/${path.bookId}/cover.jpg`, intro: 'Git, all of it.', rating: 91 });
  expect([...await readFile(join(dir, meta!.cover!))]).toEqual([1, 2, 3]);

  // A second process reads the file rather than asking again
  const again = createWeread({ library, keyOf: async () => 'wrk-test', fetcher });
  expect(await again.meta(path.bookId)).toEqual(meta);
  expect(asked).toEqual(['/store/search']);
});

test('quotes and the starting station come from the matched book', async () => {
  const { fetcher } = fakeGateway();
  const weread = createWeread({ library, keyOf: async () => 'wrk-test', fetcher });
  expect(await weread.quotes('Pro Git', 'Scott Chacon')).toEqual(['Commit early.']);
  expect(await weread.startStation(path.bookId)).toBe('n1');
});

test('a finished or unstarted book has no starting station', async () => {
  for (const progress of [0, 100]) {
    const { fetcher } = fakeGateway(progress);
    const weread = createWeread({ library, keyOf: async () => 'wrk-test', fetcher });
    expect(await weread.startStation(path.bookId)).toBeNull();
  }
});

test('the shelf is ebooks only, with https covers, and is asked once in a while rather than every visit', async () => {
  const { fetcher, asked } = fakeGateway();
  const weread = createWeread({ library, keyOf: async () => 'wrk-test', fetcher });
  const expected = [
    { bookId: 'w9', title: '置身事内', author: '兰小欢', cover: 'https://cdn.example/s.jpg' },
    { bookId: 'w8', title: 'Plain' },
  ];
  expect(await weread.shelf()).toEqual(expected);
  expect(await weread.shelf()).toEqual(expected);
  expect(asked).toEqual(['/shelf/sync']);
});

test('an intro is fetched once per book, and an id that is not one is never sent', async () => {
  const { fetcher, asked } = fakeGateway();
  const weread = createWeread({ library, keyOf: async () => 'wrk-test', fetcher });
  expect(await weread.intro('w9')).toBe('政府与经济发展。');
  expect(await weread.intro('w9')).toBe('政府与经济发展。');
  expect(await weread.intro('../x')).toBeNull();
  expect(asked).toEqual(['/book/info']);
});

test('no key, no shelf', async () => {
  const { fetcher, asked } = fakeGateway();
  const weread = createWeread({ library, keyOf: async () => undefined, fetcher });
  expect(await weread.shelf()).toEqual([]);
  expect(await weread.intro('w9')).toBeNull();
  expect(asked).toEqual([]);
});

test('a book with its own cover keeps it: a match brings the intro, not a second cover over the first', async () => {
  const own = { ...path, bookId: 'pro-git-own000' };
  const cover = await library.installCover(own.bookId, { data: new Uint8Array([9, 9]), mediaType: 'image/jpeg' });
  await library.installPath(own, [], [], {
    id: own.bookId, title: 'Pro Git', author: 'Scott Chacon', stations: 2, minutes: 4,
    budgetId: 'brief', generatedAt: own.generatedAt, cover,
  });
  const { fetcher, asked } = fakeGateway();
  const weread = createWeread({ library, keyOf: async () => 'wrk-test', fetcher });
  expect(await weread.meta(own.bookId)).toEqual({ intro: 'Git, all of it.', rating: 91 });
  expect([...await readFile(join(dir, cover))]).toEqual([9, 9]);
  expect(asked).toEqual(['/store/search']);
});

test('a saved WeChat Reading cover is the large one when the CDN has it, the thumbnail when not', async () => {
  for (const [large, expected] of [[true, [7, 7, 7]], [false, [1]]] as const) {
    const book = { ...path, bookId: large ? 'big-cover0001' : 'small-cover001' };
    await library.installPath(book, [], [], {
      id: book.bookId, title: '置身事内', stations: 2, minutes: 4, budgetId: 'brief', generatedAt: book.generatedAt,
    });
    const fetcher = (async (url: string | URL | Request) => {
      const at = String(url);
      if (at.endsWith('/t9_w9.jpg')) return large ? new Response(new Uint8Array([7, 7, 7]), { headers: { 'content-type': 'image/jpeg' } }) : new Response('', { status: 404 });
      if (at.endsWith('/s_w9.jpg')) return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } });
      return new Response(JSON.stringify({ results: [{ books: [{ bookInfo: { bookId: 'w9', title: '置身事内', cover: 'https://cdn.example/w9/s_w9.jpg' } }] }] }));
    }) as typeof fetch;
    const weread = createWeread({ library, keyOf: async () => 'wrk-test', fetcher });
    const meta = await weread.meta(book.bookId);
    expect([...await readFile(join(dir, meta?.cover ?? ''))]).toEqual([...expected]);
  }
});
