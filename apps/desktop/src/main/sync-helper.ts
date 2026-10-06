import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BUILT = 'sync-helper/build/Build/Products/Debug/CairnSync.app/Contents/MacOS/CairnSync';

/**
 * Where the CloudKit helper `bun run sync-helper` builds, found from this
 * process's own executable inside `apps/desktop/build/`. A packaged app does not
 * carry the helper yet, so outside a development build this is nothing unless
 * `CAIRN_SYNC_HELPER` names one.
 */
export function syncHelperPath(execPath: string, env: Readonly<Record<string, string | undefined>>): string | undefined {
  if (env.CAIRN_SYNC_HELPER) return env.CAIRN_SYNC_HELPER;
  const marker = '/apps/desktop/build/';
  const at = execPath.indexOf(marker);
  return at < 0 ? undefined : join(execPath.slice(0, at), 'apps/desktop', BUILT);
}

/** The helper, if it is actually there to run. */
export function installedSyncHelper(): string | undefined {
  const path = syncHelperPath(process.execPath, process.env);
  return path && existsSync(path) ? path : undefined;
}
