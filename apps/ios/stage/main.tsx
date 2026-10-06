/**
 * The slide, as a page the iOS app shows in a web view. It draws one station
 * with the desktop's own renderers and is driven entirely through `window.cairn`
 * (see bridge.ts); controls, gestures and sound are the app's.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { toCaptions } from '@cairn/core/pipeline/caption';
import { FixedLocale } from '../../../packages/ui/src/settings/SettingsProvider';
import { frameAt } from '../../../packages/ui/src/slides/frame';
import { SlideView } from '../../../packages/ui/src/slides/SlideView';
import { type Bridge, clockAt, createBridge, type Outgoing } from './bridge';
import './stage.css';

/** Commit the playhead no more often than this, as the desktop does. */
const CLOCK_MS = 32;

declare global {
  interface Window {
    cairn?: Bridge['api'];
    webkit?: { messageHandlers?: { cairn?: { postMessage: (message: Outgoing) => void } } };
  }
}

const post = (message: Outgoing): void => window.webkit?.messageHandlers?.cairn?.postMessage(message);
const bridge = createBridge(post, () => performance.now());

function Stage(): ReactElement {
  const { station, anchor, prefs } = useSyncExternalStore(bridge.subscribe, bridge.getState);
  const deck = station?.deck;
  const [ms, setMs] = useState(0);
  const captions = useMemo(() => toCaptions(deck?.narration ?? []), [deck]);

  // The sound is the only clock. Between two syncs the page carries it forward and redraws per frame.
  useEffect(() => {
    const duration = deck?.durationMs ?? 0;
    setMs(Math.round(clockAt(anchor, performance.now(), duration)));
    if (!anchor.playing) return undefined;

    let frame = 0;
    let last = 0;
    const tick = (now: number): void => {
      if (now - last >= CLOCK_MS) {
        last = now;
        setMs(Math.round(clockAt(anchor, performance.now(), duration)));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [anchor, deck]);

  if (!station || !deck) return <div className="slide-stage" />;

  const frame = frameAt(deck, captions, ms);
  const classes = [
    'slide-stage',
    prefs.captions ? 'captioned' : '',
    prefs.captionScale > 1 ? 'scaled' : '',
    prefs.lifted ? 'lifted' : '',
  ].filter(Boolean).join(' ');

  return (
    <FixedLocale locale={station.locale}>
      <div className={classes} style={{ '--text-scale': prefs.captionScale } as CSSProperties}>
        {frame.slide && (
          <SlideView
            slide={frame.slide}
            reveal={frame.reveal}
            chrome={{
              stageTitle: station.stageTitle,
              stationNo: station.stationNo,
              slideIdx: frame.slideIdx,
              slideCount: deck.slides.length,
            }}
          />
        )}
        {prefs.captions && (
          <div className="slide-caption">
            {frame.caption && <p key={frame.captionIdx}>{frame.caption.text}</p>}
          </div>
        )}
      </div>
    </FixedLocale>
  );
}

window.addEventListener('error', (event) => post({ type: 'error', message: event.message }));

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<Stage />);
  window.cairn = bridge.api;
  post({ type: 'ready' });
}
