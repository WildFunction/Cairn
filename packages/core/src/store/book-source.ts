import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BookSource, StationSource } from '../sync/book';
import { audioFile, deckFile, type LibraryEntry } from './library';
import type { Library } from './library-disk';

/** A book as sync sees it. Reads the path, the decks, the audio and the cover — never the chapter text. */
export async function readBookSource(library: Library, entry: LibraryEntry): Promise<BookSource> {
  const at = (relative: string): string => join(library.root, relative);
  const path = await library.loadPath(entry.id);
  const index = await library.readDeckIndex(entry.id);
  const ready = new Set(index?.ready ?? path.nodes.map((node) => node.id));

  const stations: StationSource[] = [];
  for (const node of path.nodes) {
    if (!ready.has(node.id)) continue;
    const audio = at(audioFile(entry.id, node.id));
    stations.push({
      nodeId: node.id,
      deck: await readFile(at(deckFile(entry.id, node.id)), 'utf8'),
      audio,
      audioHash: await hashOf(audio),
    });
  }

  const cover = entry.cover ? { file: at(entry.cover), hash: await hashOf(at(entry.cover)) } : undefined;
  return { entry, path, stations, ...(cover ? { cover } : {}) };
}

async function hashOf(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}
