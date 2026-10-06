import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROGRESS_RECORD, progressRecord } from '../../src/sync/book';
import { mergePlaces, placeFromFields, type SyncedPlace } from '../../src/sync/progress';

interface Table {
  readonly path: readonly string[];
  readonly cases: readonly {
    readonly name: string;
    readonly local: SyncedPlace | null;
    readonly remote: SyncedPlace | null;
    readonly winner: 'local' | 'remote';
  }[];
}

/** The phone's test reads the same file (`apps/ios/CairnKit/Tests`). */
const table = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/progress-merge.json'), 'utf8')) as Table;

describe('mergePlaces', () => {
  for (const row of table.cases) {
    test(row.name, () => {
      const local = row.local ?? undefined;
      const remote = row.remote ?? undefined;
      expect(mergePlaces(local, remote, table.path)).toBe(row.winner === 'local' ? local : remote);
    });
  }
});

describe('the Progress record', () => {
  const place: SyncedPlace = { nodeId: 'n1', ms: 4200.4, updatedAt: 1_791_000_000_000, device: 'Mac' };

  test('carries the place as the phone reads it', () => {
    expect(progressRecord(place)).toEqual({
      type: 'Progress', name: PROGRESS_RECORD,
      fields: {
        nodeId: { string: 'n1' }, ms: { int: 4200 }, updatedAt: { int: 1_791_000_000_000 }, device: { string: 'Mac' },
      },
    });
  });

  test('reads back into the same place', () => {
    expect(placeFromFields(progressRecord(place).fields)).toEqual({ ...place, ms: 4200 });
  });

  test('fields that do not describe a place are nothing, not a place at zero', () => {
    expect(placeFromFields({ nodeId: { string: 'n1' } })).toBeUndefined();
    expect(placeFromFields({ ms: { int: 1 }, updatedAt: { int: 1 } })).toBeUndefined();
  });
});
