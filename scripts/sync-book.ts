#!/usr/bin/env bun
/**
 * Push finished books to iCloud from the terminal — the same push the app runs,
 * against the app's library.
 *
 *   bun run sync-book <bookId …>         the books named
 *   bun run sync-book --all              every finished book in the library
 *   bun run sync-book --remove <bookId>  take a book out of iCloud
 *
 * Needs the helper: `cd apps/desktop && bun run sync-helper`.
 */
import { resolve } from 'node:path';
import { cloudKitStore } from '../packages/core/src/runtime/cloudkit-helper';
import { readBookSource } from '../packages/core/src/store/book-source';
import { normalizeEntry } from '../packages/core/src/store/library';
import { zoneOf } from '../packages/core/src/sync/book';
import { pushBook } from '../packages/core/src/sync/push';
import { library } from '../apps/desktop/src/main/store';

const HELPER = process.env.CAIRN_SYNC_HELPER ?? resolve(
  import.meta.dir,
  '../apps/desktop/sync-helper/build/Build/Products/Debug/CairnSync.app/Contents/MacOS/CairnSync',
);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Naming nothing uploads nothing: "everything" is tens of megabytes of someone's books.
  if (args.length === 0) throw new Error('用法：bun run sync-book <bookId …> | --all | --remove <bookId>');
  const cloud = cloudKitStore(HELPER);

  const account = await cloud.account();
  if (account !== 'available') throw new Error(`iCloud 账号不可用：${account}`);

  const removing = args.indexOf('--remove');
  if (removing >= 0) {
    const bookId = args[removing + 1];
    if (!bookId) throw new Error('用法：bun run sync-book --remove <bookId>');
    await cloud.dropZone(zoneOf(bookId));
    console.log(`已从 iCloud 移除 ${bookId}`);
    return;
  }

  const everything = args.includes('--all');
  const books = (await library.list()).filter((book) => everything || args.includes(book.id));
  if (books.length === 0) throw new Error('书库里没有匹配的书');

  for (const entry of books) {
    if (!normalizeEntry(entry).complete) {
      console.log(`跳过 ${entry.id}：还没有生成完`);
      continue;
    }
    const started = Date.now();
    const report = await pushBook(cloud, await readBookSource(library, entry), (done, total) => {
      process.stdout.write(`\r${entry.id}  ${done}/${total}   `);
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\r${entry.id}  上传 ${report.saved} · 已是最新 ${report.skipped} · 移除 ${report.removed} · ${seconds}s`);
  }
}

main().catch((error: unknown) => {
  console.error(`\n失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
