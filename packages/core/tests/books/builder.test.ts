import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BookBuilder, bookIdFor, createBookBuilder } from '../../src/books/builder';
import type { DeckStatus } from '../../src/books/progress';
import { payloadOf } from '../../src/errors';
import { LlmError, type LlmProvider, type LlmRequest } from '../../src/llm/types';
import { DEFAULT_VOICE, type Narrator, type TtsOptions } from '../../src/pipeline/tts';
import { type Library, openLibrary } from '../../src/store/library-disk';
import type { DraftDeck, NodeDeck, ParsedBook, Path } from '../../src/types';

const book: ParsedBook = {
  title: 'Atomic Habits', format: 'txt', language: 'zh', totalWords: 6000,
  chapters: [
    { idx: 0, title: '第一章', text: '正文一', wordCount: 3000 },
    { idx: 1, title: '第二章', text: '正文二', wordCount: 3000 },
  ],
};

/** Answers each stage by its trace label, the way a real model would be asked. */
function model(): LlmProvider & { seen: LlmRequest[] } {
  const seen: LlmRequest[] = [];
  return {
    seen, name: 'stub', suggestedConcurrency: 2, overheadTokens: 0,
    async complete(r) {
      seen.push(r);
      const label = r.label ?? '';
      if (label.startsWith('map:')) {
        return JSON.stringify({ chapters: book.chapters.map((c) => ({
          idx: c.idx, gist: `${c.title}的要旨`, keyPoints: ['要点'], quotes: ['一句原文'],
        })) });
      }
      if (label === 'classify') return JSON.stringify({ type: 'knowledge', reason: '' });
      if (label.startsWith('reduce')) {
        return JSON.stringify({ stages: [{ title: '建立模型', nodes: [
          { title: '一', kind: 'concept', brief: 'b1', keyPoints: [], sourceChapters: [0], estMinutes: 3 },
          { title: '二', kind: 'concept', brief: 'b2', keyPoints: [], sourceChapters: [1], estMinutes: 3 },
          { title: '三', kind: 'concept', brief: 'b3', keyPoints: [], sourceChapters: [0, 1], estMinutes: 3 },
        ] }] });
      }
      return JSON.stringify({
        sentences: ['一句。'],
        slides: [{ layout: 'points', heading: '要点', points: ['一条'], atSentence: 0 }],
      });
    },
  };
}

/** Writes a stand-in mp3 where the real narrator would, and remembers the voice it was asked for. */
function narrator(): Narrator & { voices: string[] } {
  const voices: string[] = [];
  return {
    voices, name: 'stub',
    async ensureReady() {},
    async speak(draft: DraftDeck, audioPath: string, options?: TtsOptions): Promise<NodeDeck> {
      voices.push(options?.voice ?? DEFAULT_VOICE);
      await Bun.write(audioPath, 'mp3');
      return { nodeId: draft.nodeId, slides: [], narration: [], audioPath, durationMs: 90_000 };
    },
  };
}

let library: Library;
let voices: string[];
let statuses: DeckStatus[];
let requests: LlmRequest[];
let builder: BookBuilder;

const NOTES_MARK = '自己写的笔记';

beforeEach(async () => {
  library = openLibrary(await mkdtemp(join(tmpdir(), 'cairn-builder-')));
  const n = narrator();
  voices = n.voices;
  statuses = [];
  requests = [];
  builder = createBookBuilder({
    library, narrator: n,
    providerFor: async () => {
      const m = model();
      requests = m.seen;
      return m;
    },
    voiceFor: async (language) => (language === 'zh' ? 'zh-CN-XiaoxiaoNeural' : 'en-US-AvaNeural'),
    onDeckStatus: (s) => statuses.push(s),
  });
});

describe('generate', () => {
  test('ends the path with the recap station', async () => {
    const { entry, settled } = await builder.generate(book, '/books/a.txt', 'brief');
    await settled;
    const path = await library.loadPath(entry.id);
    expect(path.nodes.map((n) => n.kind)).toEqual(['concept', 'concept', 'concept', 'recap']);
  });

  test('the book is on the shelf and playable before the rest is built', async () => {
    const { entry, settled } = await builder.generate(book, '/books/a.txt', 'brief');
    expect(entry.complete).toBe(false);
    expect((await library.readDeckIndex(entry.id))?.ready.length).toBeGreaterThanOrEqual(1);
    await settled;
  });

  test('once settled, the shelf holds the measured length and a complete index', async () => {
    const { entry, settled } = await builder.generate(book, '/books/a.txt', 'brief');
    const done = await settled;

    // Four stations of 90 seconds each, not the model's estimate
    expect(done).toMatchObject({ complete: true, built: 4, minutes: 6 });
    expect((await library.loadPath(entry.id)).totalMinutes).toBe(6);
    expect(await library.readDeckIndex(entry.id)).toMatchObject({ total: 4, complete: true });
    expect(statuses.at(-1)).toMatchObject({ bookId: entry.id, ready: 4, complete: true });
  });

  test('the voice is decided once and recorded on the entry', async () => {
    const { entry, settled } = await builder.generate(book, '/books/a.txt', 'brief');
    await settled;
    expect(entry.voice).toBe('zh-CN-XiaoxiaoNeural');
    expect(new Set(voices)).toEqual(new Set(['zh-CN-XiaoxiaoNeural']));
  });

  test('notes are spoken of as the reader\'s own in every call, and recorded as notes', async () => {
    const { entry, settled } = await builder.generate({ ...book, kind: 'notes' }, '/notes/a.md', 'brief');
    await settled;
    expect(entry.kind).toBe('notes');
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.system?.includes(NOTES_MARK))).toBe(true);
    expect((await library.loadPath(entry.id)).stages.at(-1)?.title).toBe('回头看');
  });

  test('a book is not told it is notes', async () => {
    const { entry, settled } = await builder.generate(book, '/books/a.txt', 'brief');
    await settled;
    expect(entry.kind).toBeUndefined();
    expect(requests.some((r) => r.system?.includes(NOTES_MARK))).toBe(false);
  });

  test('a model that refuses every call says why, not that the notes came back empty', async () => {
    const refusing = createBookBuilder({
      library, narrator: narrator(),
      providerFor: async () => ({
        name: 'stub', suggestedConcurrency: 2, overheadTokens: 0,
        async complete() { throw new LlmError('模型接口请求失败', 'provider_failed', 'Payment Required'); },
      }),
      voiceFor: async () => DEFAULT_VOICE,
    });
    const failure = await refusing.generate(book, '/books/refused.txt', 'brief').then(() => undefined, (e: unknown) => e);
    expect(payloadOf(failure)).toMatchObject({ code: 'llm_failed', detail: 'Payment Required' });
  });

  test('the generation cache sits under the library, where resume and remove look for it', async () => {
    const { entry, settled } = await builder.generate(book, '/books/a.txt', 'brief');
    await settled;
    expect(await Bun.file(join(library.cacheDir(entry.id), 'map.json')).exists()).toBe(true);
    expect(await Bun.file(join(library.cacheDir(entry.id), 'decks-brief.json')).exists()).toBe(true);
  });
});

describe('remove', () => {
  test('takes the book, its files and its cache', async () => {
    const { entry, settled } = await builder.generate(book, '/books/a.txt', 'brief');
    await settled;
    expect(await builder.remove(entry.id)).toBe(true);
    expect(await library.list()).toEqual([]);
    expect(await Bun.file(join(library.cacheDir(entry.id), 'map.json')).exists()).toBe(false);
  });
});

describe('resume', () => {
  const id = bookIdFor(book, '/books/a.txt');
  const path: Path = {
    bookId: id, title: book.title, type: 'knowledge',
    nodes: [{ id: 'n0', idx: 0, title: '一', kind: 'concept', brief: 'b', keyPoints: [], sourceChapters: [0], estMinutes: 3 }],
    stages: [{ title: 's', nodeIds: ['n0'] }],
    totalMinutes: 3, generatedAt: '2026-01-01T00:00:00.000Z',
  };
  const halfBuilt = (over: Record<string, unknown>) => library.installPath(
    path, [{ idx: 0, title: '第一章', gist: 'g', keyPoints: [], quotes: [] }], book.chapters,
    { id, title: book.title, stations: 1, minutes: 3, budgetId: 'brief', generatedAt: path.generatedAt,
      complete: false, built: 0, ...over },
  );

  test('nothing to resume for an unknown or finished book', async () => {
    expect(await builder.resume('missing-abc123')).toBe(false);
    await halfBuilt({ complete: true });
    expect(await builder.resume(id)).toBe(false);
  });

  test('keeps the voice the book was started in, whatever the setting says now', async () => {
    await halfBuilt({ language: 'zh', voice: 'zh-CN-YunxiNeural' });
    expect(await builder.resume(id)).toBe(true);
    await builder.schedulerFor(id)?.done;
    expect(voices).toEqual(['zh-CN-YunxiNeural']);
  });

  test('a book from before voices were recorded resumes in the default, not the setting', async () => {
    await halfBuilt({});
    await builder.resume(id);
    await builder.schedulerFor(id)?.done;
    expect(voices).toEqual([DEFAULT_VOICE]);
  });

  test('half-built notes resume as notes', async () => {
    await halfBuilt({ language: 'zh', kind: 'notes' });
    await builder.resume(id);
    await builder.schedulerFor(id)?.done;
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.system?.includes(NOTES_MARK))).toBe(true);
  });

  test('a book with a language but no recorded voice takes the setting for that language', async () => {
    await halfBuilt({ language: 'zh' });
    await builder.resume(id);
    await builder.schedulerFor(id)?.done;
    expect(voices).toEqual(['zh-CN-XiaoxiaoNeural']);
  });
});

describe('retry', () => {
  test('rebuilds a station that failed in a finished book, and reports why it failed', async () => {
    let broken = true;
    const errors: string[] = [];
    const n = narrator();
    const flaky: Narrator = {
      ...n,
      async speak(draft, audioPath, options) {
        if (broken && draft.nodeId === 'n1') throw new Error('narration dropped');
        return n.speak(draft, audioPath, options);
      },
    };
    const b = createBookBuilder({
      library, narrator: flaky, providerFor: async () => model(), voiceFor: async () => 'zh-CN-XiaoxiaoNeural',
      onDeckFailed: (_bookId, nodeId, error) => errors.push(`${nodeId}: ${error.message}`),
    });
    const { entry, settled } = await b.generate(book, '/books/a.txt', 'brief');
    await settled;
    expect((await library.readDeckIndex(entry.id))?.failed).toEqual(['n1']);
    expect(errors).toEqual(['n1: narration dropped']);

    broken = false;
    expect(await b.retry(entry.id)).toBe(true);
    await b.schedulerFor(entry.id)?.done;
    const index = await library.readDeckIndex(entry.id);
    expect(index?.failed).toEqual([]);
    expect(index?.ready).toContain('n1');
    expect(index?.complete).toBe(true);
  });

  test('nothing to retry for an unknown book', async () => {
    expect(await builder.retry('missing-abc123')).toBe(false);
  });
});
