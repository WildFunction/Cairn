import { dirname, join } from 'node:path';

const IN_BUNDLE = '../Helpers/cairn-ocr';

/** Where `scripts/embed-ocr-helper.ts` puts the OCR helper in every macOS build, found from this process's own executable. */
export function ocrHelperPath(execPath: string): string {
  return join(dirname(execPath), IN_BUNDLE);
}
