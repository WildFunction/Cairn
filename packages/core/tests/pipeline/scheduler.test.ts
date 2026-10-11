import { describe, expect, test } from 'bun:test';
import { memoryStore } from '../../src/pipeline/job';
import { lookaheadFor, startDeckScheduler } from '../../src/pipeline/scheduler';
import type { NodeDeck, PathNode } from '../../src/types';

const nodes = (count: number): readonly PathNode[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `n${i}`, idx: i, title: `第 ${i} 站`, kind: 'concept' as const,
    brief: '', keyPoints: [], sourceChapters: [i], estMinutes: 3,
  }));

const deck = (nodeId: string): NodeDeck => ({
  nodeId, slides: [], narration: [], audioPath: `/tmp/${nodeId}.mp3`, durationMs: 180_000,
});

/** A build whose completion the test drives, so ordering is observable. */
function gated(): {
  build: (node: PathNode) => Promise<NodeDeck>;
  started: string[];
  release: (nodeId: string, error?: Error) => void;
  waitStart: (count: number) => Promise<void>;
  /** Builds started but not yet released — `stop` does not cancel those. */
  outstanding: () => readonly string[];
} {
  const started: string[] = [];
  const gates = new Map<string, (v: { error?: Error }) => void>();
  const arrivals: (() => void)[] = [];

  return {
    started,
    async build(node) {
      started.push(node.id);
      for (const fn of arrivals.splice(0)) fn();
      const outcome = await new Promise<{ error?: Error }>((r) => gates.set(node.id, r));
      if (outcome.error) throw outcome.error;
      return deck(node.id);
    },
    release(nodeId, error) {
      const gate = gates.get(nodeId);
      if (!gate) throw new Error(`${nodeId} 还没开始，无法放行`);
      gates.delete(nodeId);
      gate(error ? { error } : {});
    },
    outstanding: () => [...gates.keys()],
    async waitStart(count) {
      while (started.length < count) {
        await new Promise<void>((r) => { arrivals.push(r); });
      }
    },
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('startDeckScheduler', () => {
  test('默认按路径顺序建站', async () => {
    const store = memoryStore<NodeDeck>();
    const s = startDeckScheduler({
      nodes: nodes(3), store, lookahead: 1,
      build: async (n) => deck(n.id),
    });
    await s.done;
    expect([...s.ready()]).toEqual(['n0', 'n1', 'n2']);
  });

  test('已经在 store 里的站不重建——这就是续跑', async () => {
    const store = memoryStore<NodeDeck>([['n1', deck('n1')]]);
    const built: string[] = [];
    const s = startDeckScheduler({
      nodes: nodes(3), store, lookahead: 1,
      build: async (n) => { built.push(n.id); return deck(n.id); },
    });
    await s.done;
    expect(built).toEqual(['n0', 'n2']);
    expect(s.ready().has('n1')).toBe(true);
  });

  test('focus 把读者所在的站插到队首，后面的站跟着它排', async () => {
    const g = gated();
    const store = memoryStore<NodeDeck>();
    const s = startDeckScheduler({ nodes: nodes(6), store, lookahead: 1, build: g.build });

    await g.waitStart(1);
    expect(g.started).toEqual(['n0']);

    s.focus('n4');
    g.release('n0');

    await g.waitStart(2);
    expect(g.started[1]).toBe('n4');

    g.release('n4');
    await g.waitStart(3);
    expect(g.started[2]).toBe('n5');

    s.stop();
    for (const id of g.outstanding()) g.release(id);
    await s.done;
  });

  test('读者跳过的站不会被丢掉，只是排到后面', async () => {
    const g = gated();
    const s = startDeckScheduler({
      nodes: nodes(4), store: memoryStore<NodeDeck>(), lookahead: 1, build: g.build,
    });

    await g.waitStart(1);
    s.focus('n2');
    g.release('n0');

    for (let n = 2; n <= 4; n += 1) {
      await g.waitStart(n);
      g.release(g.started[n - 1]!);
    }
    await s.done;

    // n2, n3 先做，被跳过的 n1 排到末尾而不是被丢掉
    expect(g.started).toEqual(['n0', 'n2', 'n3', 'n1']);
    expect(s.ready().size).toBe(4);
  });

  test('并发不超过 lookahead —— 预取不该抢光 provider', async () => {
    const g = gated();
    const s = startDeckScheduler({
      nodes: nodes(6), store: memoryStore<NodeDeck>(), lookahead: 2, build: g.build,
    });

    await g.waitStart(2);
    await tick();
    expect(g.started).toHaveLength(2);

    g.release('n0');
    await g.waitStart(3);
    expect(g.started).toHaveLength(3);

    s.stop();
    for (const id of g.outstanding()) g.release(id);
    await s.done;
  });

  test('finish builds what is left at a committed reader\'s pace, wherever the reader is', async () => {
    const g = gated();
    const s = startDeckScheduler({ nodes: nodes(10), store: memoryStore<NodeDeck>(), build: g.build });

    await g.waitStart(1);
    await tick();
    expect(g.started).toHaveLength(1);
    expect(s.finishing).toBe(false);

    s.finish();
    await g.waitStart(6);
    await tick();
    expect(g.started).toHaveLength(6);
    expect(s.finishing).toBe(true);

    s.stop();
    for (const id of g.outstanding()) g.release(id);
    await s.done;
  });

  test('waitFor 拿到那一站就返回，不等整本书', async () => {
    const g = gated();
    const s = startDeckScheduler({
      nodes: nodes(5), store: memoryStore<NodeDeck>(), lookahead: 1, build: g.build,
    });

    const first = s.waitFor('n0');
    await g.waitStart(1);
    g.release('n0');

    expect((await first).nodeId).toBe('n0');
    expect(s.ready().size).toBe(1);
    expect(s.progress.total).toBe(5);

    s.stop();
    for (const id of g.outstanding()) g.release(id);
    await s.done;
  });

  test('waitFor 已经建好的站直接返回', async () => {
    const store = memoryStore<NodeDeck>([['n2', deck('n2')]]);
    const s = startDeckScheduler({
      nodes: nodes(3), store, lookahead: 3, build: async (n) => deck(n.id),
    });
    expect((await s.waitFor('n2')).nodeId).toBe('n2');
    await s.done;
  });

  test('单站失败不影响其他站', async () => {
    const failures: string[] = [];
    const s = startDeckScheduler({
      nodes: nodes(3), store: memoryStore<NodeDeck>(), lookahead: 1, maxAttempts: 1,
      build: async (n) => {
        if (n.id === 'n1') throw new Error('溯源章节不存在');
        return deck(n.id);
      },
      onFailed: (id) => failures.push(id),
    });

    await s.done;
    expect(failures).toEqual(['n1']);
    expect([...s.ready()]).toEqual(['n0', 'n2']);
    expect(s.progress.failed).toBe(1);
  });

  test('retryFailed puts a failed station back in the queue while others still build', async () => {
    const g = gated();
    const s = startDeckScheduler({
      nodes: nodes(2), store: memoryStore<NodeDeck>(), lookahead: 2, maxAttempts: 1, build: g.build,
    });
    s.focus('n1');
    await g.waitStart(2);
    g.release('n0', new Error('broke'));
    await tick();
    expect(s.progress.failed).toBe(1);

    expect(s.retryFailed()).toEqual(['n0']);
    expect(s.progress.failed).toBe(0);
    await g.waitStart(3);
    g.release('n0');
    g.release('n1');
    await s.done;
    expect([...s.ready()].sort()).toEqual(['n0', 'n1']);
  });

  test('retryFailed refuses once the run is over, so the caller starts a new one', async () => {
    const s = startDeckScheduler({
      nodes: nodes(1), store: memoryStore<NodeDeck>(), lookahead: 1, maxAttempts: 1,
      build: async () => { throw new Error('broke'); },
    });
    await s.done;
    expect(s.retryFailed()).toBeUndefined();
  });

  test('失败会重试，但有上限', async () => {
    let attempts = 0;
    const s = startDeckScheduler({
      nodes: nodes(1), store: memoryStore<NodeDeck>(), lookahead: 1,
      maxAttempts: 3, baseDelayMs: 0, sleep: async () => undefined,
      build: async () => { attempts += 1; throw new Error('炸了'); },
    });
    await s.done;
    expect(attempts).toBe(3);
  });

  test('waitFor 在那一站彻底失败时拒绝，而不是永远挂着', async () => {
    const s = startDeckScheduler({
      nodes: nodes(2), store: memoryStore<NodeDeck>(), lookahead: 1, maxAttempts: 1,
      build: async (n) => { if (n.id === 'n0') throw new Error('建不出来'); return deck(n.id); },
    });
    await expect(s.waitFor('n0')).rejects.toThrow('建不出来');
    await s.done;
  });

  test('暂停期间不开新站，恢复后继续 —— 提问要能插队', async () => {
    const g = gated();
    const s = startDeckScheduler({
      nodes: nodes(4), store: memoryStore<NodeDeck>(), lookahead: 1, build: g.build,
    });

    await g.waitStart(1);
    const resume = s.pause();
    g.release('n0');

    await tick();
    await tick();
    expect(g.started).toHaveLength(1);

    resume();
    await g.waitStart(2);
    expect(g.started).toHaveLength(2);

    s.stop();
    for (const id of g.outstanding()) g.release(id);
    await s.done;
  });

  test('多次 pause 需要同样多次恢复才继续', async () => {
    const g = gated();
    const s = startDeckScheduler({
      nodes: nodes(3), store: memoryStore<NodeDeck>(), lookahead: 1, build: g.build,
    });

    await g.waitStart(1);
    const a = s.pause();
    const b = s.pause();
    g.release('n0');
    a();
    await tick(); await tick();
    expect(g.started).toHaveLength(1);

    b();
    await g.waitStart(2);
    s.stop();
    for (const id of g.outstanding()) g.release(id);
    await s.done;
  });

  test('stop 之后不再开新站', async () => {
    const g = gated();
    const s = startDeckScheduler({
      nodes: nodes(5), store: memoryStore<NodeDeck>(), lookahead: 1, build: g.build,
    });

    await g.waitStart(1);
    s.stop();
    g.release('n0');
    await s.done;
    expect(g.started).toHaveLength(1);
  });

  test('每建好一站就落盘，中途崩掉不会白跑', async () => {
    const store = memoryStore<NodeDeck>();
    const g = gated();
    const s = startDeckScheduler({ nodes: nodes(3), store, lookahead: 1, build: g.build });

    await g.waitStart(1);
    g.release('n0');
    await g.waitStart(2);
    expect(store.data.has('n0')).toBe(true);

    s.stop();
    for (const id of g.outstanding()) g.release(id);
    await s.done;
  });

  test('onReady 带着进度一起回调，UI 才知道建到哪了', async () => {
    const seen: { id: string; ready: number; total: number }[] = [];
    const s = startDeckScheduler({
      nodes: nodes(3), store: memoryStore<NodeDeck>(), lookahead: 1,
      build: async (n) => deck(n.id),
      onReady: (d, p) => { seen.push({ id: d.nodeId, ready: p.ready, total: p.total }); },
    });
    await s.done;
    expect(seen).toEqual([
      { id: 'n0', ready: 1, total: 3 },
      { id: 'n1', ready: 2, total: 3 },
      { id: 'n2', ready: 3, total: 3 },
    ]);
  });

  test('没有站点时立刻完成', async () => {
    const s = startDeckScheduler({
      nodes: [], store: memoryStore<NodeDeck>(), build: async (n) => deck(n.id),
    });
    await s.done;
    expect(s.progress).toEqual({ total: 0, ready: 0, failed: 0, running: 0 });
  });

  test('focus 一个不存在的站不会打乱队列', async () => {
    const s = startDeckScheduler({
      nodes: nodes(2), store: memoryStore<NodeDeck>(), lookahead: 1,
      build: async (n) => deck(n.id),
    });
    s.focus('n99');
    await s.done;
    expect([...s.ready()]).toEqual(['n0', 'n1']);
  });
});

describe('store 键与站点 id 分开', () => {
  test('按 keyOf 读写缓存，而不是按站点位置', async () => {
    const store = memoryStore<NodeDeck>([['n0-abc', deck('n0')]]);
    const built: string[] = [];
    const s = startDeckScheduler({
      nodes: nodes(2), store, lookahead: 1,
      keyOf: (n) => `${n.id}-abc`,
      build: async (n) => { built.push(n.id); return deck(n.id); },
    });
    await s.done;

    // n0 came from the cache under its fingerprint key; only n1 was built
    expect(built).toEqual(['n1']);
    expect(store.data.has('n1-abc')).toBe(true);
  });

  test('位置相同但内容不同的站不会命中上一次的缓存', async () => {
    const store = memoryStore<NodeDeck>([['n0-old', deck('n0')]]);
    const built: string[] = [];
    const s = startDeckScheduler({
      nodes: nodes(1), store, lookahead: 1,
      keyOf: () => 'n0-new',
      build: async (n) => { built.push(n.id); return deck(n.id); },
    });
    await s.done;
    expect(built).toEqual(['n0']);
  });

  test('对外仍以站点 id 标识，UI 不需要知道指纹', async () => {
    const s = startDeckScheduler({
      nodes: nodes(2), store: memoryStore<NodeDeck>(), lookahead: 1,
      keyOf: (n) => `${n.id}-xyz`,
      build: async (n) => deck(n.id),
    });
    await s.done;
    expect([...s.ready()]).toEqual(['n0', 'n1']);
  });
});

describe('lookaheadFor', () => {
  const LONG = 40;

  test('starts at one: nothing is worth building before the station being watched', () => {
    expect(lookaheadFor(0, LONG)).toBe(1);
  });

  test('grows as the reader gets deeper into the path', () => {
    expect(lookaheadFor(2, LONG)).toBeGreaterThan(lookaheadFor(0, LONG));
    expect(lookaheadFor(6, LONG)).toBeGreaterThan(lookaheadFor(2, LONG));
  });

  test('stays modest while the reader might still stop', () => {
    expect(lookaheadFor(10, LONG)).toBeLessThanOrEqual(4);
  });

  /** Past halfway they have as good as committed, so stop rationing. */
  test('opens up past halfway', () => {
    expect(lookaheadFor(8, 15)).toBeGreaterThan(lookaheadFor(6, 40));
    expect(lookaheadFor(20, LONG)).toBeGreaterThan(lookaheadFor(19, LONG));
  });

  test('never asks for more lanes than there are stations', () => {
    expect(lookaheadFor(2, 3)).toBeLessThanOrEqual(3);
  });
});

describe('momentum', () => {
  test('one station at a time at the start, more once the reader is deep in', async () => {
    const g = gated();
    const scheduler = startDeckScheduler({
      nodes: nodes(12), build: g.build, store: memoryStore<NodeDeck>(),
    });

    await g.waitStart(1);
    expect(g.started).toHaveLength(1);

    // The reader walks to station 7; the builder should now run further ahead
    scheduler.focus('n7');
    await g.waitStart(2);
    expect(g.started.length).toBeGreaterThan(1);

    scheduler.stop();
    for (const id of g.outstanding()) g.release(id);
    await scheduler.done;
  });

  test('an explicit lookahead is still honoured exactly', async () => {
    const g = gated();
    const scheduler = startDeckScheduler({
      nodes: nodes(12), build: g.build, store: memoryStore<NodeDeck>(), lookahead: 2,
    });

    await g.waitStart(2);
    scheduler.focus('n9');
    await Promise.resolve();
    expect(g.started).toHaveLength(2);

    scheduler.stop();
    for (const id of g.outstanding()) g.release(id);
    await scheduler.done;
  });
});

describe('waitFor 与 onReady 的先后', () => {
  // `onReady` is where a deck is installed into the book. Resolving the waiter
  // first let `generate` report station 1 playable before its files existed.
  test('waitFor resolves only after onReady has finished with that deck', async () => {
    const installed: string[] = [];
    const s = startDeckScheduler({
      nodes: nodes(2), store: memoryStore<NodeDeck>(), lookahead: 1,
      build: async (n) => deck(n.id),
      onReady: async (d) => { await tick(); installed.push(d.nodeId); },
    });
    await s.waitFor('n0');
    expect(installed).toContain('n0');
    await s.done;
  });

  test('a deck already in the store is installed before its waiter hears of it', async () => {
    const store = memoryStore<NodeDeck>();
    const installed: string[] = [];
    await store.put('n0', deck('n0'));
    const s = startDeckScheduler({
      nodes: nodes(1), store, keyOf: (n) => n.id,
      build: async (n) => deck(n.id),
      onReady: async (d) => { await tick(); installed.push(d.nodeId); },
    });
    await s.waitFor('n0');
    expect(installed).toEqual(['n0']);
  });

  test('a deck that cannot be installed is a failed station, and its waiter is told so', async () => {
    const failures: string[] = [];
    const s = startDeckScheduler({
      nodes: nodes(1), store: memoryStore<NodeDeck>(),
      build: async (n) => deck(n.id),
      onReady: async () => { throw new Error('disk full'); },
      onFailed: (id) => failures.push(id),
    });
    await expect(s.waitFor('n0')).rejects.toThrow('disk full');
    await s.done;
    expect(failures).toEqual(['n0']);
    expect(s.progress).toMatchObject({ ready: 0, failed: 1, running: 0 });
  });
});
