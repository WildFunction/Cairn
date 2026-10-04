import { describe, expect, test } from 'bun:test';
import {
  clampVolume, HOLD_RATES, holdRate, nextRate, RATES, seekDistance, stepHoldRate,
} from '../src/panes/useTransport';

describe('seekDistance', () => {
  test('1 倍速点一下跳 5 秒', () => expect(seekDistance(1)).toBe(5));
  test('2 倍速点一下跳 10 秒', () => expect(seekDistance(2)).toBe(10));
  test('0.75 倍速跳得更近', () => expect(seekDistance(0.75)).toBeLessThan(5));
  test('与倍速成正比', () => {
    expect(seekDistance(3) / seekDistance(1)).toBe(3);
  });
});

describe('holdRate', () => {
  test('长按从上次选的档位开始', () => {
    expect(holdRate(1, 2)).toBe(2);
    expect(holdRate(1, 3)).toBe(3);
    expect(holdRate(1.25, 1.5)).toBe(1.5);
  });
  test('已经 2 倍速时长按仍然加速 —— 不能毫无反应', () => {
    expect(holdRate(2, 2)).toBe(3);
    expect(holdRate(1.5, 1.5)).toBe(2);
  });
  test('已经是最高档时停在最高档，不会反而变慢', () => expect(holdRate(3, 2)).toBe(3));
  test('只落在三个档位上', () => {
    for (const r of RATES) for (const p of HOLD_RATES) expect(HOLD_RATES).toContain(holdRate(r, p));
  });
});

describe('stepHoldRate', () => {
  test('↓ 更快，↑ 更慢，和徽标上的排列一致', () => {
    expect(stepHoldRate(2, 1)).toBe(3);
    expect(stepHoldRate(2, -1)).toBe(1.5);
  });
  test('到头就停，不绕回去', () => {
    expect(stepHoldRate(3, 1)).toBe(3);
    expect(stepHoldRate(1.5, -1)).toBe(1.5);
  });
});

describe('nextRate', () => {
  test('按档位依次前进', () => expect(nextRate(1)).toBe(1.25));
  test('末档回到首档', () => expect(nextRate(RATES[RATES.length - 1]!)).toBe(RATES[0]));
  test('循环一圈回到原点', () => {
    let r: number = RATES[0]!;
    for (let i = 0; i < RATES.length; i += 1) r = nextRate(r);
    expect(r).toBe(RATES[0]);
  });
  test('档位递增且包含 1 倍速', () => {
    expect([...RATES]).toEqual([...RATES].sort((a, b) => a - b));
    expect(RATES).toContain(1);
  });
});

describe('clampVolume', () => {
  test('keeps a level the element can accept', () => {
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(0.42)).toBe(0.42);
    expect(clampVolume(1)).toBe(1);
  });

  /** ↑ at full volume and ↓ at silence both overshoot the range by a step. */
  test('clamps what the keyboard steps past the ends', () => {
    expect(clampVolume(1.1)).toBe(1);
    expect(clampVolume(-0.1)).toBe(0);
  });

  test('a non-number falls back to audible rather than silent', () => {
    expect(clampVolume(Number.NaN)).toBe(1);
  });
});
