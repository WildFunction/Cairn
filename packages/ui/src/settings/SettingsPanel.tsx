import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useUi } from './SettingsProvider';
import { ModelsPage } from './ModelsPage';
import {
  AppearancePage, DataPage, GeneralPage, NarrationPage, PlaybackPage, SearchPage,
} from './pages';
import { WereadPage } from './WereadPage';
import type { ShellSettings } from './shell';
import {
  BookMark, CacheMark, GearMark, ModelMark, PaletteMark, PlaybackMark, SearchMark, WaveMark,
} from './icons';

export const SETTINGS_TABS = [
  'general', 'appearance', 'playback', 'models', 'narration', 'weread', 'search', 'data',
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

type Group = 'app' | 'reading' | 'generation';

const PAGES: readonly {
  readonly tab: SettingsTab;
  readonly group: Group;
  readonly Icon: () => ReactElement;
}[] = [
  { tab: 'general', group: 'app', Icon: GearMark },
  { tab: 'appearance', group: 'app', Icon: PaletteMark },
  { tab: 'playback', group: 'reading', Icon: PlaybackMark },
  { tab: 'models', group: 'generation', Icon: ModelMark },
  { tab: 'narration', group: 'reading', Icon: WaveMark },
  { tab: 'weread', group: 'reading', Icon: BookMark },
  { tab: 'search', group: 'generation', Icon: SearchMark },
  { tab: 'data', group: 'generation', Icon: CacheMark },
];

const GROUPS: readonly Group[] = ['app', 'reading', 'generation'];

/**
 * Settings: a left column of pages, a right column of rows.
 *
 * Two columns rather than one long scroll because the list will grow — the
 * sections here are already six, and a single stream becomes a tunnel well
 * before that. The groups are Cairn's own (app / reading / generation) rather
 * than borrowed wholesale: "Agent" and "Connections" name nothing in this app.
 *
 * Everything a native dialog gives away for free has to be rebuilt: Escape,
 * click-outside, arrow keys, focus return. `BookMenu` already pays this price
 * once and this follows the same shape deliberately, so there is one way to
 * dismiss a layer in this app rather than two.
 */
export function SettingsPanel({
  onClose, shell, initialTab = 'general',
}: {
  onClose: () => void;
  /** Absent outside the desktop shell; those pages say so rather than lying. */
  shell?: ShellSettings;
  initialTab?: SettingsTab;
}): ReactElement {
  const { t } = useUi();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  /** Where focus came from, so Escape can put it back. */
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    // Focus the panel itself rather than its first control: landing on the
    // language select means an arrow key changes the language by accident.
    panel.current?.focus();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);

  const tabsRef = useRef(tab);
  tabsRef.current = tab;

  const step = useCallback((delta: number) => {
    const at = SETTINGS_TABS.indexOf(tabsRef.current);
    const next = SETTINGS_TABS[(at + delta + SETTINGS_TABS.length) % SETTINGS_TABS.length];
    if (next) setTab(next);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      // Only when the nav has focus: inside a page these keys belong to the
      // control the reader is actually on.
      if (!(e.target instanceof HTMLElement) || !e.target.classList.contains('set-nav-item')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, step]);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="set-panel"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <nav className="set-nav" aria-label={t.settings.title}>
          <div className="set-nav-title" id={titleId}>{t.settings.title}</div>

          {GROUPS.map((group) => (
            <div key={group} className="set-nav-group">
              <div className="set-nav-group-label">{t.settings.groups[group]}</div>
              {PAGES.filter((p) => p.group === group).map(({ tab: value, Icon }) => (
                <button
                  key={value}
                  type="button"
                  className="set-nav-item"
                  aria-current={value === tab ? 'page' : undefined}
                  onClick={() => setTab(value)}
                >
                  <Icon />
                  {t.settings.pages[value]}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="set-body">
          <header className="set-head">
            <div className="set-title">{t.settings.pages[tab]}</div>
            <button type="button" className="set-x" aria-label={t.settings.close} onClick={onClose}>
              <CloseMark />
            </button>
          </header>

          <div className="set-scroll">
            {tab === 'general' && <GeneralPage />}
            {tab === 'appearance' && <AppearancePage />}
            {tab === 'playback' && <PlaybackPage />}
            {tab === 'models' && <ModelsPage shell={shell} />}
            {tab === 'narration' && <NarrationPage shell={shell} />}
            {tab === 'search' && <SearchPage shell={shell} />}
            {tab === 'weread' && <WereadPage shell={shell} />}
            {tab === 'data' && <DataPage shell={shell} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function CloseMark(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
