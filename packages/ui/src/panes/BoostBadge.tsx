import type { CSSProperties, ReactElement } from 'react';
import { HOLD_RATES } from './useTransport';

/**
 * Shown while → is held. The tiers sit on a wheel with the current one centred
 * and its neighbours cut by the badge's edge, which is what says ↑ / ↓ reach them.
 */
export function BoostBadge({ rate, label }: { rate: number; label: string }): ReactElement {
  const at = HOLD_RATES.indexOf(rate as (typeof HOLD_RATES)[number]);
  return (
    <div className="stage-boost" role="status" aria-label={`${label} ${rate}×`}>
      <span className="stage-boost-marks" aria-hidden="true"><i /><i /><i /></span>
      <span aria-hidden="true">{label}</span>
      <span className="stage-boost-wheel" aria-hidden="true">
        <span className="stage-boost-rates" style={{ '--at': at } as CSSProperties}>
          {HOLD_RATES.map((r) => (
            <span key={r} className={r === rate ? 'on' : undefined}>{r}×</span>
          ))}
        </span>
      </span>
    </div>
  );
}
