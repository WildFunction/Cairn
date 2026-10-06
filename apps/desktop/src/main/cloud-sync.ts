/**
 * The disk side of iCloud syncing: the ledger of what this Mac uploaded and
 * what the owner switched off, and how much a book takes once it is up there.
 */
import { randomUUID } from 'node:crypto';
import { readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EMPTY_LEDGER, parseLedger, type SyncLedger } from '@cairn/core/sync/auto';
import { bookDir, type LibraryEntry } from '@cairn/core/store/library';
import { DATA_DIR } from './store';

const LEDGER = join(DATA_DIR, 'sync.json');

export const syncLedger = {
  async read(): Promise<SyncLedger> {
    let raw: string;
    try {
      raw = await readFile(LEDGER, 'utf8');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_LEDGER;
      throw cause;
    }
    try {
      return parseLedger(JSON.parse(raw));
    } catch {
      // Unreadable is the same as empty: the next run finds what is in iCloud again.
      return EMPTY_LEDGER;
    }
  },

  async write(next: SyncLedger): Promise<void> {
    const pending = `${LEDGER}.${randomUUID()}.tmp`;
    await writeFile(pending, JSON.stringify(next));
    await rename(pending, LEDGER);
  },
};

async function bytesIn(directory: string, keep: (name: string) => boolean): Promise<number> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw cause;
  }
  const sizes = await Promise.all(names.filter(keep).map(async (name) => (await stat(join(directory, name))).size));
  return sizes.reduce((total, size) => total + size, 0);
}

/** What a book sends to iCloud: its decks, its audio and its cover. Never the text. */
export async function syncedBytes(entry: LibraryEntry): Promise<number> {
  const root = join(DATA_DIR, bookDir(entry.id));
  const [decks, audio, cover] = await Promise.all([
    bytesIn(join(root, 'decks'), (name) => name.endsWith('.json') && name !== 'index.json'),
    bytesIn(join(root, 'audio'), (name) => name.endsWith('.mp3')),
    bytesIn(root, (name) => name.startsWith('cover.')),
  ]);
  return decks + audio + cover;
}
