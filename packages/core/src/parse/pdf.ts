/**
 * PDF books with a text layer. Chapters come from the bookmarks when the file
 * has them and from headings in the text when it does not. A scan has no text
 * to read: it goes to the caller's OCR when there is one, and is named as a
 * scan when there is not. Its bookmarks are read either way.
 */
import { getDocumentProxy } from 'unpdf';
import { type Chapter, type ParsedBook, ParseError } from '../types';
import { chunkBlocks } from './chunk';
import { localeFromText } from './language';
import {
  blocksFromOutline,
  linesFromRuns,
  type OcrRun,
  type OutlineMark,
  pageParagraphs,
  type PdfLine,
  stripRunningLines,
  textOfPages,
} from './pdf-layout';
import { countWords } from './text';
import { splitPlainText } from './txt';
import { promptsFor } from '../pipeline/prompts';

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;
type OutlineNode = NonNullable<Awaited<ReturnType<PdfDocument['getOutline']>>>[number];

/** Below this many words per page the text layer is a scan's stray OCR, not a book. */
const MIN_WORDS_PER_PAGE = 10;

/** Every page of a scan as the text found on it. `runtime/vision-ocr.ts` is the one there is. */
export type PdfOcr = (bytes: Uint8Array) => Promise<readonly (readonly OcrRun[])[]>;

type Pages = readonly (readonly string[])[];

export async function parsePdf(bytes: Uint8Array, fileName: string, ocr?: PdfOcr): Promise<ParsedBook> {
  if (bytes.byteLength === 0) throw new ParseError('文件为空', 'empty_file');

  const pdf = await open(bytes);
  try {
    const typeset = paragraphsOf(await readLines(pdf));
    const pages = isScan(typeset) && ocr ? paragraphsOf((await ocr(bytes)).map(linesFromRuns)) : typeset;
    if (isScan(pages)) throw new ParseError('PDF 没有文字层，可能是扫描件', 'scanned_pdf');

    const language = localeFromText(textOfPages(pages.slice(0, 30)).slice(0, 4000));
    const { parse } = promptsFor(language);
    const marks = await readOutline(pdf);
    const chapters =
      marks.length >= 2
        ? nameOpening(chunkBlocks(blocksFromOutline(pages, marks)), parse.opening)
        : splitPlainText(textOfPages(pages), parse);
    if (chapters.length === 0) throw new ParseError('未能切分出任何章节', 'no_content');

    const info = await readInfo(pdf);
    return {
      title: info.title ?? stripExtension(fileName),
      author: info.author,
      format: 'pdf',
      chapters,
      totalWords: chapters.reduce((sum, c) => sum + c.wordCount, 0),
      // A PDF's /Lang is rarely set and as unreliable as dc:language, so the text decides
      language,
    };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

function paragraphsOf(pages: readonly (readonly PdfLine[])[]): Pages {
  return stripRunningLines(pages).map(pageParagraphs);
}

function isScan(pages: Pages): boolean {
  const words = pages.reduce((sum, page) => sum + page.reduce((n, p) => n + countWords(p), 0), 0);
  return words < pages.length * MIN_WORDS_PER_PAGE;
}

async function open(bytes: Uint8Array): Promise<PdfDocument> {
  try {
    // pdf.js transfers the buffer it is given; the caller's bytes must survive the call.
    return await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ParseError(`PDF 无法打开：${reason}`, 'unreadable_pdf');
  }
}

async function readLines(pdf: PdfDocument): Promise<readonly (readonly PdfLine[])[]> {
  const pages: (readonly PdfLine[])[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push(toLines(content.items.flatMap((item) => ('str' in item ? [item] : []))));
    page.cleanup();
  }
  return pages;
}

interface TextRun {
  readonly str: string;
  readonly transform: readonly number[];
  readonly height: number;
}

/** Runs sharing a baseline are one line; pdf.js splits a line wherever the font or spacing changes. */
function toLines(runs: readonly TextRun[]): readonly PdfLine[] {
  const lines: { parts: string[]; y: number }[] = [];
  for (const run of runs) {
    const y = run.transform[5] ?? 0;
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.y - y) <= Math.max(run.height / 2, 2)) current.parts.push(run.str);
    else lines.push({ parts: [run.str], y });
  }
  return lines
    .map((l) => ({ text: l.parts.join('').replace(/\s+/g, ' ').trim(), y: l.y }))
    .filter((l) => l.text.length > 0);
}

/**
 * Bookmarks two levels deep, grouped under their top-level entry. A single root
 * entry is usually the book's own title, so its children stand in for the top.
 */
async function readOutline(pdf: PdfDocument): Promise<readonly OutlineMark[]> {
  const outline = (await pdf.getOutline()) ?? [];
  const top = outline.length === 1 && outline[0]!.items.length > 0 ? outline[0]!.items : outline;

  const marks: OutlineMark[] = [];
  for (const entry of top) {
    const group = entry.title.trim();
    for (const node of [entry, ...entry.items]) {
      const page = await pageOf(pdf, node);
      if (page !== undefined && node.title.trim().length > 0) marks.push({ title: node.title.trim(), page, group });
    }
  }
  return marks;
}

/** A bookmark that points nowhere is skipped: the pages it would open still belong to its neighbour. */
async function pageOf(pdf: PdfDocument, node: OutlineNode): Promise<number | undefined> {
  try {
    const dest = typeof node.dest === 'string' ? await pdf.getDestination(node.dest) : node.dest;
    const target = dest?.[0];
    if (typeof target === 'number') return target;
    if (target && typeof target === 'object' && 'num' in target) return await pdf.getPageIndex(target);
    return undefined;
  } catch {
    return undefined;
  }
}

async function readInfo(pdf: PdfDocument): Promise<{ title?: string; author?: string }> {
  const { info } = await pdf.getMetadata();
  const title = field(info, 'Title');
  return {
    // Word and InDesign stamp the source file's name here, which is no title at all
    title: title && !/\.(docx?|indd|pdf|tex)$/i.test(title) ? title : undefined,
    author: field(info, 'Author'),
  };
}

function field(info: unknown, key: string): string | undefined {
  if (typeof info !== 'object' || info === null || !(key in info)) return undefined;
  const value: unknown = (info as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function nameOpening(chapters: readonly Chapter[], opening: string): readonly Chapter[] {
  return chapters.map((c) => (c.title.length > 0 ? c : { ...c, title: opening }));
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '') || fileName;
}
