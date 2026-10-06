/**
 * Where a reader stopped, as both devices write it. The phone and the Mac each
 * write a place; the newer one wins, and on a tie the one further along the
 * path. `apps/ios/CairnKit` implements the same rule against the same table
 * (`tests/sync/fixtures/progress-merge.json`).
 */
import type { CloudValue } from './cloud';

export interface SyncedPlace {
  readonly nodeId: string;
  readonly ms: number;
  /** Epoch milliseconds. */
  readonly updatedAt: number;
  readonly device: string;
}

/** The place to keep, given this side's and the other side's. */
export function mergePlaces(
  local: SyncedPlace | undefined,
  remote: SyncedPlace | undefined,
  nodeIds: readonly string[],
): SyncedPlace | undefined {
  if (!local || !remote) return local ?? remote;
  if (local.updatedAt !== remote.updatedAt) return remote.updatedAt > local.updatedAt ? remote : local;
  const along = (place: SyncedPlace): number => nodeIds.indexOf(place.nodeId);
  if (along(local) !== along(remote)) return along(remote) > along(local) ? remote : local;
  return remote.ms > local.ms ? remote : local;
}

/** A `Progress` record's fields, or nothing when they do not describe a place. */
export function placeFromFields(fields: Readonly<Record<string, CloudValue>>): SyncedPlace | undefined {
  const text = (name: string): string | undefined => {
    const value = fields[name];
    return value && 'string' in value ? value.string : undefined;
  };
  const number = (name: string): number | undefined => {
    const value = fields[name];
    return value && 'int' in value && Number.isFinite(value.int) ? value.int : undefined;
  };
  const nodeId = text('nodeId');
  const ms = number('ms');
  const updatedAt = number('updatedAt');
  if (!nodeId || ms === undefined || updatedAt === undefined) return undefined;
  return { nodeId, ms: Math.max(0, Math.round(ms)), updatedAt, device: text('device') ?? '' };
}
