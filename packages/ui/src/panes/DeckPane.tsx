import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { toCaptions } from '@cairn/core/pipeline/caption';
import type { NodeDeck, PathNode } from '@cairn/core/types';
import { useNarration } from '../audio/useNarration';
import { SlideView } from '../slides/SlideView';
import { frameAt } from '../slides/frame';
import { BoostBadge } from './BoostBadge';
import { FastMark, FullscreenMark, PauseMark, PlayMark, VolumeMark } from './icons';
import { useUi } from '../settings/SettingsProvider';
import { useAutoHide } from './useAutoHide';
import type { Place } from './resume';
import { startAt } from './resume';
import { RATES, useTransport } from './useTransport';

/**
 * Centre pane: the deck plays itself while the narration reads.
 * Audio time is the single source of truth — the visible slide and the caption
 * are both derived from it, so they can never drift apart.
 */
/** Commit the playhead no more often than this: 32ms is below what an eye catches. */
const CLOCK_MS = 32;

export function DeckPane({
  node, deck, audioSrc, stageTitle, resumeAt, onSelect, onEnded, onProgress,
  build = 'pending', onRetry,
}: {
  node: PathNode;
  deck: NodeDeck | undefined;
  /** Why there is no deck: still being built, or it never will be. */
  build?: 'pending' | 'failed';
  /** Offered on a failed station. Absent outside the shell, where nothing can rebuild it. */
  onRetry?: () => Promise<void>;
  audioSrc: string;
  /** The path's own stage, shown in the slide's frame. Absent is fine. */
  stageTitle?: string;
  /**
   * Where the reader stopped last time. Applied once, to the station it names:
   * a resumed station opens paused at that second instead of playing from the
   * top, because being dropped into the middle of a sentence unannounced is
   * worse than pressing play.
   */
  resumeAt?: Place;
  onSelect: (text: string) => void;
  onEnded: () => void;
  /** Fires as the audio moves, so the caller can remember the position. */
  onProgress?: (ms: number) => void;
}): ReactElement {
  const { prefs, t } = useUi();
  const fit = useRef<HTMLDivElement>(null);
  const [ms, setMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [full, setFull] = useState(false);
  const chrome = useAutoHide();
  const [retrying, setRetrying] = useState(false);

  const audio = useNarration({
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded,
    onTime: (seconds) => {
      const now = Math.round(seconds * 1000);
      // Coarse, but the only ticker while paused or seeking; the frame loop
      // below owns the position during playback.
      if (!playing) setMs(now);
      onProgress?.(now);
    },
  });

  // The frame goes fullscreen through its centring wrapper, so the stage keeps
  // its 16:9 and letterboxes instead of stretching to the display's shape.
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void fit.current?.requestFullscreen?.();
  }, []);

  useEffect(() => {
    const onChange = (): void => setFull(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const transport = useTransport(audio, deck !== undefined, toggleFullscreen, prefs.rate);

  // Clause-level lines, derived from the sentence cues the deck already carries,
  // so a book generated before captions existed gets them without regenerating.
  const captions = useMemo(() => toCaptions(deck?.narration ?? []), [deck]);

  // Read through a ref so a changing resume point cannot re-trigger the effect
  // below: it is consumed once, on the station it belongs to.
  const pending = useRef(resumeAt);

  // Restart from the top whenever the station changes — and only then
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    // Wait for the deck: consuming the resume point before there is audio to
    // seek would spend it on nothing and start the station over.
    if (!deck) { el.pause(); return; }

    const resumeMs = startAt(pending.current, node.id, deck.durationMs);
    pending.current = undefined;
    setMs(resumeMs);

    // Resumed mid-station it opens paused — being dropped into the middle of a
    // sentence is worse than pressing play.
    void el.load(audioSrc, resumeMs / 1000, resumeMs === 0).catch(() => setPlaying(false));
  }, [node.id, deck, audioSrc, audio]);

  // The player is made after the transport's first state, so the reader's
  // stored speed and volume have to be written to it once it exists.
  const { apply } = transport;
  useEffect(apply, [apply, node.id, transport.rate, transport.volume, transport.muted]);

  /**
   * `timeupdate` fires about four times a second, so everything derived from it
   * arrived up to 250ms after the sound it belongs to — far past the ~45ms at
   * which a late picture is noticed. The position is read per frame instead,
   * committed at most every 32ms so the pane is not re-rendered 60 times a
   * second to move a step function.
   */
  useEffect(() => {
    const el = audio.current;
    if (!el || !playing) return undefined;

    let frame = 0;
    let last = 0;
    const tick = (now: number): void => {
      if (now - last >= CLOCK_MS) {
        last = now;
        setMs(Math.round(el.currentTime * 1000));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, deck, audio]);

  if (!deck) {
    // Pending is the ordinary case now: the path lands whole and the stations
    // fill in behind the reader, so arriving early at one is expected.
    return (
      <main className="pane deck-pane">
        <div className="deck-empty">
          {build === 'failed' ? t.deck.failed : t.deck.pending}
          {build === 'failed' && onRetry && (
            <button
              type="button"
              className="ghost"
              disabled={retrying}
              onClick={() => {
                setRetrying(true);
                void onRetry().finally(() => setRetrying(false));
              }}
            >
              {t.deck.retry}
            </button>
          )}
        </div>
      </main>
    );
  }

  // The same arithmetic the phone's slide page uses — see slides/frame.ts.
  const { slideIdx, slide, captionIdx: capIdx, caption, reveal } = frameAt(deck, captions, ms);

  // Clicking the slide is the transport. A deck plays like a video, so the frame
  // itself is the pause target; a 38px button below it was the wrong place to aim.
  const toggleFromStage = (): void => {
    // A drag that selects caption text ends in a click too — that is a quote, not a pause.
    if (window.getSelection()?.toString().trim()) return;
    transport.toggle();
  };

  const seek = (to: number): void => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, to) / 1000;
    setMs(Math.max(0, to));
  };

  return (
    <main className="pane deck-pane">
      <div className="deck-head">
        <span className="deck-kicker">{t.unit.nth(node.idx + 1)}</span>
        <span className="deck-title">{node.title}</span>
      </div>

      <div className="slide-stage-fit" ref={fit}>
        {/* The caption sits inside the frame, the way it would in a video: the
            deck is what is being watched, and a band below it pulled the eye
            off the slide every time the line changed. */}
        <div
          className={`slide-stage captioned${chrome.active || !playing || rateOpen ? ' chrome-up' : ''}`}
          onClick={toggleFromStage}
          onPointerMove={chrome.wake}
          onPointerLeave={chrome.leave}
          role="button"
          tabIndex={-1}
          aria-label={playing ? t.deck.pause : t.deck.play}
          title={t.deck.stageHint}
        >
          {slide && (
            <SlideView
              slide={slide}
              reveal={reveal}
              chrome={{
                stageTitle,
                stationNo: node.idx + 1,
                slideIdx,
                slideCount: deck.slides.length,
              }}
            />
          )}
          <div
            className="slide-caption"
            onMouseUp={() => {
              const picked = window.getSelection()?.toString().trim();
              if (picked) onSelect(picked);
            }}
          >
            {caption && <p key={capIdx}>{caption.text}</p>}
          </div>
          {/* Paused is the only state worth drawing: while it plays the slide
              should be the whole picture. pointer-events off so the click that
              resumes lands on the stage, not on the badge. */}
          {!playing && (
            <div className="stage-paused" aria-hidden="true">
              <span className="stage-paused-disc"><PlayMark size={38} /></span>
            </div>
          )}

          {transport.boost !== undefined && <BoostBadge rate={transport.boost} label={t.deck.boosting} />}

          <div className="stage-scrim" aria-hidden="true" />

          {/* The transport belongs to the frame, not to the pane: the deck plays
              like a video, so its controls live where a video's controls live —
              and the room they used to take below the stage goes to the slide. */}
          <div className="stage-controls" onClick={(e) => e.stopPropagation()}>
            {/* The line is drawn, and the range sits invisibly on top of it.
                A styled `::-webkit-slider-*` cannot thicken its track without
                also stretching its own thumb into an ellipse. */}
            <div
              className="scrub-slot"
              style={{ '--at': `${pct(ms, deck.durationMs)}%` } as CSSProperties}
              onPointerEnter={chrome.hold}
              onPointerLeave={chrome.wake}
            >
              <span className="scrub-rail" aria-hidden="true">
                <span className="scrub-fill" />
              </span>
              <span className="scrub-thumb" aria-hidden="true" />
              <input
                className="scrub-input" type="range" min={0} max={deck.durationMs} value={ms}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label={t.deck.progress}
              />
            </div>

            <div className="ctl-row" onPointerEnter={chrome.hold} onPointerLeave={chrome.wake}>
              <button
                type="button"
                className="ctl"
                onClick={transport.toggle}
                aria-label={playing ? t.deck.pause : t.deck.play}
                title={playing ? t.deck.pause : t.deck.play}
              >
                {playing ? <PauseMark size={26} /> : <PlayMark size={26} />}
              </button>

              {/* The slider keeps its width at all times, so showing it is a
                  fade rather than a reflow of everything to its right. */}
              <div className="vol">
                <button
                  type="button"
                  className="ctl"
                  onClick={transport.toggleMute}
                  aria-label={transport.muted ? t.deck.unmute : t.deck.mute}
                  title={transport.muted ? t.deck.unmute : t.deck.mute}
                >
                  <VolumeMark size={24} muted={transport.muted || transport.volume === 0} />
                </button>
                <input
                  className="volbar" type="range" min={0} max={1} step={0.01}
                  value={transport.muted ? 0 : transport.volume}
                  style={{ '--at': `${(transport.muted ? 0 : transport.volume) * 100}%` } as CSSProperties}
                  onChange={(e) => transport.setVolume(Number(e.target.value))}
                  aria-label={t.deck.volume}
                />
              </div>

              <span className="time">{fmt(ms)} / {fmt(deck.durationMs)}</span>
              <span className="ctl-grow" />

              <div className="rate-wrap">
                {rateOpen && (
                  <>
                    {/* Click anywhere else to dismiss, without trapping focus */}
                    <div className="rate-scrim" onClick={() => setRateOpen(false)} />
                    <div className="rate-menu" role="menu">
                      {RATES.map((r) => (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={r === transport.rate}
                          key={r}
                          className={r === transport.rate ? 'rate-item on' : 'rate-item'}
                          onClick={() => { transport.setRate(r); setRateOpen(false); }}
                        >
                          {r}×
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <button
                  type="button"
                  className={transport.boosting ? 'ctl wide boosting' : 'ctl wide'}
                  aria-haspopup="menu"
                  aria-expanded={rateOpen}
                  onClick={() => setRateOpen((v) => !v)}
                  title={t.deck.rate}
                >
                  {transport.boosting ? <FastMark size={18} /> : `${transport.rate}×`}
                </button>
              </div>

              <span className="ctl wide page">{slideIdx + 1} / {deck.slides.length}</span>

              <button
                type="button"
                className="ctl"
                onClick={toggleFullscreen}
                aria-label={full ? t.deck.exitFullscreen : t.deck.fullscreen}
                title={full ? t.deck.exitFullscreen : t.deck.fullscreen}
              >
                <FullscreenMark size={22} exit={full} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/** Where the playhead sits, as a percentage the scrub's own gradient reads. */
function pct(ms: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, (ms / total) * 100)) : 0;
}

function fmt(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
