import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

/** A book's cover, then its fallback, then its title set on a plain board when neither loads. */
export function Cover({ src, fallback, title }: {
  src?: string | undefined;
  fallback?: string | undefined;
  title: string;
}): ReactElement {
  const [failed, setFailed] = useState(0);
  const current = [src, fallback].filter(Boolean)[failed];
  if (current) {
    return <img className="shelf-cover" src={current} alt="" loading="lazy" onError={() => setFailed((n) => n + 1)} />;
  }
  return (
    <span className="shelf-cover blank" aria-hidden="true">
      <span>{title}</span>
    </span>
  );
}

/** The whole card is the button; `extra` sits over it, for the delete control. */
export function ShelfCard({
  cover, coverFallback, title, meta, intro, onOpen, extra,
}: {
  cover?: string | undefined;
  coverFallback?: string | undefined;
  title: string;
  meta?: ReactNode;
  intro?: string | undefined;
  onOpen: () => void;
  extra?: ReactNode;
}): ReactElement {
  return (
    <div className="shelf-card">
      <button type="button" className="shelf-item" onClick={onOpen}>
        <Cover src={cover} fallback={coverFallback} title={title} />
        <span className="shelf-text">
          <span className="shelf-name">{title}</span>
          {meta && <span className="shelf-meta">{meta}</span>}
          {intro && <span className="shelf-intro">{intro}</span>}
        </span>
      </button>
      {extra}
    </div>
  );
}
