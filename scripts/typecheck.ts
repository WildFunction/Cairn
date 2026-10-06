#!/usr/bin/env bun
/**
 * Typecheck every package, and say so when one cannot be checked.
 *
 * The root script used to point at `packages/core` alone while the docs claimed
 * every project was clean. The two desktop projects extend a tsconfig that
 * `electrobun prepare` projects into `apps/desktop/.hutch/`, which is gitignored
 * — so on a fresh checkout they cannot run at all. Silently checking one of four
 * hid that; skipping loudly does not.
 */
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

interface Project {
  readonly name: string;
  readonly config: string;
  /** When present and missing on disk, the project is skipped with this reason. */
  readonly needs?: { readonly path: string; readonly reason: string };
}

const DEVKIT = {
  path: 'apps/desktop/.hutch/devkit/tsconfig.json',
  reason: '先在 apps/desktop 里跑 `bunx electrobun prepare` 把 SDK 投影出来',
};

const PROJECTS: readonly Project[] = [
  { name: 'core', config: 'packages/core/tsconfig.json' },
  { name: 'ui', config: 'packages/ui/tsconfig.json' },
  { name: 'desktop (webview)', config: 'apps/desktop/tsconfig.json', needs: DEVKIT },
  { name: 'desktop (main)', config: 'apps/desktop/tsconfig.main.json', needs: DEVKIT },
  { name: 'ios (stage)', config: 'apps/ios/stage/tsconfig.json' },
];

let failed = 0;
let skipped = 0;

for (const project of PROJECTS) {
  if (project.needs && !(await Bun.file(join(ROOT, project.needs.path)).exists())) {
    console.log(`○ ${project.name} —— 跳过：${project.needs.reason}`);
    skipped += 1;
    continue;
  }

  const result = Bun.spawnSync(['bunx', 'tsc', '--noEmit', '-p', project.config], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (result.exitCode === 0) {
    console.log(`✓ ${project.name}`);
  } else {
    failed += 1;
    console.log(`✗ ${project.name}`);
    process.stdout.write(new TextDecoder().decode(result.stdout));
    process.stdout.write(new TextDecoder().decode(result.stderr));
  }
}

if (skipped > 0) {
  console.log(`\n${PROJECTS.length - skipped}/${PROJECTS.length} 个项目检查了类型。`);
}

process.exit(failed > 0 ? 1 : 0);
