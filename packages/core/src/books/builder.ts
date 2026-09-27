/**
 * Turning a parsed book into a path on the shelf, and then into playable decks.
 * Both the app and `add-book` drive this, so there is one answer to what adding
 * a book does — the two used to disagree on the recap station and the cache.
 * Why the path lands first and decks follow is invariant 7 in AGENTS.md.
 */
import { join } from 'node:path';
import type { LlmProvider } from '../llm/types';
import { CairnError } from '../errors';
import type { ContentLocale } from '../parse/language';
import { budgetsFor, type BudgetId, shapeOf } from '../pipeline/budget';
import { buildNode, countUnsourcedQuotes, deckKey, notesByChapter, realMinutes } from '../pipeline/build';
import { classifyBook } from '../pipeline/classify';
import { mapChapters } from '../pipeline/map';
import { withRecap } from '../pipeline/recap';
import { reduceToPath } from '../pipeline/reduce';
import {
  type DeckScheduler, type SchedulerProgress, startDeckScheduler,
} from '../pipeline/scheduler';
import { DEFAULT_VOICE, type Narrator } from '../pipeline/tts';
import { fileStore } from '../store/file-store';
import { bookSlug, type LibraryEntry, type PathQuality } from '../store/library';
import type { Library } from '../store/library-disk';
import type { ChapterNote, NodeDeck, ParsedBook, Path, SourceKind } from '../types';
import type { DeckStatus, Progress } from './progress';

export interface BookBuilderDeps {
  readonly library: Library;
  readonly narrator: Narrator;
  /** The model for work on one book's behalf. Tracing, if any, is decided here. */
  readonly providerFor: (bookId: string) => Promise<LlmProvider>;
  /** The voice a new book in this language gets, from the current settings. */
  readonly voiceFor: (language: ContentLocale) => Promise<string>;
  readonly onDeckStatus?: (status: DeckStatus) => void;
  /** The scheduler only counts a failure; this is where its cause can be logged. */
  readonly onDeckFailed?: (bookId: string, nodeId: string, error: Error) => void;
}

export interface GeneratedBook {
  readonly entry: LibraryEntry;
  /** Resolves once every station is built or has failed, or the build was stopped. */
  readonly settled: Promise<LibraryEntry | undefined>;
}

export interface BookBuilder {
  /** Map, classify, reduce, install the path — then return once station 1 plays. */
  generate(
    book: ParsedBook, sourcePath: string, budgetId: BudgetId, onProgress?: (p: Progress) => void,
  ): Promise<GeneratedBook>;
  /** Pick a half-built book back up. False when there is nothing to resume. */
  resume(bookId: string): Promise<boolean>;
  /** Build every failed station again, even in a book already marked complete. */
  retry(bookId: string): Promise<boolean>;
  /** Stop its build first, so an in-flight deck cannot land in a deleted directory. */
  remove(bookId: string): Promise<boolean>;
  schedulerFor(bookId: string): DeckScheduler | undefined;
  /** Hold every background build — a reader's question is the foreground — and return the release. */
  pauseAll(): () => void;
}

interface Handle {
  readonly scheduler: DeckScheduler;
  readonly settled: Promise<LibraryEntry | undefined>;
  /** False once the run is over. */
  readonly retryFailed: () => boolean;
}

/** Stable across runs for the same file, so a re-run finds its own cache. */
export const bookIdFor = (book: ParsedBook, sourcePath: string): string =>
  bookSlug(book.title, (s) => Bun.hash(s).toString(16), sourcePath);

export function createBookBuilder(deps: BookBuilderDeps): BookBuilder {
  const { library, narrator } = deps;
  const running = new Map<string, Handle>();

  /**
   * A book built before voices were recorded used `DEFAULT_VOICE`, not today's
   * setting; resolving it to the setting would leave one book in two voices.
   */
  const voiceOf = async (entry: LibraryEntry): Promise<string> => {
    if (entry.voice) return entry.voice;
    if (!entry.language) return DEFAULT_VOICE;
    return deps.voiceFor(entry.language);
  };

  function startBuilding(
    path: Path,
    notes: readonly ChapterNote[],
    budgetId: BudgetId,
    quality: PathQuality | undefined,
    voice: string,
    locale: ContentLocale,
    kind: SourceKind,
    provider: LlmProvider,
    store: Parameters<typeof startDeckScheduler>[0]['store'],
  ): Handle {
    const existing = running.get(path.bookId);
    if (existing) return existing;

    const audioDir = join(library.cacheDir(path.bookId), 'audio');
    const byChapter = notesByChapter(notes);
    const ready: string[] = [];
    const failed: string[] = [];
    const decks: NodeDeck[] = [];

    const publish = async (progress: SchedulerProgress): Promise<void> => {
      const complete = progress.ready + progress.failed >= path.nodes.length;
      await library.writeDeckIndex(path.bookId, {
        total: path.nodes.length, ready: [...ready], failed: [...failed], complete,
      });
      // Written on every station: a shelf that reads 0 of 15 for a whole run is worse than no count
      await library.patchEntry(path.bookId, { built: progress.ready });
      deps.onDeckStatus?.({
        bookId: path.bookId, total: path.nodes.length,
        ready: progress.ready, failed: progress.failed, complete,
      });
    };

    const scheduler = startDeckScheduler({
      nodes: path.nodes,
      store,
      keyOf: (node) => deckKey(node, voice),
      build: (node) => buildNode(node, path, byChapter, audioDir, provider, narrator, { voice, locale, kind }),
      onReady: async (deck, progress) => {
        decks.push(deck);
        await library.installDeck(path.bookId, deck, audioDir);
        ready.push(deck.nodeId);
        await publish(progress);
      },
      onFailed: (nodeId, error, progress) => {
        failed.push(nodeId);
        deps.onDeckFailed?.(path.bookId, nodeId, error);
        void publish(progress);
      },
    });

    const settled = scheduler.done
      .then(async () => {
        const progress = scheduler.progress;
        // `done` also resolves on stop(); only a genuinely finished book is settled
        if (progress.ready + progress.failed < path.nodes.length) return undefined;
        return finish(path, decks, budgetId, quality, progress);
      })
      // Settling the index is bookkeeping; losing it must not take the app down
      .catch(() => undefined)
      .finally(() => {
        if (running.get(path.bookId)?.scheduler === scheduler) running.delete(path.bookId);
      });

    const retryFailed = (): boolean => {
      const ids = scheduler.retryFailed();
      if (ids === undefined) return false;
      failed.splice(0, failed.length, ...failed.filter((id) => !ids.includes(id)));
      void publish(scheduler.progress);
      return true;
    };

    const handle = { scheduler, settled, retryFailed };
    running.set(path.bookId, handle);
    return handle;
  }

  /** Swap the model's estimate for the measured length, and record what the run cost. */
  async function finish(
    path: Path,
    decks: readonly NodeDeck[],
    budgetId: BudgetId,
    quality: PathQuality | undefined,
    progress: SchedulerProgress,
  ): Promise<LibraryEntry | undefined> {
    const minutes = realMinutes(decks);
    await library.rewritePath({ ...path, totalMinutes: minutes });
    return library.patchEntry(path.bookId, {
      complete: true,
      built: progress.ready,
      minutes,
      budgetId,
      ...(quality
        ? { quality: { ...quality, failed: progress.failed, unsourcedQuotes: countUnsourcedQuotes(decks) } }
        : {}),
    });
  }

  // The same store name the app always used, so every half-built book resumes
  const deckStore = (bookId: string, budgetId: string) =>
    fileStore<NodeDeck>(join(library.cacheDir(bookId), `decks-${budgetId}.json`));

  return {
    async generate(book, sourcePath, budgetId, onProgress = () => undefined) {
      // Synthesis runs last; an unreachable narrator must fail before paying for slides
      await narrator.ensureReady();

      const id = bookIdFor(book, sourcePath);
      const budget = budgetsFor(shapeOf(book))[budgetId];
      const provider = await deps.providerFor(id);
      // Decided once, here, and then recorded: the setting may change mid-build
      const voice = await deps.voiceFor(book.language);
      const kind = book.kind ?? 'book';

      const mapStore = await fileStore<readonly ChapterNote[]>(join(library.cacheDir(id), 'map.json'));
      const { notes, job } = await mapChapters(book.chapters, provider, mapStore, {
        locale: book.language,
        kind,
        onProgress: (p) => onProgress({ stage: 'map', done: p.done + p.failed, total: p.total }),
      });
      // When no batch survived, the first failure says why (no credit, a bad key, a timeout)
      if (notes.length === 0) throw job.failures[0]?.error ?? new CairnError('map_empty');

      onProgress({ stage: 'classify', done: 0, total: 1 });
      const cls = await classifyBook(book.title, notes, provider, undefined, book.language, kind);

      onProgress({ stage: 'reduce', done: 0, total: 1, note: cls.type });
      // Appended after reduce: reduce is judged against the budget, and a station it did not choose would fight that
      const reduced = withRecap(
        await reduceToPath(notes, cls.type, book.totalWords, provider, { budget, locale: book.language, kind }),
        book.language,
        kind,
      );

      const path: Path = {
        bookId: id, title: book.title, type: cls.type,
        nodes: reduced.nodes, stages: reduced.stages,
        totalMinutes: reduced.totalMinutes, generatedAt: new Date().toISOString(),
      };
      const quality: PathQuality = {
        dropped: reduced.dropped,
        retries: reduced.retries,
        failed: 0,
        unsourcedQuotes: 0,
        estMinutes: reduced.totalMinutes,
        budgetMaxMinutes: budget.maxMinutes,
      };

      const entry = await library.installPath(path, notes, book.chapters, {
        id, title: book.title,
        ...(book.author ? { author: book.author } : {}),
        stations: path.nodes.length,
        minutes: path.totalMinutes,
        budgetId, generatedAt: path.generatedAt,
        complete: path.nodes.length === 0,
        built: 0,
        quality,
        language: book.language,
        voice,
        ...(kind === 'notes' ? { kind } : {}),
      });

      const { scheduler, settled } = startBuilding(
        path, notes, budgetId, quality, voice, book.language, kind, provider, await deckStore(id, budgetId),
      );

      const first = path.nodes[0];
      if (first) {
        onProgress({ stage: 'decks', done: 0, total: path.nodes.length, note: '第一站' });
        await scheduler.waitFor(first.id);
      }
      onProgress({ stage: 'done', done: 1, total: 1 });
      return { entry, settled };
    },

    async resume(bookId) {
      if (running.has(bookId)) return true;
      const entry = (await library.list()).find((b) => b.id === bookId);
      if (!entry || entry.complete === true) return false;

      const [path, notes] = await Promise.all([library.loadPath(bookId), library.loadNotes(bookId)])
        .catch(() => [undefined, undefined] as const);
      if (!path || !notes) return false;

      const budgetId = entry.budgetId as BudgetId;
      startBuilding(
        path, notes, budgetId, entry.quality, await voiceOf(entry), entry.language ?? 'zh', entry.kind ?? 'book',
        await deps.providerFor(bookId), await deckStore(bookId, budgetId),
      );
      return true;
    },

    async retry(bookId) {
      const handle = running.get(bookId);
      if (handle?.retryFailed()) return true;
      // Its run is over, or winding down: a finished book is not resumed, so un-finish it
      await handle?.settled;
      const index = await library.readDeckIndex(bookId);
      if (!index || index.failed.length === 0) return false;
      await library.writeDeckIndex(bookId, { ...index, failed: [], complete: false });
      await library.patchEntry(bookId, { complete: false });
      deps.onDeckStatus?.({
        bookId, total: index.total, ready: index.ready.length, failed: 0, complete: false,
      });
      return this.resume(bookId);
    },

    async remove(bookId) {
      const handle = running.get(bookId);
      if (handle) {
        handle.scheduler.stop();
        await handle.settled;
      }
      return library.remove(bookId);
    },

    schedulerFor: (bookId) => running.get(bookId)?.scheduler,

    pauseAll() {
      const releases = [...running.values()].map((h) => h.scheduler.pause());
      return () => { for (const release of releases) release(); };
    },
  };
}
