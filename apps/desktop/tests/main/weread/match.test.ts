import { describe, expect, test } from 'bun:test';
import type { ChapterNote, PathNode } from '@cairn/core/types';
import {
  chapterTitleOf, largerCover, pickHit, positionOf, quotesOf, searchHits, stationFor,
} from '../../../src/main/weread/match';

const hit = (bookId: string, title: string, author?: string) =>
  ({ bookInfo: { bookId, title, ...(author ? { author } : {}) } });

describe('pickHit', () => {
  test('an exact title beats an earlier hit that only contains it', () => {
    const hits = searchHits({ results: [{ books: [hit('2', '三体Ⅱ：黑暗森林', '刘慈欣'), hit('1', '三体', '刘慈欣')] }] });
    expect(pickHit(hits, '三体', '刘慈欣')?.bookId).toBe('1');
  });

  test('an author both sides name must agree', () => {
    const hits = searchHits({ results: [{ books: [hit('x', '人类简史', '别人'), hit('y', '人类简史', '[以色列] 尤瓦尔·赫拉利 著')] }] });
    expect(pickHit(hits, '人类简史', '尤瓦尔·赫拉利')?.bookId).toBe('y');
  });

  test('no plausible title is no match, not the first hit', () => {
    const hits = searchHits({ results: [{ books: [hit('z', '完全无关')] }] });
    expect(pickHit(hits, 'Pro Git')).toBeUndefined();
  });

  test('rows missing an id or title are dropped, rating 0 is no rating', () => {
    const hits = searchHits({ results: [{ books: [{ bookInfo: { title: 'no id' } }, { ...hit('a', 'A'), newRating: 0 }] }] });
    expect(hits).toEqual([{ bookId: 'a', title: 'A' }]);
  });
});

test('quotesOf dedupes, collapses whitespace and drops quotes too long to show', () => {
  const raw = { items: [{ markText: ' 一句\n话 ' }, { markText: '一句 话' }, { markText: '长'.repeat(141) }, {}] };
  expect(quotesOf(raw)).toEqual(['一句 话']);
});

test('positionOf and chapterTitleOf read the documented shapes', () => {
  expect(positionOf({ book: { chapterUid: 7, progress: 42 } })).toEqual({ chapterUid: 7, progress: 42 });
  expect(positionOf({ book: {} })).toBeUndefined();
  expect(chapterTitleOf({ chapters: [{ chapterUid: 7, title: '第三章 黑暗森林' }] }, 7)).toBe('第三章 黑暗森林');
});

describe('stationFor', () => {
  const node = (id: string, sourceChapters: number[], kind: PathNode['kind'] = 'concept'): PathNode =>
    ({ id, idx: 0, title: id, kind, brief: '', keyPoints: [], sourceChapters, estMinutes: 1 });
  const note = (idx: number, title: string): ChapterNote => ({ idx, title, gist: '', keyPoints: [], quotes: [] });
  const nodes = [node('n0', [0]), node('n1', [1, 2]), node('n2', [5]), node('recap', [0, 1, 2, 5], 'recap')];
  const notes = [note(0, '序'), note(1, 'Getting Started'), note(2, 'Git Basics'), note(3, 'Branching'), note(5, 'Internals')];

  test('the station that teaches the chapter, never the recap', () => {
    expect(stationFor(nodes, notes, 'git basics')).toBe('n1');
  });

  test('a chapter a tighter budget dropped lands on the next station', () => {
    expect(stationFor(nodes, notes, 'Branching')).toBe('n2');
  });

  test('a title this book does not have is no station', () => {
    expect(stationFor(nodes, notes, '版权信息')).toBeUndefined();
  });
});

test('largerCover asks the CDN for the 428×616 cover in place of any smaller one', () => {
  const at = (p: string): string => `https://cdn.weread.qq.com/weread/cover/66/YueWen_1/${p}YueWen_1.jpg`;
  expect(largerCover(at('s_'))).toBe(at('t9_'));
  expect(largerCover(at('t6_'))).toBe(at('t9_'));
  expect(largerCover(at('t9_'))).toBeUndefined();
  expect(largerCover('https://cdn.example/cover.jpg')).toBeUndefined();
});
