import { describe, expect, test } from 'bun:test';
import { ParseError } from '../../src/types';
import { parsePdf, type PdfOcr } from '../../src/parse/pdf';
import { parseBook } from '../../src/parse';
import { makePdf } from './pdf-fixture';

/** Enough prose per page that a chapter clears chunk.ts's MIN_WORDS. */
function prose(tag: string): string[] {
  return Array.from({ length: 20 }, (_, i) => `${tag} sentence ${i} carries ten plain words of body text.`);
}

/** What an OCR pass returns for these pages: one run per line, 14pt apart, a blank line left as a gap. */
function scanOf(pages: readonly (readonly string[])[]): PdfOcr {
  return async () =>
    pages.map((lines) => lines.flatMap((text, i) => (text ? [{ text, x: 72, y: 740 - i * 14, height: 10 }] : [])));
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof ParseError ? e.code : 'not a ParseError';
  }
}

describe('parsePdf', () => {
  test('chapters follow the outline, and running heads are gone', async () => {
    const pages = [
      ['THE BOOK', ...prose('Alpha'), '1'],
      ['THE BOOK', ...prose('Beta'), '2'],
      ['THE BOOK', ...prose('Gamma'), '3'],
    ];
    const bytes = makePdf({
      title: 'Anchors',
      author: 'A. Writer',
      pages,
      outline: [{ title: 'Chapter One', page: 0 }, { title: 'Chapter Two', page: 2 }],
    });
    const book = await parsePdf(bytes, 'anchors.pdf');

    expect(book.format).toBe('pdf');
    expect(book.title).toBe('Anchors');
    expect(book.author).toBe('A. Writer');
    expect(book.language).toBe('en');
    expect(book.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two']);
    expect(book.chapters[0]!.text).toContain('Beta sentence 19');
    expect(book.chapters.some((c) => c.text.includes('THE BOOK'))).toBe(false);
  });

  test('without an outline, headings in the text split it', async () => {
    const bytes = makePdf({
      pages: [['Chapter 1 Start', '', ...prose('Alpha')], ['Chapter 2 End', '', ...prose('Beta')]],
    });
    const book = await parsePdf(bytes, 'plain.pdf');
    expect(book.title).toBe('plain');
    expect(book.chapters.map((c) => c.title)).toEqual(['Chapter 1 Start', 'Chapter 2 End']);
  });

  test('a PDF with no text layer is named as scanned', async () => {
    expect(await codeOf(parsePdf(makePdf({ pages: [[], [], []] }), 'scan.pdf'))).toBe('scanned_pdf');
  });

  test('a scan is read through OCR when there is one, and split by its headings', async () => {
    const pages = [['Chapter 1 Start', '', ...prose('Alpha')], ['Chapter 2 End', '', ...prose('Beta')]];
    const book = await parsePdf(makePdf({ pages: [[], []] }), 'scan.pdf', scanOf(pages));
    expect(book.chapters.map((c) => c.title)).toEqual(['Chapter 1 Start', 'Chapter 2 End']);
    expect(book.chapters[1]!.text).toContain('Beta sentence 10');
  });

  test("a scan's bookmarks still name its chapters", async () => {
    const bytes = makePdf({
      pages: [[], [], []],
      outline: [{ title: 'Chapter One', page: 0 }, { title: 'Chapter Two', page: 2 }],
    });
    const book = await parsePdf(bytes, 'scan.pdf', scanOf([prose('Alpha'), prose('Beta'), prose('Gamma')]));
    expect(book.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two']);
    expect(book.chapters[0]!.text).toContain('Beta sentence 10');
  });

  test('a scan OCR finds nothing on is still named as scanned', async () => {
    expect(await codeOf(parsePdf(makePdf({ pages: [[], [], []] }), 'scan.pdf', scanOf([[], [], []])))).toBe('scanned_pdf');
  });

  test('a PDF with a text layer is never sent to OCR', async () => {
    let calls = 0;
    const ocr: PdfOcr = async () => {
      calls += 1;
      return [];
    };
    await parsePdf(makePdf({ pages: [prose('Alpha')] }), 'text.pdf', ocr);
    expect(calls).toBe(0);
  });

  test('bytes that are not a PDF', async () => {
    expect(await codeOf(parsePdf(new TextEncoder().encode('not a pdf'), 'x.pdf'))).toBe('unreadable_pdf');
  });

  test('parseBook dispatches .pdf', async () => {
    const book = await parseBook(makePdf({ pages: [prose('Alpha')] }), 'x.PDF');
    expect(book.format).toBe('pdf');
  });
});
