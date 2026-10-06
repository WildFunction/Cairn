import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LibraryEntry } from '../../src/store/library';
import { type BookSource, bookRecords } from '../../src/sync/book';
import type { NodeDeck, Path } from '../../src/types';

/**
 * The phone decodes exactly this file (`apps/ios/CairnKit/Tests`), so a field
 * renamed here fails a Swift test, and one renamed there fails to decode it.
 * After an intended change: `UPDATE_FIXTURES=1 bun test packages/core/tests/sync/contract.test.ts`.
 */
const FIXTURE = join(import.meta.dirname, 'fixtures/synthetic-book.json');

const path: Path = {
  bookId: 'two-stations-a1b2c3', title: 'Two Stations', type: 'knowledge',
  nodes: [
    {
      id: 'n0', idx: 0, title: 'The first thing', kind: 'concept', brief: 'What the first station makes clear.',
      keyPoints: ['One', 'Two'], sourceChapters: [0, 1], estMinutes: 2,
    },
    {
      id: 'recap', idx: 1, title: 'Looking back', kind: 'recap', brief: 'The path in one breath.',
      keyPoints: [], sourceChapters: [], estMinutes: 1,
    },
  ],
  stages: [{ title: 'Building', nodeIds: ['n0'] }, { title: 'Closing', nodeIds: ['recap'] }],
  totalMinutes: 3, generatedAt: '2026-10-06T00:00:00.000Z',
};

const entry: LibraryEntry = {
  id: path.bookId, title: 'Two Stations', author: 'A. Writer', stations: 2, minutes: 3, budgetId: 'brief',
  generatedAt: path.generatedAt, complete: true, built: 2, language: 'en', voice: 'en-US-EmmaNeural',
  kind: 'book', cover: 'books/two-stations-a1b2c3/cover.jpg', intro: 'A book that exists to be decoded.',
};

const decks: readonly NodeDeck[] = [
  {
    nodeId: 'n0',
    slides: [
      { layout: 'title', title: 'The first thing', atMs: 0 },
      { layout: 'points', heading: 'Two points', points: ['One', 'Two'], atMs: 4000 },
    ],
    narration: [
      { text: 'This is the first thing.', startMs: 0, endMs: 4000 },
      { text: 'One, and then two.', startMs: 4000, endMs: 9000 },
    ],
    audioPath: 'audio/n0.mp3', durationMs: 9000,
  },
  {
    nodeId: 'recap',
    slides: [{ layout: 'title', title: 'Looking back', atMs: 0 }],
    narration: [{ text: 'That was the path.', startMs: 0, endMs: 3000 }],
    audioPath: 'audio/recap.mp3', durationMs: 3000,
  },
];

const source: BookSource = {
  entry, path,
  cover: { file: 'cover.jpg', hash: 'c0' },
  stations: decks.map((deck) => ({
    nodeId: deck.nodeId, deck: JSON.stringify(deck), audio: `audio/${deck.nodeId}.mp3`, audioHash: `a-${deck.nodeId}`,
  })),
};

test('bookRecords still produces the book the phone was built to read', () => {
  const records = bookRecords(source);
  if (process.env.UPDATE_FIXTURES) writeFileSync(FIXTURE, `${JSON.stringify({ records }, null, 2)}\n`);
  expect({ records }).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
});
