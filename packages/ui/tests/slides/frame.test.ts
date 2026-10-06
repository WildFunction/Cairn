import { describe, expect, test } from 'bun:test';
import { toCaptions } from '@cairn/core/pipeline/caption';
import type { NodeDeck } from '@cairn/core/types';
import { frameAt } from '../../src/slides/frame';
import { LEAD_MS } from '../../src/slides/reveal';

const deck: NodeDeck = {
  nodeId: 'n0',
  slides: [
    { layout: 'title', title: 'Opening', atMs: 0 },
    { layout: 'points', heading: 'Two things', points: ['The first', 'The second'], atMs: 4000 },
    { layout: 'quote', text: 'A line.', atMs: 10_000 },
  ],
  narration: [
    { text: 'This is how it opens.', startMs: 0, endMs: 4000 },
    { text: 'There are two things to hold on to.', startMs: 4000, endMs: 10_000 },
    { text: 'And one line to remember.', startMs: 10_000, endMs: 14_000 },
  ],
  audioPath: 'audio/n0.mp3',
  durationMs: 14_000,
};
const captions = toCaptions(deck.narration);

describe('frameAt', () => {
  test('a station opens on its first slide and first caption', () => {
    const frame = frameAt(deck, captions, 0);
    expect(frame.slideIdx).toBe(0);
    expect(frame.slide?.layout).toBe('title');
    expect(frame.captionIdx).toBe(0);
    expect(frame.caption?.text).toBe(captions[0]?.text);
  });

  test('the picture turns the lead ahead of the sound, never after it', () => {
    expect(frameAt(deck, captions, 4000 - LEAD_MS - 1).slideIdx).toBe(0);
    expect(frameAt(deck, captions, 4000 - LEAD_MS).slideIdx).toBe(1);
  });

  test('the reveal window spans this slide and is read at the lead', () => {
    const frame = frameAt(deck, captions, 5000);
    expect(frame.reveal).toEqual({ cues: captions, spanStartMs: 4000, spanEndMs: 10_000, ms: 5000 + LEAD_MS });
  });

  test("the last slide's window runs to the end of the audio", () => {
    expect(frameAt(deck, captions, 12_000).reveal.spanEndMs).toBe(14_000);
  });

  test('between two captions the last one that started is held', () => {
    const second = captions[1];
    if (!second) throw new Error('fixture has fewer captions than the test needs');
    const frame = frameAt(deck, captions, second.startMs + 50);
    expect(frame.captionIdx).toBe(1);
    expect(frame.caption).toBe(second);
  });

  test('scrubbing back returns the earlier slide', () => {
    expect(frameAt(deck, captions, 12_000).slideIdx).toBe(2);
    expect(frameAt(deck, captions, 1000).slideIdx).toBe(0);
  });

  test('a deck with no narration has a slide and no caption', () => {
    const silent = frameAt({ ...deck, narration: [] }, [], 6000);
    expect(silent.slideIdx).toBe(1);
    expect(silent.caption).toBeUndefined();
  });
});
