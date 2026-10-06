import { describe, expect, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { builtinModules } from 'node:module';

/**
 * Walks each webview's real import graph from its entry. A `node:*` import that
 * reaches a renderer passes every typecheck and fails only at bundle time;
 * a heavy main-process dependency passes the bundle too and just ships.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const ENTRIES = [
  { name: 'the desktop webview', file: join(ROOT, 'apps/desktop/src/main.tsx') },
  { name: "the iOS app's slide page", file: join(ROOT, 'apps/ios/stage/main.tsx') },
];
const CORE = join(ROOT, 'packages/core/src');
const UI = join(ROOT, 'packages/ui/src/index.ts');

/** Main-process only: the runtime, the parser's zip reader, the shell's own side. */
const FORBIDDEN = ['jszip', 'edge-tts-universal', 'electrobun/main', 'electrobun/bun'];

const transpiler = new Bun.Transpiler({ loader: 'tsx' });

function resolveFile(base: string): string | undefined {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  return candidates.find((c) => statSync(c, { throwIfNoEntry: false })?.isFile());
}

function target(spec: string, from: string): string | undefined {
  if (spec.startsWith('.')) return resolveFile(resolve(dirname(from), spec));
  if (spec === '@cairn/ui') return UI;
  if (spec.startsWith('@cairn/core/')) return resolveFile(join(CORE, spec.slice('@cairn/core/'.length)));
  return undefined;
}

function isNodeBuiltin(spec: string): boolean {
  return spec.startsWith('node:') || builtinModules.includes(spec);
}

/** Every external specifier a renderer reaches, with the file that reached it. */
function walk(entry: string): ReadonlyMap<string, string> {
  const externals = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || /\.(css|svg|png)$/.test(file)) continue;
    seen.add(file);
    for (const { path: spec } of transpiler.scanImports(readFileSync(file, 'utf8'))) {
      if (spec.endsWith('.css')) continue;
      const next = target(spec, file);
      if (next) queue.push(next);
      else if (!spec.startsWith('.') && !spec.startsWith('@cairn/')) externals.set(spec, file.slice(ROOT.length + 1));
      else throw new Error(`unresolved ${spec} from ${file}`);
    }
  }
  return externals;
}

describe.each(ENTRIES)('the import graph of $name', ({ file }) => {
  const externals = walk(file);
  const offending = (pred: (spec: string) => boolean): string[] =>
    [...externals].filter(([spec]) => pred(spec)).map(([spec, from]) => `${spec} ← ${from}`);

  test('reaches no node built-in', () => {
    expect(offending(isNodeBuiltin)).toEqual([]);
  });

  test('reaches no main-process dependency', () => {
    expect(offending((spec) => FORBIDDEN.some((f) => spec === f || spec.startsWith(`${f}/`)))).toEqual([]);
  });

  test('actually walked the app, not an empty graph', () => {
    expect(externals.has('react')).toBe(true);
  });
});
