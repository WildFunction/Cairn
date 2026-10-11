/**
 * Builds the OCR helper and puts it in the app bundle, for every macOS build: it
 * needs no entitlement, so the packager's own signing pass is the right one for it.
 * The copy left in `ocr-helper/build/` is the one `bun run add-book` uses.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = 'ocr-helper/main.swift';
const BUILT = 'ocr-helper/build/cairn-ocr';
/** The oldest macOS the sync helper runs on; the two ship in one bundle. */
const MACOS = 'apple-macos14.0';

export function buildOcrHelper(arch: string): void {
  const target = `${arch === 'x64' ? 'x86_64' : arch}-${MACOS}`;
  mkdirSync('ocr-helper/build', { recursive: true });
  execFileSync('xcrun', ['swiftc', '-O', '-target', target, '-o', BUILT, SOURCE], { stdio: 'inherit' });
}

export default function embedOcrHelper(): void {
  const env = process.env;
  if (env.ELECTROBUN_OS !== 'macos') return;
  if (!env.ELECTROBUN_BUILD_DIR || !env.ELECTROBUN_APP_NAME) throw new Error('not run as an Electrobun build hook');

  try {
    buildOcrHelper(env.ELECTROBUN_ARCH ?? process.arch);
  } catch (cause) {
    // A checkout without the Swift toolchain still runs; a release without the helper refuses every scan.
    if (env.ELECTROBUN_BUILD_ENV === 'stable') throw cause;
    console.log('building without the OCR helper: it needs the Xcode command line tools');
    return;
  }

  // Only the stable bundle is named for the app alone; a dev build is `Cairn-dev.app`.
  const suffix = env.ELECTROBUN_BUILD_ENV === 'stable' ? '' : `-${env.ELECTROBUN_BUILD_ENV}`;
  const helpers = join(env.ELECTROBUN_BUILD_DIR, `${env.ELECTROBUN_APP_NAME}${suffix}.app`, 'Contents/Helpers');
  mkdirSync(helpers, { recursive: true });
  copyFileSync(BUILT, join(helpers, 'cairn-ocr'));
}

if (import.meta.main) buildOcrHelper(process.arch);
