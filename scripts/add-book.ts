#!/usr/bin/env bun
/**
 * Add a book to the app's library from the terminal.
 *
 *   bun run add-book <file> [more.md …] [--budget quick|brief|solid|full]
 *
 * Several files must all be Markdown notes; they are walked as one path.
 *
 * The same book builder the app runs, with the app's settings and library, so
 * a book added here is the book the app would have made — and a run cut short
 * here resumes when the book is opened there.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { bookIdFor, createBookBuilder } from '../packages/core/src/books/builder';
import type { DeckStatus, Progress } from '../packages/core/src/books/progress';
import { ACCEPTED_EXTENSIONS } from '../packages/core/src/parse/format';
import { budgetsFor, shapeOf, suggestBudgets, type BudgetId } from '../packages/core/src/pipeline/budget';
import { edgeTtsNarrator } from '../packages/core/src/runtime/edge-tts-ws';
import { visionOcr } from '../packages/core/src/runtime/vision-ocr';
import { providerFor } from '../apps/desktop/src/main/provider';
import { readBook, sourceOf } from '../apps/desktop/src/main/inspect';
import { readSettings } from '../apps/desktop/src/main/settings';
import { library } from '../apps/desktop/src/main/store';
import { voiceFor } from '../apps/desktop/src/shared/settings';

/** Built by any macOS build of the app, or by `bun run ocr-helper` in apps/desktop. */
const OCR_HELPER = resolve(import.meta.dir, '../apps/desktop/ocr-helper/build/cairn-ocr');

const BUDGET_IDS: readonly BudgetId[] = ['quick', 'brief', 'solid', 'full'];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--budget');
  if (files.length === 0) return usage();

  const wanted = flag(args, '--budget') as BudgetId | undefined;
  if (wanted && !BUDGET_IDS.includes(wanted)) return usage(`未知预算：${wanted}`);

  const paths = files.map((f) => resolve(f));
  const source = sourceOf(paths);
  const book = await readBook(paths, existsSync(OCR_HELPER) ? visionOcr(OCR_HELPER) : undefined);
  console.log(`《${book.title}》${book.author ? ` · ${book.author}` : ''}`);
  console.log(`${book.chapters.length} 章 · ${book.totalWords.toLocaleString()} 字\n`);

  const { choices, recommended } = suggestBudgets(shapeOf(book));
  const budget = budgetsFor(shapeOf(book))[wanted ?? recommended];
  console.log('可选预算：');
  for (const c of choices) {
    const mark = c.budget.id === budget.id ? '▸' : ' ';
    console.log(`  ${mark} ${c.honest ? '  ' : '⚠ '}${c.budget.label}${c.note ? `\n        ${c.note}` : ''}`);
  }
  console.log(`\n使用：${budget.label}\n`);

  const books = createBookBuilder({
    library,
    narrator: edgeTtsNarrator(),
    providerFor,
    voiceFor: async (language) => voiceFor(await readSettings(), language).voice,
    onDeckStatus: (s: DeckStatus) => bar('decks ', s.ready + s.failed, s.total, s.failed),
  });

  const { entry, settled } = await books.generate(book, source, budget.id, (p: Progress) => {
    if (p.stage === 'map') bar('map   ', p.done, p.total, 0);
    else if (p.stage !== 'done') process.stdout.write(`\n${p.stage}${p.note ? ` · ${p.note}` : ''}`);
  });
  console.log(`\n${entry.stations} 站 · 预估 ${entry.minutes} 分钟 · ${entry.voice}`);

  const done = await settled;
  const quality = done?.quality;
  console.log();
  if (quality) {
    // The two numbers worth watching after a prompt change; both should be 0
    console.log(`\n虚构章号被丢弃 ${quality.dropped} 站 · 引文对不上原文 ${quality.unsourcedQuotes} 张 · 失败 ${quality.failed} 站`);
  }
  console.log(`真实总时长 ${done?.minutes ?? '?'} 分钟（预估 ${entry.minutes}）`);
  console.log(`已装载到 ${library.root}（${bookIdFor(book, source)}）。运行 \`cd apps/desktop && bun run start\` 查看。`);
}

function bar(label: string, done: number, total: number, failed: number): void {
  const width = 24;
  const filled = total === 0 ? 0 : Math.round((done / total) * width);
  const suffix = failed > 0 ? ` 失败 ${failed}` : '';
  process.stdout.write(`\r${label} [${'█'.repeat(filled)}${'·'.repeat(width - filled)}] ${done}/${total}${suffix}   `);
}

const flag = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

function usage(message?: string): void {
  if (message) console.error(`${message}\n`);
  console.log(`用法：bun run add-book <书文件 | 多篇 .md 笔记> [--budget quick|brief|solid|full]

支持 ${ACCEPTED_EXTENSIONS.join(' / ')}
预算档位：${BUDGET_IDS.map((id) => `\n  ${id}`).join('')}

四个档位的实际时长按书的体量和章节结构推导，选书之后才知道。
不指定预算时按书的体量推荐。模型与声音取自应用的设置。`);
  process.exit(message ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(`\n失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
