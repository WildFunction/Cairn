import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_LEDGER } from '@cairn/core/sync/auto';
import { ledgerName, syncLedger } from '../../src/main/cloud-sync';

test('what a development build uploaded is not what the release has uploaded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cairn-ledger-'));
  try {
    await syncLedger(join(dir, ledgerName(true))).write({ off: [], sent: ['book-a'], drop: [] });
    expect(await syncLedger(join(dir, ledgerName(false))).read()).toEqual(EMPTY_LEDGER);
    expect(await syncLedger(join(dir, ledgerName(true))).read()).toEqual({ off: [], sent: ['book-a'], drop: [] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
