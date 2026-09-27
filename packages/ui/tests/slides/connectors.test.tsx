import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Causes } from '../../src/slides/layouts/Causes';
import { Cycle } from '../../src/slides/layouts/Cycle';
import { Flow } from '../../src/slides/layouts/Flow';
import { Timeline } from '../../src/slides/layouts/Timeline';

const count = (html: string, pattern: RegExp): number => (html.match(pattern) ?? []).length;

describe('a connector arrives with the item it leads to', () => {
  test('flow: no link is drawn until the step below it is shown', () => {
    const at = (shown: number): string => renderToStaticMarkup(
      createElement(Flow, { layout: 'flow', steps: ['a', 'b', 'c'], shown }),
    );
    expect(count(at(1), /s-link in/g)).toBe(0);
    expect(count(at(2), /s-link in/g)).toBe(1);
    expect(count(at(3), /s-link in/g)).toBe(2);
  });

  test('timeline: the spine below an entry waits for the next entry', () => {
    const items = [{ mark: '1', text: 'a' }, { mark: '2', text: 'b' }, { mark: '3', text: 'c' }];
    const at = (shown: number): string => renderToStaticMarkup(
      createElement(Timeline, { layout: 'timeline', items, shown }),
    );
    expect(count(at(1), /joined/g)).toBe(0);
    expect(count(at(2), /joined/g)).toBe(1);
    expect(count(at(3), /joined/g)).toBe(2);
  });

  test('cycle: the ring closes only once the last step is shown', () => {
    const at = (shown: number): string => renderToStaticMarkup(
      createElement(Cycle, { layout: 'cycle', steps: ['a', 'b', 'c', 'd'], shown }),
    );
    expect(count(at(1), /<path class="in"/g)).toBe(0);
    expect(count(at(3), /<path class="in"/g)).toBe(2);
    expect(count(at(4), /<path class="in"/g)).toBe(4);
    expect(count(at(4), /s-cy-arrow in/g)).toBe(4);
  });

  test('causes: the spine waits for the first group, the effect does not', () => {
    const groups = [{ name: 'g1', causes: ['x'] }, { name: 'g2', causes: ['y'] }];
    const at = (shown: number): string => renderToStaticMarkup(
      createElement(Causes, { layout: 'causes', effect: 'e', groups, shown }),
    );
    expect(at(1)).toContain('s-fb-spine out');
    expect(at(2)).toContain('s-fb-spine in');
  });
});
