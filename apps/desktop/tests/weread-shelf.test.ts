import { expect, test } from 'bun:test';
import type { LibraryEntry } from '@cairn/core/store/library';
import { notInLibrary } from '../src/WereadShelf';

const entry = (title: string): LibraryEntry => ({
  id: 'x-000000', title, stations: 1, minutes: 1, budgetId: 'brief', generatedAt: '',
});

test('a book already walked here is not offered again, however its title is punctuated', () => {
  const shelf = [
    { bookId: '1', title: '置身事内：中国政府与经济发展' },
    { bookId: '2', title: 'Pro Git' },
  ];
  expect(notInLibrary(shelf, [entry('置身事内 中国政府与经济发展')])).toEqual([{ bookId: '2', title: 'Pro Git' }]);
  expect(notInLibrary(shelf, [])).toEqual(shelf);
});
