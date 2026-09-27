import type { ReactElement } from 'react';
import { fitAll, fitOf } from '@cairn/core/fit';
import type { Slide } from '@cairn/core/types';

type Props = Extract<Slide, { layout: 'timeline' }> & { readonly shown: number };

/** A dated or staged progression: unlike `flow`, the mark carries information. */
export function Timeline({ heading, items, shown }: Props): ReactElement {
  const markFit = fitAll(items.map((i) => i.mark), 'timelineMark');
  const textFit = fitAll(items.map((i) => i.text), 'timelineText');

  return (
    <div className="s">
      {heading && <h2 className="s-h2" data-fit={fitOf(heading, 'heading')}>{heading}</h2>}
      <ol className="s-tl">
        {items.map((item, i) => (
          <li key={`${item.mark}${item.text}`} className={`${i < shown ? 'in' : 'out'}${i + 1 < shown ? ' joined' : ''}`}>
            <span className="s-tl-mark" data-fit={markFit}>{item.mark}</span>
            <span className="s-tl-dot" aria-hidden="true" />
            <span className="s-tl-text" data-fit={textFit}>{item.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
