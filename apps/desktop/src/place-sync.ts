import type { Place } from '@cairn/ui';
import { mergePlaces, type SyncedPlace } from '@cairn/core/sync/progress';

/** What the Mac calls itself in a Progress record. */
export const DEVICE = 'Mac';

export interface Report {
  readonly bookId: string;
  readonly nodeId: string;
  readonly ms: number;
}

/**
 * Whether a report means the reader moved. A deck reports once as it loads, at the
 * place it was opened at; counting that would stamp a place nobody touched as the
 * newest, and push it over a newer one the pull failed to fetch.
 */
export function hasMoved(loaded: Report | undefined, report: Report): boolean {
  return loaded !== undefined && loaded.bookId === report.bookId && loaded.nodeId === report.nodeId
    && loaded.ms !== report.ms;
}

/** The report a station was loaded at: kept while the station stays, replaced when it changes. */
export function loadedAt(loaded: Report | undefined, report: Report): Report {
  return loaded && loaded.bookId === report.bookId && loaded.nodeId === report.nodeId ? loaded : report;
}

/** A position that has not moved for this long is a pause, and worth sending at once. */
export const SETTLE_MS = 1_500;

/**
 * Whether a place goes to the main process now: always when forced or when the
 * station changed, otherwise no more often than `everyMs`.
 */
export function shouldPush(
  last: { readonly nodeId: string; readonly at: number } | undefined,
  place: { readonly nodeId: string },
  now: number,
  force: boolean,
  everyMs: number,
): boolean {
  return force || !last || last.nodeId !== place.nodeId || now - last.at >= everyMs;
}

/**
 * The place to resume at, given this Mac's and iCloud's: the shared rule in
 * `sync/progress.ts`. A place stored before places carried a time counts as oldest.
 */
export function newerPlace(
  local: Place | undefined,
  remote: SyncedPlace | undefined,
  nodeIds: readonly string[],
): Place | undefined {
  const mine = local ? { nodeId: local.nodeId, ms: local.ms, updatedAt: local.updatedAt ?? 0, device: DEVICE } : undefined;
  const winner = mergePlaces(mine, remote, nodeIds);
  if (!winner) return undefined;
  return winner === mine ? local : { nodeId: winner.nodeId, ms: winner.ms, updatedAt: winner.updatedAt };
}

export function toSynced(place: Place, now: number): SyncedPlace {
  return { nodeId: place.nodeId, ms: place.ms, updatedAt: place.updatedAt ?? now, device: DEVICE };
}
