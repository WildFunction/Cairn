import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { visionOcr } from '../../src/runtime/vision-ocr';
import { ParseError } from '../../src/types';

/** A stand-in helper: keeps the bytes it was sent, counts its runs, and prints the reply it was told to. */
const dir = mkdtempSync(join(tmpdir(), 'cairn-ocr-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function helper(reply: string, exit = 0): { path: string; sent: () => string; runs: () => number } {
  const path = join(dir, `helper-${Math.random().toString(36).slice(2)}`);
  const seen = `${path}.stdin`;
  const count = `${path}.count`;
  writeFileSync(path, `#!/bin/sh\ncat > '${seen}'\necho x >> '${count}'\nprintf '%s' '${reply}'\nexit ${exit}\n`);
  chmodSync(path, 0o755);
  return {
    path,
    sent: () => readFileSync(seen, 'utf8'),
    runs: () => (existsSync(count) ? readFileSync(count, 'utf8').trim().split('\n').length : 0),
  };
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const PAGE = '{"runs":[{"text":"Kelly","x":72,"y":700,"height":10}]}';

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof ParseError ? e.code : 'not a ParseError';
  }
}

describe('visionOcr', () => {
  test('pipes the PDF to the helper and returns each page it read', async () => {
    const fake = helper(`${PAGE}\n{"runs":[]}\n`);
    const pages = await visionOcr(fake.path)(bytes('%PDF-fake'));
    expect(fake.sent()).toBe('%PDF-fake');
    expect(pages).toEqual([[{ text: 'Kelly', x: 72, y: 700, height: 10 }], []]);
  });

  test('the same file asked for twice is read once', async () => {
    const fake = helper(`${PAGE}\n`);
    const ocr = visionOcr(fake.path);
    const first = await ocr(bytes('%PDF-one'));
    expect(await ocr(bytes('%PDF-one'))).toEqual(first);
    expect(fake.runs()).toBe(1);
    await ocr(bytes('%PDF-two'));
    expect(fake.runs()).toBe(2);
  });

  test('a helper that fails leaves the PDF a scan, and is asked again next time', async () => {
    const fake = helper('', 1);
    const ocr = visionOcr(fake.path);
    expect(await codeOf(ocr(bytes('%PDF-one')))).toBe('scanned_pdf');
    expect(await codeOf(ocr(bytes('%PDF-one')))).toBe('scanned_pdf');
    expect(fake.runs()).toBe(2);
  });

  test('a reply that is not what the helper writes is refused', async () => {
    expect(await codeOf(visionOcr(helper('{"runs":[{"text":7}]}\n').path)(bytes('%PDF')))).toBe('scanned_pdf');
    expect(await codeOf(visionOcr(helper('not json\n').path)(bytes('%PDF')))).toBe('scanned_pdf');
  });

  test('a helper that is not installed leaves the PDF a scan', async () => {
    expect(await codeOf(visionOcr(join(dir, 'absent'))(bytes('%PDF')))).toBe('scanned_pdf');
  });
});
