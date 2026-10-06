#!/usr/bin/env bun
/**
 * Write the iOS app's built-in book from the library, through the same code the
 * iCloud push uses — so what the phone ships with is what the cloud would have
 * delivered.
 *
 *   bun run ios:sample
 */
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { readBookSource } from '../packages/core/src/store/book-source';
import { normalizeEntry } from '../packages/core/src/store/library';
import { BOOK_RECORD, bookRecords } from '../packages/core/src/sync/book';
import type { CloudRecord, CloudValue } from '../packages/core/src/sync/cloud';
import { library } from '../apps/desktop/src/main/store';

const BOOK_ID = 'the-art-of-war-ed02db';
const OUT = resolve(import.meta.dir, '../apps/ios/Cairn/Resources/SampleBook/books', BOOK_ID);

function field(record: CloudRecord, name: string, kind: 'string' | 'asset'): string | undefined {
  const value: CloudValue | undefined = record.fields[name];
  if (!value) return undefined;
  if (kind === 'string') return 'string' in value ? value.string : undefined;
  return 'asset' in value ? value.asset : undefined;
}

function required(record: CloudRecord, name: string, kind: 'string' | 'asset'): string {
  const value = field(record, name, kind);
  if (value === undefined) throw new Error(`记录 ${record.name} 缺少 ${name}`);
  return value;
}

async function main(): Promise<void> {
  const entry = (await library.list()).find((book) => book.id === BOOK_ID);
  if (!entry) throw new Error(`书库里没有 ${BOOK_ID}：先用 bun run add-book 生成《The Art of War》`);
  if (!normalizeEntry(entry).complete) throw new Error(`${BOOK_ID} 还没有生成完`);

  const records = bookRecords(await readBookSource(library, entry));
  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, 'decks'), { recursive: true });
  await mkdir(join(OUT, 'audio'), { recursive: true });

  for (const record of records) {
    if (record.name === BOOK_RECORD) {
      await writeFile(join(OUT, 'manifest.json'), required(record, 'manifest', 'string'));
      const cover = field(record, 'cover', 'asset');
      if (cover) await copyFile(cover, join(OUT, `cover${extname(cover)}`));
      continue;
    }
    await writeFile(join(OUT, 'decks', `${record.name}.json`), required(record, 'deck', 'string'));
    await copyFile(required(record, 'audio', 'asset'), join(OUT, 'audio', `${record.name}.mp3`));
  }
  console.log(`已导出 ${BOOK_ID}：${records.length - 1} 章 → ${OUT}`);
}

main().catch((error: unknown) => {
  console.error(`失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
