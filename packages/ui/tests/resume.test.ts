import { describe, expect, test } from 'bun:test';
import {
  EMPTY_RESUME, closeBook, forgetBook, openBook, parseStored, placeIn, remember, shouldWrite,
  startAt, type ResumeStore,
} from '../src/panes/resume';

const stored = (store: ResumeStore): string => JSON.stringify(store);

describe('resume 读写', () => {
  test('记住的是书和书里的位置', () => {
    const s = remember(EMPTY_RESUME, 'b1', { nodeId: 'n3', ms: 42_000 });
    expect(s.lastBookId).toBe('b1');
    expect(placeIn(s, 'b1')).toEqual({ nodeId: 'n3', ms: 42_000 });
  });

  test('多本书各记各的位置', () => {
    const s = remember(remember(EMPTY_RESUME, 'b1', { nodeId: 'n1', ms: 1000 }), 'b2', { nodeId: 'n7', ms: 9000 });
    expect(placeIn(s, 'b1')).toEqual({ nodeId: 'n1', ms: 1000 });
    expect(placeIn(s, 'b2')).toEqual({ nodeId: 'n7', ms: 9000 });
    expect(s.lastBookId).toBe('b2');
  });

  test('不改动传入的 store', () => {
    const before = remember(EMPTY_RESUME, 'b1', { nodeId: 'n1', ms: 1000 });
    const snapshot = stored(before);
    remember(before, 'b1', { nodeId: 'n2', ms: 2000 });
    expect(stored(before)).toBe(snapshot);
  });

  test('打开另一本书只换 lastBookId，位置全部保留', () => {
    const s = openBook(remember(EMPTY_RESUME, 'b1', { nodeId: 'n3', ms: 5000 }), 'b2');
    expect(s.lastBookId).toBe('b2');
    expect(placeIn(s, 'b1')).toEqual({ nodeId: 'n3', ms: 5000 });
  });

  test('返回书架后不再自动打开任何书，但位置留着', () => {
    const s = closeBook(remember(EMPTY_RESUME, 'b1', { nodeId: 'n3', ms: 5000 }));
    expect(s.lastBookId).toBeUndefined();
    expect(placeIn(s, 'b1')).toEqual({ nodeId: 'n3', ms: 5000 });
  });
});

describe('resume 解析存量数据', () => {
  test('没存过时用兜底值', () => {
    expect(parseStored(null)).toEqual(EMPTY_RESUME);
  });

  test('坏 JSON 不抛错', () => {
    expect(parseStored('{不是 JSON')).toEqual(EMPTY_RESUME);
  });

  test('丢掉字段不合法的条目，保留合法的', () => {
    const raw = JSON.stringify({
      lastBookId: 'b1',
      places: {
        b1: { nodeId: 'n2', ms: 3000 },
        b2: { nodeId: '', ms: 10 },        // 空 id
        b3: { ms: 10 },                    // 没有 id
        b4: { nodeId: 'n1', ms: 'abc' },   // ms 不是数字
        b5: null,
      },
    });
    const s = parseStored(raw);
    expect(Object.keys(s.places).sort()).toEqual(['b1', 'b4']);
    expect(placeIn(s, 'b4')).toEqual({ nodeId: 'n1', ms: 0 });
  });

  test('lastBookId 不是字符串时当作没有', () => {
    expect(parseStored(JSON.stringify({ lastBookId: 7, places: {} })).lastBookId).toBeUndefined();
  });
});

describe('resume 回到哪一秒', () => {
  const place = { nodeId: 'n3', ms: 60_000 };

  test('只对存下来的那一站生效', () => {
    expect(startAt(place, 'n3', 300_000)).toBe(60_000);
    expect(startAt(place, 'n4', 300_000)).toBe(0);
    expect(startAt(undefined, 'n3', 300_000)).toBe(0);
  });

  test('刚开头几秒不值得续播，从头开始', () => {
    expect(startAt({ nodeId: 'n3', ms: 3000 }, 'n3', 300_000)).toBe(0);
  });

  test('已经听到末尾的一站重新走一遍，而不是停在最后一口气', () => {
    expect(startAt({ nodeId: 'n3', ms: 299_000 }, 'n3', 300_000)).toBe(0);
  });

  test('不知道时长时只用开头那条规则', () => {
    expect(startAt({ nodeId: 'n3', ms: 299_000 }, 'n3')).toBe(299_000);
  });
});

describe('resume 写入节流', () => {
  test('换站立刻写', () => {
    expect(shouldWrite({ nodeId: 'n1', ms: 100_000 }, { nodeId: 'n2', ms: 0 })).toBe(true);
  });

  test('第一次写总是写', () => {
    expect(shouldWrite(undefined, { nodeId: 'n1', ms: 250 })).toBe(true);
  });

  test('同一站上前进不到 5 秒不写', () => {
    expect(shouldWrite({ nodeId: 'n1', ms: 10_000 }, { nodeId: 'n1', ms: 12_000 })).toBe(false);
    expect(shouldWrite({ nodeId: 'n1', ms: 10_000 }, { nodeId: 'n1', ms: 15_000 })).toBe(true);
  });

  test('往回拖也算一次变化', () => {
    expect(shouldWrite({ nodeId: 'n1', ms: 60_000 }, { nodeId: 'n1', ms: 10_000 })).toBe(true);
  });
});

describe('forgetBook', () => {
  const store: ResumeStore = {
    lastBookId: 'atomic-habits-ab12cd',
    places: {
      'atomic-habits-ab12cd': { nodeId: 'n3', ms: 40_000 },
      'pro-git-zh-9f01ac': { nodeId: 'n1', ms: 8_000 },
    },
  };

  test('drops that book and leaves the others alone', () => {
    const next = forgetBook(store, 'atomic-habits-ab12cd');
    expect(placeIn(next, 'atomic-habits-ab12cd')).toBeUndefined();
    expect(placeIn(next, 'pro-git-zh-9f01ac')).toEqual({ nodeId: 'n1', ms: 8_000 });
  });

  /**
   * The bug this prevents: re-adding the same file lands on the same id, so a
   * kept position resumes the new path at a station that no longer exists.
   */
  test('stops the next launch reopening a book that is gone', () => {
    expect(forgetBook(store, 'atomic-habits-ab12cd').lastBookId).toBeUndefined();
  });

  test('keeps lastBookId when a different book is deleted', () => {
    expect(forgetBook(store, 'pro-git-zh-9f01ac').lastBookId).toBe('atomic-habits-ab12cd');
  });

  test('deleting a book with no stored position changes nothing', () => {
    expect(forgetBook(store, 'never-opened-000000')).toEqual(store);
  });
});

describe('resume and iCloud', () => {
  test('a place keeps when it was recorded, and an older store without it still reads', () => {
    const s = remember(EMPTY_RESUME, 'b1', { nodeId: 'n3', ms: 42_000, updatedAt: 1_700 });
    expect(placeIn(parseStored(JSON.stringify(s)), 'b1')).toEqual({ nodeId: 'n3', ms: 42_000, updatedAt: 1_700 });
    expect(placeIn(parseStored('{"places":{"b1":{"nodeId":"n3","ms":5}}}'), 'b1')).toEqual({ nodeId: 'n3', ms: 5 });
    expect(placeIn(parseStored('{"places":{"b1":{"nodeId":"n3","ms":5,"updatedAt":"x"}}}'), 'b1')).toEqual({ nodeId: 'n3', ms: 5 });
  });
});
