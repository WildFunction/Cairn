import { describe, expect, test } from 'bun:test';
import {
  blocksFromOutline,
  joinLines,
  linesFromRuns,
  pageParagraphs,
  stripRunningLines,
  textOfPages,
  type PdfLine,
} from '../../src/parse/pdf-layout';

/** Lines 14pt apart from the top; `null` leaves a blank line, which is how a paragraph gap looks. */
function page(...lines: (string | null)[]): PdfLine[] {
  const out: PdfLine[] = [];
  lines.forEach((text, i) => {
    if (text !== null) out.push({ text, y: 740 - i * 14 });
  });
  return out;
}

describe('stripRunningLines', () => {
  test('drops a header repeated across pages and the page numbers', () => {
    const bodies = ['Anchors hold.', 'Drift follows.', 'Priming works.', 'Framing matters.'];
    const pages = bodies.map((body, i) => page('THINKING, FAST AND SLOW', body, String(i + 1)));
    const texts = stripRunningLines(pages).map((p) => p.map((l) => l.text));
    expect(texts).toEqual(bodies.map((body) => [body]));
  });

  test('a header that carries the page number still counts as repeated', () => {
    const pages = [7, 8, 9].map((n) => page(`${n} | The Book`, `Body on page ${'abc'[n - 7]}.`));
    expect(stripRunningLines(pages).every((p) => p.length === 1)).toBe(true);
  });

  test('a header drawn after the body sits next to the footer, and both go', () => {
    const bodies = ['Anchors hold.', 'Drift follows.', 'Priming works.'];
    const pages = bodies.map((body, i) => page(body, `9/25/26, 3:0${i} PM The Book`, `file:///book.html ${i + 1}/3`));
    expect(stripRunningLines(pages).map((p) => p.map((l) => l.text))).toEqual(bodies.map((body) => [body]));
  });

  test('keeps a first line that appears only once', () => {
    const pages = [page('Unique opening.', 'Body.'), page('Another start.', 'Body.')];
    expect(stripRunningLines(pages).map((p) => p.length)).toEqual([2, 2]);
  });
});

describe('joinLines', () => {
  test('rejoins a word hyphenated across a line break', () => {
    expect(joinLines('the anchor-', 'ing effect')).toBe('the anchoring effect');
  });
  test('keeps a real hyphen before a capital', () => {
    expect(joinLines('the Anglo-', 'Saxon era')).toBe('the Anglo-Saxon era');
  });
  test('joins Chinese without a space', () => {
    expect(joinLines('锚定效应指的', '是人们')).toBe('锚定效应指的是人们');
  });
  test('joins English with a space', () => {
    expect(joinLines('first line', 'second line')).toBe('first line second line');
  });
});

describe('pageParagraphs', () => {
  test('a wider line gap starts a new paragraph', () => {
    expect(pageParagraphs(page('One a', 'one b.', null, 'Two.'))).toEqual(['One a one b.', 'Two.']);
  });
  test('a page with no gaps is one paragraph', () => {
    expect(pageParagraphs(page('a', 'b', 'c'))).toEqual(['a b c']);
  });
});

describe('textOfPages', () => {
  test('a sentence broken by a page turn is rejoined', () => {
    expect(textOfPages([['First.', 'It went on'], ['and ended.', 'Next.']])).toBe(
      'First.\n\nIt went on and ended.\n\nNext.',
    );
  });
  test('a finished sentence at the foot of a page keeps its paragraph break', () => {
    expect(textOfPages([['Done.'], ['New.']])).toBe('Done.\n\nNew.');
  });
});

describe('blocksFromOutline', () => {
  const pages = [['Front.'], ['One a.'], ['One b.'], ['Two.']];

  test('each mark owns the pages up to the next one', () => {
    const blocks = blocksFromOutline(pages, [
      { title: 'One', page: 1, group: 'One' },
      { title: 'Two', page: 3, group: 'Two' },
    ]);
    expect(blocks.map((b) => [b.title, b.text])).toEqual([
      ['', 'Front.'],
      ['One', 'One a.\n\nOne b.'],
      ['Two', 'Two.'],
    ]);
  });

  test('two marks on one page keep only the first, so no block is empty', () => {
    const blocks = blocksFromOutline(pages, [
      { title: 'Part I', page: 1, group: 'Part I' },
      { title: 'Chapter 1', page: 1, group: 'Part I' },
      { title: 'Chapter 2', page: 3, group: 'Part I' },
    ]);
    expect(blocks.map((b) => b.title)).toEqual(['', 'Part I', 'Chapter 2']);
  });

  test('marks out of page order are sorted', () => {
    const blocks = blocksFromOutline(pages, [
      { title: 'Two', page: 3, group: 'Two' },
      { title: 'One', page: 1, group: 'One' },
    ]);
    expect(blocks.map((b) => b.title)).toEqual(['', 'One', 'Two']);
  });
});

describe('linesFromRuns', () => {
  const run = (text: string, x: number, y: number) => ({ text, x, y, height: 10 });

  test('reads top to bottom whatever order the runs arrive in', () => {
    const lines = linesFromRuns([run('third', 50, 700), run('first', 50, 728), run('second', 50, 714)]);
    expect(lines.map((l) => l.text)).toEqual(['first', 'second', 'third']);
  });

  test('runs sharing a baseline are one line, left to right', () => {
    const lines = linesFromRuns([run('the market', 200, 701), run('Kelly sizes', 50, 700), run('Next line.', 50, 686)]);
    expect(lines.map((l) => l.text)).toEqual(['Kelly sizes the market', 'Next line.']);
  });

  test('Chinese runs join without a space', () => {
    expect(linesFromRuns([run('量化交易', 50, 700), run('的基础', 200, 700)]).map((l) => l.text)).toEqual(['量化交易的基础']);
  });

  test('a page with nothing on it has no lines', () => {
    expect(linesFromRuns([])).toEqual([]);
  });
});
