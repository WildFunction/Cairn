import type { ParsedBook } from '../types';
import { parseEpub } from './epub';
import { detectFormat } from './format';
import { parseDocx } from './docx';
import { parseMarkdown } from './markdown';
import { parseMobi } from './mobi';
import { parsePdf, type PdfOcr } from './pdf';
import { parseTxt } from './txt';

/** Dispatch by extension. All parsing happens locally; the file is never uploaded. */
export async function parseBook(bytes: Uint8Array, fileName: string, ocr?: PdfOcr): Promise<ParsedBook> {
  switch (detectFormat(fileName)) {
    case 'epub':
      return parseEpub(bytes, fileName);
    case 'txt':
      return parseTxt(bytes, fileName);
    case 'markdown':
      return parseMarkdown(bytes, fileName);
    case 'pdf':
      return parsePdf(bytes, fileName, ocr);
    case 'mobi':
      return parseMobi(bytes, fileName);
    case 'docx':
      return parseDocx(bytes, fileName);
  }
}

export { ACCEPTED_EXTENSIONS, detectFormat } from './format';
export { parseDocx, parseEpub, parseMarkdown, parseMobi, parsePdf, parseTxt, type PdfOcr };
export * from '../types';
