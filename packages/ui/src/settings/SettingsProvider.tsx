import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Locale } from '../i18n/locale';
import { messagesFor } from '../i18n';
import type { Messages } from '../i18n/messages/en';
import {
  DEFAULT_PREFS, parseStored, type Prefs, TEXT_SCALE, withPref,
} from './prefs';

export interface UiSettings {
  readonly prefs: Prefs;
  readonly setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  /** The current locale's copy. Named `t` because every call site reads better for it. */
  readonly t: Messages;
  readonly locale: Locale;
}

const Ctx = createContext<UiSettings | undefined>(undefined);

/**
 * The reader's own settings, and the copy that follows from them.
 *
 * One provider rather than two: the locale *is* a preference, and splitting it
 * out would mean two contexts that must be kept in step by hand.
 *
 * Theme and text scale are written onto the document element rather than passed
 * down as props — `tokens.css` already keys off `data-theme`, and the slide
 * stage is rendered in several places that would each have to thread a class.
 */
export function SettingsProvider({
  children, storageKey = 'cairn.prefs',
}: {
  children: ReactNode;
  storageKey?: string;
}): ReactElement {
  // Lazy: this touches localStorage, and the first render needs the value
  const [prefs, setPrefs] = useState<Prefs>(() => read(storageKey));

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((current) => {
      const next = withPref(current, key, value);
      write(storageKey, next);
      return next;
    });
  }, [storageKey]);

  // `system` means "stamp nothing": tokens.css falls through to the media query,
  // and an explicit attribute would freeze the theme against the OS switching.
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', prefs.theme);
  }, [prefs.theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(TEXT_SCALE[prefs.textSize]));
  }, [prefs.textSize]);

  // Screen readers and the browser's own hyphenation read this, not our copy
  useEffect(() => {
    document.documentElement.lang = prefs.locale === 'zh' ? 'zh-CN' : 'en';
  }, [prefs.locale]);

  const value = useMemo<UiSettings>(
    () => ({ prefs, setPref, t: messagesFor(prefs.locale), locale: prefs.locale }),
    [prefs, setPref],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The copy for one locale, for a surface with no settings of its own — the
 * phone's slide page is told its locale by the app around it and stores nothing.
 */
export function FixedLocale({ locale, children }: { locale: Locale; children: ReactNode }): ReactElement {
  const value = useMemo<UiSettings>(
    () => ({ prefs: { ...DEFAULT_PREFS, locale }, setPref: () => undefined, t: messagesFor(locale), locale }),
    [locale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi(): UiSettings {
  const value = useContext(Ctx);
  if (!value) throw new Error('useUi must be used inside <SettingsProvider>');
  return value;
}

/** The common case: copy only. */
export function useT(): Messages {
  return useUi().t;
}

function read(key: string): Prefs {
  try {
    return parseStored(window.localStorage.getItem(key), DEFAULT_PREFS);
  } catch {
    return DEFAULT_PREFS;
  }
}

function write(key: string, prefs: Prefs): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // A reader whose choices cannot be stored can still make them this session
  }
}
