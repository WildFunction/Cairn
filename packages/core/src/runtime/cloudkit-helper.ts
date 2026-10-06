/**
 * CloudKit, reached through a signed helper. The main process is a JS runtime
 * with no CloudKit binding and no iCloud entitlement; the helper has both, so
 * every call here is one short-lived process. See `sync/wire.ts` for the pipe.
 */
import { CloudError, type CloudAccount, type CloudStore } from '../sync/cloud';
import { type HelperReply, type HelperRequest, parseReply, recordFrom } from '../sync/wire';

const ACCOUNTS: readonly CloudAccount[] = ['available', 'no_account', 'restricted', 'unknown'];

/** A station's audio on a slow uplink, with room to spare; past this the helper is hung, not busy. */
const TIMEOUT_MS = 300_000;

export function cloudKitStore(helper: string): CloudStore {
  const call = (request: HelperRequest): Promise<HelperReply> => run(helper, request);

  return {
    async account() {
      const { account } = await call({ op: 'account' });
      return ACCOUNTS.find((known) => known === account) ?? 'unknown';
    },
    async read(zone, name) {
      return recordFrom(await call({ op: 'fetch', zone, name }), name);
    },
    async fingerprints(zone) {
      const { fingerprints } = await call({ op: 'fingerprints', zone });
      return new Map(Object.entries(fingerprints ?? {}));
    },
    async save(zone, records, options) {
      await call({ op: 'save', zone, records, ...(options?.createZone === false ? { createZone: false } : {}) });
    },
    async remove(zone, names) {
      await call({ op: 'remove', zone, names });
    },
    async dropZone(zone) {
      await call({ op: 'dropZone', zone });
    },
  };
}

async function run(helper: string, request: HelperRequest): Promise<HelperReply> {
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn([helper], {
      stdin: new TextEncoder().encode(JSON.stringify(request)),
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (cause) {
    throw new CloudError('helper_missing', cause instanceof Error ? cause.message : String(cause));
  }

  const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout as ReadableStream).text(),
      new Response(child.stderr as ReadableStream).text(),
      child.exited,
    ]);
    return parseReply(stdout || stderr);
  } finally {
    clearTimeout(timer);
  }
}
