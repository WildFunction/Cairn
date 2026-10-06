import { describe, expect, test } from 'bun:test';
import { hasMoved, loadedAt, newerPlace, shouldPush, toSynced } from '../src/place-sync';

const nodes = ['n0', 'n1', 'recap'];

describe('newerPlace', () => {
  test("iCloud's place wins when the phone moved since", () => {
    expect(newerPlace({ nodeId: 'n0', ms: 9000, updatedAt: 100 }, { nodeId: 'n1', ms: 2000, updatedAt: 200, device: 'iPhone' }, nodes))
      .toEqual({ nodeId: 'n1', ms: 2000, updatedAt: 200 });
  });

  test("this Mac's place wins when it is newer, and comes back as it was", () => {
    const local = { nodeId: 'n0', ms: 9000, updatedAt: 300 };
    expect(newerPlace(local, { nodeId: 'n1', ms: 2000, updatedAt: 200, device: 'iPhone' }, nodes)).toBe(local);
  });

  test('a place stored before places had a time loses to any from iCloud', () => {
    expect(newerPlace({ nodeId: 'recap', ms: 1 }, { nodeId: 'n0', ms: 5, updatedAt: 1, device: 'iPhone' }, nodes)?.nodeId).toBe('n0');
  });

  test('either side alone is kept, and neither is nothing', () => {
    expect(newerPlace(undefined, { nodeId: 'n0', ms: 5, updatedAt: 1, device: 'iPhone' }, nodes)).toEqual({ nodeId: 'n0', ms: 5, updatedAt: 1 });
    expect(newerPlace({ nodeId: 'n0', ms: 5 }, undefined, nodes)).toEqual({ nodeId: 'n0', ms: 5 });
    expect(newerPlace(undefined, undefined, nodes)).toBeUndefined();
  });
});

test('a place without a time is stamped with now when it is sent', () => {
  expect(toSynced({ nodeId: 'n0', ms: 5 }, 77)).toEqual({ nodeId: 'n0', ms: 5, updatedAt: 77, device: 'Mac' });
});

describe('shouldPush', () => {
  const last = { nodeId: 'n0', at: 1000 };

  test('playing on in the same station waits out the interval', () => {
    expect(shouldPush(last, { nodeId: 'n0' }, 1000 + 29_999, false, 30_000)).toBe(false);
    expect(shouldPush(last, { nodeId: 'n0' }, 1000 + 30_000, false, 30_000)).toBe(true);
  });

  test('a new station, a pause or a leave goes at once', () => {
    expect(shouldPush(last, { nodeId: 'n1' }, 1001, false, 30_000)).toBe(true);
    expect(shouldPush(last, { nodeId: 'n0' }, 1001, true, 30_000)).toBe(true);
    expect(shouldPush(undefined, { nodeId: 'n0' }, 1001, false, 30_000)).toBe(true);
  });
});

describe('a report that is only the deck loading', () => {
  const opened = { bookId: 'b', nodeId: 'n3', ms: 42_000 };

  test('the first report of a station is where it was opened, not the reader moving', () => {
    expect(hasMoved(undefined, opened)).toBe(false);
    expect(hasMoved(loadedAt(undefined, opened), opened)).toBe(false);
  });

  test('playing or seeking from there is moving', () => {
    expect(hasMoved(opened, { ...opened, ms: 42_250 })).toBe(true);
    expect(hasMoved(opened, { ...opened, ms: 10_000 })).toBe(true);
  });

  test('another station or another book starts over', () => {
    const next = { ...opened, nodeId: 'n4', ms: 0 };
    expect(hasMoved(opened, next)).toBe(false);
    expect(loadedAt(opened, next)).toBe(next);
    expect(loadedAt(opened, { ...opened, ms: 50_000 })).toBe(opened);
    expect(hasMoved(opened, { ...opened, bookId: 'other', ms: 1 })).toBe(false);
  });
});
