/** A book, parsed and priced before a single model call, so the budget choice is informed. */
import { basename } from 'node:path';
import { bookIdFor } from '@cairn/core/books/builder';
import { detectFormat, parseBook, type PdfOcr } from '@cairn/core/parse';
import { parseNotes } from '@cairn/core/parse/notes';
import { suggestBudgets, shapeOf } from '@cairn/core/pipeline/budget';
import { ParseError, type ParsedBook } from '@cairn/core/types';
import type { BookPreview } from '../shared/types';
import { voiceFor } from '../shared/settings';
import { readSettings } from './settings';

/** One book, or any number of Markdown notes walked as one path. `ocr` reads a scanned PDF where the machine can. */
export async function readBook(filePaths: readonly string[], ocr?: PdfOcr): Promise<ParsedBook> {
  const formats = filePaths.map((p) => detectFormat(basename(p)));
  if (formats.length === 0) throw new ParseError('没有选择文件', 'no_content');
  if (formats.length > 1 && formats.some((f) => f !== 'markdown')) {
    throw new ParseError('多选时只能选 Markdown 笔记', 'mixed_selection');
  }

  const read = (p: string): Promise<Uint8Array> => Bun.file(p).arrayBuffer().then((b) => new Uint8Array(b));
  if (formats[0] === 'markdown') {
    return parseNotes(await Promise.all(filePaths.map(async (path) => ({ path, bytes: await read(path) }))));
  }
  const [only] = filePaths;
  if (only === undefined) throw new ParseError('没有选择文件', 'no_content');
  return parseBook(await read(only), basename(only), ocr);
}

/** What a book's id is derived from. Sorted, so the same notes picked in another order are the same path. */
export function sourceOf(filePaths: readonly string[]): string {
  return [...filePaths].sort().join('\n');
}

export async function inspect(filePaths: readonly string[], ocr?: PdfOcr): Promise<BookPreview> {
  const book = await readBook(filePaths, ocr);
  // Derived from this book's shape, never a remembered rung: a stored default
  // went stale the moment a shorter book came along
  const { choices, recommended } = suggestBudgets(shapeOf(book));

  return {
    id: bookIdFor(book, sourceOf(filePaths)),
    filePaths,
    title: book.title,
    ...(book.author ? { author: book.author } : {}),
    chapters: book.chapters.length,
    words: book.totalWords,
    narration: voiceFor(await readSettings(), book.language),
    budgets: choices.map((c) => ({
      id: c.budget.id,
      minutes: c.budget.targetMinutes,
      honest: c.honest,
      ...(c.honest ? {} : { wordsPerNode: Math.round(c.wordsPerNode) }),
      recommended: c.budget.id === recommended,
    })),
  };
}
