import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloudKitStore } from '../../src/runtime/cloudkit-helper';
import { CloudError } from '../../src/sync/cloud';

/** A stand-in helper: records the request it was sent and prints the reply it was told to. */
const dir = mkdtempSync(join(tmpdir(), 'cairn-helper-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function helper(reply: string): { path: string; request: () => unknown } {
  const path = join(dir, `helper-${Math.random().toString(36).slice(2)}`);
  const seen = `${path}.request`;
  writeFileSync(path, `#!/bin/sh\ncat > '${seen}'\nprintf '%s' '${reply}'\n`);
  chmodSync(path, 0o755);
  return { path, request: () => JSON.parse(readFileSync(seen, 'utf8')) };
}

describe('cloudKitStore.read', () => {
  test('asks the helper to fetch one record and returns its fields', async () => {
    const fake = helper('{"ok":true,"record":{"type":"Progress","fields":{"nodeId":{"string":"n1"},"ms":{"int":4000}}}}');
    const record = await cloudKitStore(fake.path).read('book_x', 'progress');
    expect(fake.request()).toEqual({ op: 'fetch', zone: 'book_x', name: 'progress' });
    expect(record).toEqual({ type: 'Progress', name: 'progress', fields: { nodeId: { string: 'n1' }, ms: { int: 4000 } } });
  });

  test('a record that is not there is nothing', async () => {
    expect(await cloudKitStore(helper('{"ok":true,"record":null}').path).read('book_x', 'progress')).toBeUndefined();
  });

  test("the helper's failure arrives as a CloudError", async () => {
    const fake = helper('{"ok":false,"error":{"code":"no_account","message":"signed out"}}');
    const failure = await cloudKitStore(fake.path).read('book_x', 'progress').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(CloudError);
    expect((failure as CloudError).code).toBe('no_account');
  });

  test('a helper that is not installed is helper_missing', async () => {
    const failure = await cloudKitStore(join(dir, 'absent')).read('book_x', 'progress').catch((e: unknown) => e);
    expect((failure as CloudError).code).toBe('helper_missing');
  });
});
