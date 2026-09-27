import type { ReactElement } from 'react';
import { fitAll, fitOf } from '@cairn/core/fit';
import type { Slide } from '@cairn/core/types';
import { Aside } from './Aside';

type Props = Extract<Slide, { layout: 'flow' }> & { readonly shown: number };

/**
 * A causal chain, as a column that never wraps. The chain steps down one size
 * together so a long step cannot wrap a node into two lines. See DESIGN.md.
 */
export function Flow({ heading, steps, aside, shown }: Props): ReactElement {
  return (
    <div className="s">
      {heading && <h2 className="s-h2" data-fit={fitOf(heading, 'heading')}>{heading}</h2>}
      <ol className="s-flow" data-fit={fitAll(steps, 'step')}>
        {steps.map((step, i) => (
          <li key={step} className={i < shown ? 'in' : 'out'}>
            <span className="s-node">
              <i className="s-node-i" aria-hidden="true" />
              <span className="s-node-t">{step}</span>
            </span>
            {i < steps.length - 1 && (
              <span className={`s-link ${i + 1 < shown ? 'in' : 'out'}`} aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>
      <Aside text={aside} shown={shown >= steps.length} />
    </div>
  );
}
