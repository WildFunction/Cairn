/**
 * A scanned PDF's text, read by the Vision framework that ships with macOS. The
 * main process is a JS runtime with no binding to it, so a helper does the
 * reading: the PDF in on stdin, one JSON line per page out. Nothing leaves the
 * machine. `apps/desktop/ocr-helper/main.swift` is the other end of the pipe.
 */
import { createHash } from 'node:crypto';
import type { PdfOcr } from '../parse/pdf';
import type { OcrRun } from '../parse/pdf-layout';
import { ParseError } from '../types';

type Pages = readonly (readonly OcrRun[])[];

/** Measured at 0.4 s a page on an M-series Mac: a thousand-page scan three times over. */
const TIMEOUT_MS = 20 * 60_000;

export function visionOcr(helper: string): PdfOcr {
  // The preview and the build each parse the file; the second must not cost the minutes the first did.
  let last: { readonly key: string; readonly pages: Promise<Pages> } | undefined;

  return (bytes) => {
    const key = createHash('sha256').update(bytes).digest('hex');
    if (last?.key === key) return last.pages;

    const pages = run(helper, bytes);
    last = { key, pages };
    pages.catch(() => {
      if (last?.pages === pages) last = undefined;
    });
    return pages;
  };
}

async function run(helper: string, bytes: Uint8Array): Promise<Pages> {
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn([helper], { stdin: bytes, stdout: 'pipe', stderr: 'pipe' });
  } catch (cause) {
    throw unread(cause instanceof Error ? cause.message : String(cause));
  }

  const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout as ReadableStream).text(),
      new Response(child.stderr as ReadableStream).text(),
      child.exited,
    ]);
    if (code !== 0) throw unread(stderr.trim() || `exit ${code}`);
    return pagesFrom(stdout);
  } finally {
    clearTimeout(timer);
  }
}

function pagesFrom(stdout: string): Pages {
  return stdout.split('\n').filter((line) => line.length > 0).map((line) => {
    let page: unknown;
    try {
      page = JSON.parse(line);
    } catch {
      throw unread('the helper wrote something that is not JSON');
    }
    const runs = typeof page === 'object' && page !== null && 'runs' in page ? page.runs : undefined;
    if (!Array.isArray(runs) || !runs.every(isRun)) throw unread('the helper wrote a page with no runs');
    return runs;
  });
}

function isRun(value: unknown): value is OcrRun {
  if (typeof value !== 'object' || value === null) return false;
  const { text, x, y, height } = value as Record<string, unknown>;
  return typeof text === 'string' && [x, y, height].every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** OCR that could not run leaves the file what it was: a scan the reader has to convert. */
function unread(reason: string): ParseError {
  return new ParseError(`扫描件识别失败：${reason}`, 'scanned_pdf');
}
