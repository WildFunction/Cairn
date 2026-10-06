import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBookSource } from '../../src/store/book-source';
import type { LibraryEntry } from '../../src/store/library';
import { type Library, openLibrary } from '../../src/store/library-disk';
import type { Path } from '../../src/types';

let DIR = '';
let lib: Library;

const path: Path = {
  bookId: 'b1', title: 'Book', type: 'knowledge',
  nodes: ['n0', 'n1', 'n2'].map((id, idx) => ({
    id, idx, title: id, kind: 'concept' as const, brief: '', keyPoints: [], sourceChapters: [0], estMinutes: 3,
  })),
  stages: [], totalMinutes: 9, generatedAt: '2026-01-01T00:00:00.000Z',
};
const entry: LibraryEntry = {
  id: 'b1', title: 'Book', stations: 3, minutes: 9, budgetId: 'brief',
  generatedAt: path.generatedAt, complete: true,
};

async function station(id: string, audio: string): Promise<void> {
  await writeFile(join(DIR, 'books/b1/decks', `${id}.json`), `{"nodeId":"${id}"}`);
  await writeFile(join(DIR, 'books/b1/audio', `${id}.mp3`), audio);
}

beforeEach(async () => {
  DIR = await mkdtemp(join(tmpdir(), 'cairn-source-'));
  lib = openLibrary(DIR);
  await mkdir(join(DIR, 'books/b1/decks'), { recursive: true });
  await mkdir(join(DIR, 'books/b1/audio'), { recursive: true });
  await writeFile(join(DIR, 'books/b1/path.json'), JSON.stringify(path));
});

describe('readBookSource', () => {
  test('reads the stations the deck index calls ready, with absolute audio paths', async () => {
    await station('n0', 'aaa');
    await station('n2', 'ccc');
    await lib.writeDeckIndex('b1', { total: 3, ready: ['n0', 'n2'], failed: ['n1'], complete: true });

    const source = await readBookSource(lib, entry);
    expect(source.path).toEqual(path);
    expect(source.stations.map((s) => s.nodeId)).toEqual(['n0', 'n2']);
    expect(source.stations[0]?.deck).toBe('{"nodeId":"n0"}');
    expect(source.stations[0]?.audio).toBe(join(DIR, 'books/b1/audio/n0.mp3'));
  });

  test('the audio hash follows the bytes', async () => {
    await station('n0', 'aaa');
    await station('n1', 'aaa');
    await station('n2', 'different');
    await lib.writeDeckIndex('b1', { total: 3, ready: ['n0', 'n1', 'n2'], failed: [], complete: true });

    const [a, b, c] = (await readBookSource(lib, entry)).stations;
    expect(a?.audioHash).toBe(b?.audioHash);
    expect(c?.audioHash).not.toBe(a?.audioHash);
  });

  test('a library written before the deck index existed has every station', async () => {
    for (const id of ['n0', 'n1', 'n2']) await station(id, id);
    expect((await readBookSource(lib, entry)).stations).toHaveLength(3);
  });

  test('the cover is resolved against the library root', async () => {
    await lib.writeDeckIndex('b1', { total: 3, ready: [], failed: [], complete: true });
    await writeFile(join(DIR, 'books/b1/cover.jpg'), 'jpeg');

    const source = await readBookSource(lib, { ...entry, cover: 'books/b1/cover.jpg' });
    expect(source.cover?.file).toBe(join(DIR, 'books/b1/cover.jpg'));
    expect(source.cover?.hash).toHaveLength(64);
    expect((await readBookSource(lib, entry)).cover).toBeUndefined();
  });

  test('a ready station whose file is gone is an error, not a shorter book', async () => {
    await station('n0', 'aaa');
    await lib.writeDeckIndex('b1', { total: 3, ready: ['n0', 'n1'], failed: [], complete: true });
    await expect(readBookSource(lib, entry)).rejects.toThrow();
  });
});
