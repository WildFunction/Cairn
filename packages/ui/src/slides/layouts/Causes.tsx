import type { ReactElement } from 'react';
import { fitAll, fitOf } from '@cairn/core/fit';
import type { CauseGroup, Slide } from '@cairn/core/types';
import { Aside } from './Aside';

type Props = Extract<Slide, { layout: 'causes' }> & { readonly shown: number };

export function Causes({ heading, effect, groups, focus, aside, shown }: Props): ReactElement {
  const nameFit = fitAll(groups.map((g) => g.name), 'causeGroup');
  const causeFit = fitAll(groups.flatMap((g) => g.causes), 'causeItem');
  const columns = Math.ceil(groups.length / 2);
  const pair = groups.length === 2;

  return (
    <div className={pair ? 's s-causes-pair' : 's'}>
      {heading && <h2 className="s-h2" data-fit={fitOf(heading, 'heading')}>{heading}</h2>}
      {pair ? (
        <div className="s-cm">
          <p className="s-cm-effect" data-fit={fitOf(effect, 'causeEffect')}>{effect}</p>
          <span className={`s-cm-fork ${shown > 2 ? 'all' : shown > 1 ? 'first' : 'out'}`} aria-hidden="true" />
          <ul className="s-cm-groups">
            {groups.map((group, i) => (
              <li key={group.name} className={`s-cm-group ${i + 1 < shown ? 'in' : 'out'}${i === focus ? ' hl' : ''}`}>
                <span className="s-cm-name" data-fit={nameFit}>{group.name}</span>
                <ul data-fit={causeFit}>
                  {group.causes.map((cause) => <li key={cause}>{cause}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="s-fb" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr)) 17cqw` }}>
          <span className={`s-fb-spine ${shown > 1 ? 'in' : 'out'}`} aria-hidden="true" />
          {groups.map((group, i) => (
            <Bone
              key={group.name}
              group={group}
              above={i % 2 === 0}
              column={Math.floor(i / 2) + 1}
              className={`${i + 1 < shown ? 'in' : 'out'}${i === focus ? ' hl' : ''}`}
              nameFit={nameFit}
              causeFit={causeFit}
            />
          ))}
          <p className="s-fb-effect" style={{ gridColumn: columns + 1 }} data-fit={fitOf(effect, 'causeEffect')}>
            {effect}
          </p>
        </div>
      )}
      <Aside text={aside} shown={shown > groups.length} />
    </div>
  );
}

function Bone({ group, above, column, className, nameFit, causeFit }: {
  group: CauseGroup;
  above: boolean;
  column: number;
  className: string;
  nameFit: number;
  causeFit: number;
}): ReactElement {
  return (
    <div
      className={`s-fb-group ${above ? 'above' : 'below'} ${className}`}
      style={{ gridColumn: column, gridRow: above ? 1 : 2 }}
    >
      <div className="s-fb-words">
        <span className="s-fb-name" data-fit={nameFit}>{group.name}</span>
        <ul data-fit={causeFit}>
          {group.causes.map((cause) => <li key={cause} className="s-fb-cause">{cause}</li>)}
        </ul>
      </div>
      <span className="s-fb-bone" aria-hidden="true" />
    </div>
  );
}
