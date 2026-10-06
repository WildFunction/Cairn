import { describe, expect, test } from 'bun:test';
import { CloudError } from '../../src/sync/cloud';
import { parseReply, recordFrom } from '../../src/sync/wire';

const thrownBy = (stdout: string): CloudError => {
  try {
    parseReply(stdout);
  } catch (cause) {
    if (cause instanceof CloudError) return cause;
    throw cause;
  }
  throw new Error('parseReply did not throw');
};

describe('parseReply', () => {
  test('a success passes through', () => {
    expect(parseReply('{"ok":true,"account":"available"}\n')).toEqual({ ok: true, account: 'available' });
  });

  test("a named failure keeps the helper's code and message", () => {
    const error = thrownBy('{"ok":false,"error":{"code":"quota_exceeded","message":"iCloud is full"}}');
    expect(error.code).toBe('quota_exceeded');
    expect(error.detail).toBe('iCloud is full');
  });

  test('a code this build does not know is a plain failure, not a crash', () => {
    expect(thrownBy('{"ok":false,"error":{"code":"brand_new","message":"m"}}').code).toBe('failed');
  });

  test('output that is not a reply is a failure carrying what was printed', () => {
    const error = thrownBy('dyld: Library not loaded');
    expect(error.code).toBe('failed');
    expect(error.detail).toContain('dyld');
  });

  test('silence is a failure', () => {
    expect(thrownBy('').code).toBe('failed');
  });
});

describe('a fetched record', () => {
  test('keeps its strings and ints and drops what the wire cannot carry', () => {
    const reply = parseReply(JSON.stringify({
      ok: true,
      record: { type: 'Progress', fields: { nodeId: { string: 'n1' }, ms: { int: 4000 }, odd: { asset: '/x' }, bad: { int: 'x' } } },
    }));
    expect(recordFrom(reply, 'progress')).toEqual({
      type: 'Progress', name: 'progress', fields: { nodeId: { string: 'n1' }, ms: { int: 4000 } },
    });
  });

  test('a record that does not exist is nothing', () => {
    expect(recordFrom(parseReply('{"ok":true,"record":null}'), 'progress')).toBeUndefined();
    expect(recordFrom(parseReply('{"ok":true}'), 'progress')).toBeUndefined();
  });
});
