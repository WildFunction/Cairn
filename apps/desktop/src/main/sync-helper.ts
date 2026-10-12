import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const IN_BUNDLE = '../Helpers/CairnSync.app/Contents/MacOS/CairnSync';

export type SyncEnvironment = 'development' | 'production';
type Env = Readonly<Record<string, string | undefined>>;

/**
 * Which CloudKit database this build reaches. Production unless a development build asks
 * otherwise: the helper and the ledger both follow this one answer, because a ledger read
 * against the other database takes every book in it for removed.
 */
export function syncEnvironment(devBuild: boolean, env: Env): SyncEnvironment {
  return devBuild && env.CAIRN_SYNC_ENV === 'development' ? 'development' : 'production';
}

/** Where `bun run sync-helper` and `sync-helper:development` leave theirs, under `apps/desktop`. */
export function builtSyncHelper(environment: SyncEnvironment): string {
  return `sync-helper/build/${environment}/Build/Products/Debug/CairnSync.app/Contents/MacOS/CairnSync`;
}

/**
 * Where the CloudKit helper may be, found from this process's own executable: inside the
 * bundle, where `scripts/embed-sync-helper.ts` puts it when packaging, then for a build
 * under `apps/desktop/build/` the one built in the repository for its environment.
 */
export function syncHelperPaths(execPath: string, env: Env, environment: SyncEnvironment): readonly string[] {
  if (env.CAIRN_SYNC_HELPER) return [env.CAIRN_SYNC_HELPER];
  const bundled = join(dirname(execPath), IN_BUNDLE);
  const at = execPath.indexOf('/apps/desktop/build/');
  return at < 0 ? [bundled] : [bundled, join(execPath.slice(0, at), 'apps/desktop', builtSyncHelper(environment))];
}

/** The helper, if it is actually there to run. */
export function installedSyncHelper(environment: SyncEnvironment): string | undefined {
  return syncHelperPaths(process.execPath, process.env, environment).find((path) => existsSync(path));
}
