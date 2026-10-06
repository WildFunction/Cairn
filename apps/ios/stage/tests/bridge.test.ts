import { describe, expect, test } from 'bun:test';
import type { NodeDeck } from '@cairn/core/types';
import { clockAt, createBridge, INITIAL, type Outgoing, toAnchor, toPrefs, toStation } from '../bridge';

const deck: NodeDeck = {
  nodeId: 'n0',
  slides: [{ layout: 'title', title: 'Opening', atMs: 0 }],
  narration: [{ text: 'Hello.', startMs: 0, endMs: 2000 }],
  audioPath: 'audio/n0.mp3',
  durationMs: 60_000,
};

describe('clockAt', () => {
  test('a paused clock stays where the app put it', () => {
    expect(clockAt({ ms: 5000, rate: 2, playing: false, at: 100 }, 9999, 60_000)).toBe(5000);
  });

  test('a playing clock advances by elapsed time at the playback rate', () => {
    expect(clockAt({ ms: 5000, rate: 1, playing: true, at: 100 }, 600, 60_000)).toBe(5500);
    expect(clockAt({ ms: 5000, rate: 2, playing: true, at: 100 }, 600, 60_000)).toBe(6000);
  });

  test('it never runs past the end of the audio', () => {
    expect(clockAt({ ms: 59_900, rate: 3, playing: true, at: 0 }, 1000, 60_000)).toBe(60_000);
  });
});

describe('what the app sends is untrusted', () => {
  test('a load without a deck is refused', () => {
    expect(() => toStation({ stationNo: 1 })).toThrow('not a deck');
    expect(() => toStation({ deck: { slides: [] } })).toThrow('not a deck');
  });

  test('a load keeps the deck as it came and fills in what is missing', () => {
    expect(toStation({ deck, stationNo: 3, locale: 'zh', stageTitle: 'Building' }))
      .toEqual({ deck, stationNo: 3, locale: 'zh', stageTitle: 'Building' });
    expect(toStation({ deck, locale: 'fr' })).toEqual({ deck, stationNo: 1, locale: 'en' });
  });

  test('a sync with nonsense in it is a paused clock at zero, not NaN', () => {
    expect(toAnchor({ ms: 'x', rate: 0 }, 7)).toEqual({ ms: 0, rate: 1, playing: false, at: 7 });
  });

  test('a preference left out keeps its value', () => {
    expect(toPrefs({ lifted: true }, INITIAL.prefs)).toEqual({ ...INITIAL.prefs, lifted: true });
    expect(toPrefs({ captionScale: 99 }, INITIAL.prefs).captionScale).toBe(3);
  });
});

describe('the bridge', () => {
  const setup = (): { posted: Outgoing[]; clock: { now: number }; bridge: ReturnType<typeof createBridge> } => {
    const posted: Outgoing[] = [];
    const clock = { now: 0 };
    return { posted, clock, bridge: createBridge((message) => posted.push(message), () => clock.now) };
  };

  test('a new station starts paused at zero whatever the last one was doing', () => {
    const { bridge, clock } = setup();
    bridge.api.load({ deck, stationNo: 1 });
    bridge.api.sync({ ms: 30_000, rate: 1, playing: true });
    clock.now = 500;
    bridge.api.load({ deck, stationNo: 2 });
    expect(bridge.getState().anchor).toEqual({ ms: 0, rate: 1, playing: false, at: 500 });
    expect(bridge.getState().station?.stationNo).toBe(2);
  });

  test('a sync during steady playback reports how far the page had drifted', () => {
    const { bridge, clock, posted } = setup();
    bridge.api.load({ deck, stationNo: 1 });
    bridge.api.sync({ ms: 1000, rate: 1.5, playing: true });
    clock.now = 500;
    bridge.api.sync({ ms: 1740, rate: 1.5, playing: true });
    expect(posted).toEqual([{ type: 'gap', ms: 10 }]);
  });

  test('a seek, a pause or a rate change is a jump, not drift', () => {
    const { bridge, clock, posted } = setup();
    bridge.api.load({ deck, stationNo: 1 });
    bridge.api.sync({ ms: 1000, rate: 1, playing: false });
    clock.now = 500;
    bridge.api.sync({ ms: 9000, rate: 1, playing: true });
    clock.now = 900;
    bridge.api.sync({ ms: 9400, rate: 2, playing: true });
    expect(posted).toEqual([]);
  });

  test('a bad call is reported to the app instead of breaking the page', () => {
    const { bridge, posted } = setup();
    bridge.api.load({ nope: true });
    expect(posted).toEqual([{ type: 'error', message: 'load: not a deck' }]);
    expect(bridge.getState().station).toBeUndefined();
  });

  test('subscribers hear every change and stop hearing after they leave', () => {
    const { bridge } = setup();
    let heard = 0;
    const leave = bridge.subscribe(() => { heard += 1; });
    bridge.api.set({ captions: false });
    leave();
    bridge.api.set({ captions: true });
    expect(heard).toBe(1);
  });
});
