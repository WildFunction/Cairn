/**
 * Turning a PDF's positioned lines back into prose. A PDF has no paragraphs,
 * only lines at coordinates, plus the running heads and page numbers every
 * printed page repeats. Kept apart from `pdf.ts` so it is testable without a PDF.
 */
import type { Block } from './chunk';

export interface PdfLine {
  readonly text: string;
  /** Baseline, in PDF units from the bottom of the page. */
  readonly y: number;
}

/** A patch of text OCR found on a page, placed in PDF units from the page's bottom-left corner. */
export interface OcrRun {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

export interface OutlineMark {
  readonly title: string;
  /** Zero-based page index the bookmark points at. */
  readonly page: number;
  /** The top-level bookmark this one sits under; only same-group blocks merge. */
  readonly group: string;
}

/** A running head on fewer pages than this is indistinguishable from a real first line. */
const MIN_REPEATS = 3;
/** Lines checked at each end of a page. A header drawn after the body lands beside the footer, not at the top. */
const EDGE_LINES = 2;
/** A line gap this much wider than the page's usual one is a paragraph break. */
const PARAGRAPH_GAP = 1.3;

const PAGE_NUMBER = /^[\s\-–—]*(?:\d{1,4}|[ivxlcdm]{1,7})[\s\-–—]*$/i;
const CJK = /[　-〿㐀-䶿一-鿿＀-￯]/u;
const SENTENCE_END = /[.!?。！？…:：;；"”’)）」』]$/u;

/** Drop lines at either end of a page that are page numbers or repeat across pages. */
export function stripRunningLines(pages: readonly (readonly PdfLine[])[]): readonly (readonly PdfLine[])[] {
  const counts = new Map<string, number>();
  for (const lines of pages) {
    for (const line of edges(lines)) counts.set(runningKey(line.text), (counts.get(runningKey(line.text)) ?? 0) + 1);
  }
  const isRunning = (line: PdfLine | undefined): boolean =>
    line !== undefined &&
    (PAGE_NUMBER.test(line.text) || (counts.get(runningKey(line.text)) ?? 0) >= MIN_REPEATS);

  return pages.map((lines) => {
    let start = 0;
    while (start < EDGE_LINES && isRunning(lines[start])) start += 1;
    let end = lines.length;
    while (end > start && lines.length - end < EDGE_LINES && isRunning(lines[end - 1])) end -= 1;
    return lines.slice(start, end);
  });
}

/** OCR promises no reading order, and breaks one printed line wherever the spacing widens. */
export function linesFromRuns(runs: readonly OcrRun[]): readonly PdfLine[] {
  const rows: OcrRun[][] = [];
  for (const run of [...runs].sort((a, b) => b.y - a.y)) {
    const row = rows[rows.length - 1];
    const head = row?.[0];
    if (row && head && head.y - run.y <= Math.min(head.height, run.height) / 2) row.push(run);
    else rows.push([run]);
  }
  return rows
    .map((row) => ({
      text: [...row].sort((a, b) => a.x - b.x).map((run) => run.text.trim()).reduce(beside),
      y: row[0]!.y,
    }))
    .filter((line) => line.text.length > 0);
}

function beside(left: string, right: string): string {
  return CJK.test(left.slice(-1)) || CJK.test(right.charAt(0)) ? left + right : `${left} ${right}`.trim();
}

function edges(lines: readonly PdfLine[]): readonly PdfLine[] {
  if (lines.length <= EDGE_LINES * 2) return lines;
  return [...lines.slice(0, EDGE_LINES), ...lines.slice(-EDGE_LINES)];
}

/** Page numbers inside a running head change from page to page; the rest does not. */
function runningKey(text: string): string {
  return text.trim().toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
}

export function pageParagraphs(lines: readonly PdfLine[]): readonly string[] {
  if (lines.length === 0) return [];
  const gaps = lines.slice(1).map((line, i) => lines[i]!.y - line.y);
  const usual = lowerMedian(gaps.filter((g) => g > 0));

  const paragraphs: string[] = [];
  let current = lines[0]!.text;
  gaps.forEach((gap, i) => {
    const next = lines[i + 1]!.text;
    // A gap that goes up the page is a new column or a float, never a continuation.
    if (gap <= 0 || (usual !== undefined && gap > usual * PARAGRAPH_GAP)) {
      paragraphs.push(current);
      current = next;
    } else {
      current = joinLines(current, next);
    }
  });
  paragraphs.push(current);
  return paragraphs;
}

function lowerMedian(values: readonly number[]): number | undefined {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export function joinLines(before: string, after: string): string {
  if (/[a-z]-$/.test(before) && /^[a-z]/.test(after)) return before.slice(0, -1) + after;
  if (/\p{L}-$/u.test(before)) return before + after;
  if (CJK.test(before.slice(-1)) || CJK.test(after.charAt(0))) return before + after;
  return `${before} ${after}`;
}

/** Pages of paragraphs into one text, rejoining a paragraph a page turn cut in two. */
export function textOfPages(pages: readonly (readonly string[])[]): string {
  const paragraphs: string[] = [];
  for (const page of pages) {
    page.forEach((paragraph, i) => {
      const last = paragraphs[paragraphs.length - 1];
      if (i === 0 && last !== undefined && !SENTENCE_END.test(last)) {
        paragraphs[paragraphs.length - 1] = joinLines(last, paragraph);
      } else {
        paragraphs.push(paragraph);
      }
    });
  }
  return paragraphs.join('\n\n');
}

/**
 * Each bookmark owns the pages from its own to the next one's. Pages before the
 * first bookmark become an untitled block, which chunk.ts drops when it is only
 * a title page and a copyright notice.
 */
export function blocksFromOutline(
  pages: readonly (readonly string[])[],
  marks: readonly OutlineMark[],
): readonly Block[] {
  const ordered = [...marks]
    .sort((a, b) => a.page - b.page)
    .filter((mark, i, all) => i === 0 || all[i - 1]!.page !== mark.page);

  const front: Block = { title: '', text: textOfPages(pages.slice(0, ordered[0]?.page ?? pages.length)) };
  const blocks = ordered.map((mark, i): Block => ({
    title: mark.title,
    group: mark.group,
    text: textOfPages(pages.slice(mark.page, ordered[i + 1]?.page ?? pages.length)),
  }));
  return [front, ...blocks].filter((b) => b.text.length > 0);
}
