import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const IN_BUNDLE = '../Helpers/CairnSync.app/Contents/MacOS/CairnSync';
const BUILT = 'sync-helper/build/Build/Products/Debug/CairnSync.app/Contents/MacOS/CairnSync';

/**
 * Where the CloudKit helper may be, found from this process's own executable: inside the
 * bundle, where `scripts/embed-sync-helper.ts` puts it when packaging, then for a build
 * under `apps/desktop/build/` the one `bun run sync-helper` builds in the repository.
 */
export function syncHelperPaths(
  execPath: string,
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  if (env.CAIRN_SYNC_HELPER) return [env.CAIRN_SYNC_HELPER];
  const bundled = join(dirname(execPath), IN_BUNDLE);
  const at = execPath.indexOf('/apps/desktop/build/');
  return at < 0 ? [bundled] : [bundled, join(execPath.slice(0, at), 'apps/desktop', BUILT)];
}

/** The helper, if it is actually there to run. */
export function installedSyncHelper(): string | undefined {
  return syncHelperPaths(process.execPath, process.env).find((path) => existsSync(path));
}
