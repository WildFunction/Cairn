import { describe, expect, test } from 'bun:test';
import type { LibraryEntry } from '../../src/store/library';
import { type BookSource, bookRecords, zoneOf } from '../../src/sync/book';
import { CloudError, type CloudRecord, type CloudStore } from '../../src/sync/cloud';
import { pushBook } from '../../src/sync/push';
import type { Path } from '../../src/types';

const path: Path = {
  bookId: 'book-one', title: 'Book', type: 'knowledge',
  nodes: [
    { id: 'n0', idx: 0, title: 'Start', kind: 'concept', brief: '', keyPoints: [], sourceChapters: [0], estMinutes: 2 },
    { id: 'n1', idx: 1, title: 'Next', kind: 'concept', brief: '', keyPoints: [], sourceChapters: [1], estMinutes: 2 },
  ],
  stages: [], totalMinutes: 4, generatedAt: '2026-01-01T00:00:00Z',
};
const entry: LibraryEntry = {
  id: 'book-one', title: 'Book', stations: 2, minutes: 4, budgetId: 'brief',
  generatedAt: path.generatedAt, complete: true,
};
const source: BookSource = {
  entry, path,
  stations: [
    { nodeId: 'n0', deck: '{}', audio: '/a/n0.mp3', audioHash: 'a0' },
    { nodeId: 'n1', deck: '{}', audio: '/a/n1.mp3', audioHash: 'a1' },
  ],
};

function fakeCloud(existing: ReadonlyMap<string, string> = new Map()): CloudStore & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    account: async () => 'available',
    read: async () => undefined,
    fingerprints: async (zone) => { calls.push(`fingerprints ${zone}`); return existing; },
    save: async (zone, records) => { calls.push(`save ${zone} ${records.map((r) => r.name).join(',')}`); },
    remove: async (zone, names) => { calls.push(`remove ${zone} ${names.join(',')}`); },
    dropZone: async (zone) => { calls.push(`drop ${zone}`); },
  };
}

const print = (record: CloudRecord | undefined): string =>
  (record?.fields.fingerprint as { string: string }).string;

describe('pushBook', () => {
  const zone = zoneOf('book-one');

  test('stations go up one at a time and the book record last, so its presence means the book is whole', async () => {
    const cloud = fakeCloud();
    const report = await pushBook(cloud, source);
    expect(cloud.calls).toEqual([
      `fingerprints ${zone}`, `save ${zone} n0`, `save ${zone} n1`, `save ${zone} book`,
    ]);
    expect(report).toEqual({ saved: 3, skipped: 0, removed: 0 });
  });

  test('a push interrupted halfway resumes with what is missing', async () => {
    const records = bookRecords(source);
    const cloud = fakeCloud(new Map([['n0', print(records[0])]]));
    const report = await pushBook(cloud, source);
    expect(cloud.calls.filter((c) => c.startsWith('save'))).toEqual([`save ${zone} n1`, `save ${zone} book`]);
    expect(report).toEqual({ saved: 2, skipped: 1, removed: 0 });
  });

  test('stale stations are removed before the book record lands', async () => {
    const cloud = fakeCloud(new Map([['n9', 'old']]));
    await pushBook(cloud, source);
    expect(cloud.calls.slice(-2)).toEqual([`remove ${zone} n9`, `save ${zone} book`]);
  });

  test('an up-to-date book costs one read and no write', async () => {
    const records = bookRecords(source);
    const cloud = fakeCloud(new Map(records.map((r) => [r.name, print(r)])));
    expect(await pushBook(cloud, source)).toEqual({ saved: 0, skipped: 3, removed: 0 });
    expect(cloud.calls).toEqual([`fingerprints ${zone}`]);
  });

  test('a book still being built is refused before anything is sent', async () => {
    const cloud = fakeCloud();
    const pending = pushBook(cloud, { ...source, entry: { ...entry, complete: false } });
    await expect(pending).rejects.toMatchObject({ code: 'incomplete' });
    await expect(pending).rejects.toBeInstanceOf(CloudError);
    expect(cloud.calls).toEqual([]);
  });

  test('progress is reported per record', async () => {
    const seen: string[] = [];
    await pushBook(fakeCloud(), source, (done, total) => seen.push(`${done}/${total}`));
    expect(seen).toEqual(['1/3', '2/3', '3/3']);
  });
});
