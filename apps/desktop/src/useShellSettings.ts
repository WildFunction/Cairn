import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT, type CloudPanel, type ShellPrefs, type ShellSettings, type VoiceOption } from '@cairn/ui';
import type { CloudSyncStatus } from '@cairn/core/sync/auto';
import {
  clearCache, cloudRemoveAll, cloudSetBook, cloudStatus, cloudSyncNow, dataDir, devBuild, getSettings, inShell,
  modelStatus, onCloudStatus, previewVoice, revealDataDir, setSettings,
} from './bridge';
import {
  DEFAULT_SHELL_SETTINGS, defaultApiKey, EMPTY_PROFILE, VOICES,
  type ContentLocale, type ModelStatus, type ProviderId, type ProviderProfile,
  type ShellSettingsValues,
} from './shared/settings';
import { OFFERED_PROVIDERS } from './shared/providers';
import { silentWav } from './silence';
import { useWereadAccount } from './useWereadAccount';

const SILENCE = silentWav();

/**
 * The half of the settings panel that only the main process can answer.
 *
 * Returns nothing outside the desktop shell, which is what makes those pages
 * say "needs the desktop app" instead of rendering controls that quietly do
 * nothing — `bun run dev` has no process to store a key or speak a voice.
 *
 * Writes are optimistic: the panel is a list of switches, and a switch that
 * waits for a file to be written before it moves feels broken. The stored value
 * comes back from the write and replaces the guess.
 */
export function useShellSettings(): ShellSettings | undefined {
  const t = useT();
  const [values, setValues] = useState<ShellSettingsValues>();
  const [dir, setDir] = useState('');
  const [dev, setDev] = useState(false);
  const [model, setModel] = useState<ModelStatus>();
  const [previewing, setPreviewing] = useState<ContentLocale>();
  const [cloudNow, setCloudNow] = useState<CloudSyncStatus>();

  // Asked once, then kept current by the main process as uploads move
  useEffect(() => {
    if (!inShell) return undefined;
    let live = true;
    void cloudStatus().then((status) => { if (live && status) setCloudNow(status); });
    const stop = onCloudStatus(setCloudNow);
    return () => { live = false; stop(); };
  }, []);

  /** One element reused for every audition, so two cannot overlap. */
  const audio = useRef<HTMLAudioElement | undefined>(undefined);
  const auditionId = useRef(0);

  useEffect(() => {
    if (!inShell) return;
    let live = true;
    void (async () => {
      const [stored, where, model, isDev] = await Promise.all([
        getSettings(), dataDir(), modelStatus(), devBuild(),
      ]);
      if (!live) return;
      setValues(stored ?? DEFAULT_SHELL_SETTINGS);
      setDir(where);
      setDev(isDev);
      setModel(model);
    })();
    return () => { live = false; };
  }, []);

  // Stopping playback when the panel closes is the element's own cleanup
  useEffect(() => () => audio.current?.pause(), []);

  /** Also drops a sample still being synthesised, so the old voice cannot start after a switch. */
  const stopPreview = useCallback(() => {
    auditionId.current++;
    audio.current?.pause();
    setPreviewing(undefined);
  }, []);

  /**
   * `ShellSettings` states provider ids as plain strings, because `packages/ui`
   * cannot see the union they are drawn from. Widening here is safe: the main
   * process re-validates through `parseSettings`, and an id it does not know
   * falls back rather than being stored.
   */
  const setPref = useCallback(<K extends keyof ShellPrefs>(
    key: K,
    value: ShellPrefs[K],
  ) => {
    if (key === 'voices') stopPreview();
    setValues((current) => (current ? { ...current, [key]: value } as ShellSettingsValues : current));
    void setSettings({ [key]: value } as Partial<ShellSettingsValues>)
      .then((stored) => {
        setValues(stored);
        // The model route is derived from these, so the panel's "in force" line
        // is stale the moment one of them changes.
        if (key === 'generationProvider' || key === 'providers') void modelStatus().then(setModel);
      })
      // A write that failed leaves the optimistic value on screen and the real
      // one on disk. Re-reading is the only way to stop lying about it.
      .catch(() => void getSettings().then((stored) => stored && setValues(stored)));
  }, [stopPreview]);

  /**
   * Patch one provider, merging over what is stored.
   *
   * A whole-field write would send the other providers back too — and the
   * renderer holds stand-ins, not keys, so that round trip is where a key gets
   * lost. `settings-store.ts` merges the other direction for the same reason.
   */
  const setProvider = useCallback((rawId: string, patch: Partial<ProviderProfile>) => {
    const id = rawId as ProviderId;
    setValues((current) => {
      if (!current) return current;
      const merged = { ...EMPTY_PROFILE, apiKey: defaultApiKey(id), ...current.providers[id], ...patch };
      const providers = { ...current.providers, [id]: merged };
      void setSettings({ providers: { [id]: merged } })
        .then((stored) => {
          setValues(stored);
          void modelStatus().then(setModel);
        })
        .catch(() => void getSettings().then((s) => s && setValues(s)));
      return { ...current, providers };
    });
  }, []);

  const voicesFor = useCallback((locale: ContentLocale): readonly VoiceOption[] => (
    VOICES[locale].map((voice) => ({
      id: voice.id,
      // The name is a proper noun and stays put; what it is gets translated
      label: [
        voice.name,
        t.settings.narration.voiceGender[voice.gender],
        t.settings.narration.voiceStyle[voice.style],
      ].join(' · '),
    }))
  ), [t]);

  const audition = useCallback((locale: ContentLocale) => {
    const element = (audio.current ??= new Audio());
    if (previewing === locale) {
      stopPreview();
      return;
    }
    const request = ++auditionId.current;
    setPreviewing(locale);
    // Synthesis takes one to three seconds, sometimes longer than WebKit keeps the
    // click's permission to play; a silent clip played now carries it over.
    // Cleared first: the clip ends in 10 ms, and the last audition's handler would reset the button mid-synthesis
    element.onended = null;
    element.src = SILENCE;
    element.play().catch((cause: unknown) => console.error('preview unlock', cause));
    void previewVoice(locale)
      .then((src) => {
        // A click or a voice switch while this was synthesising has made it stale
        if (request !== auditionId.current) return;
        element.src = src;
        element.onended = () => setPreviewing(undefined);
        return element.play();
      })
      // Synthesis can fail for the same reasons a book's can — no network, a
      // voice id this account cannot use.
      .catch((cause: unknown) => {
        console.error('preview', locale, cause);
        if (request === auditionId.current) setPreviewing(undefined);
      });
  }, [previewing, stopPreview]);

  const recheckModel = useCallback(() => {
    void modelStatus().then(setModel);
  }, []);

  // Signing in or out rewrites the key on disk; the panel's copy has to follow
  const reread = useCallback(() => {
    void getSettings().then((stored) => stored && setValues(stored));
  }, []);
  const weread = useWereadAccount(reread);

  const cloud = useMemo((): CloudPanel | undefined => (cloudNow ? {
    reach: cloudNow.reach,
    running: cloudNow.running,
    books: cloudNow.books,
    setBook: (bookId, on) => {
      // Optimistic, like every other switch here; the main process's status replaces the guess
      setCloudNow((now) => (now ? {
        ...now,
        books: now.books.map((book) => (book.id === bookId ? { ...book, state: on ? 'waiting' : 'off' } : book)),
      } : now));
      cloudSetBook(bookId, on);
    },
    syncNow: cloudSyncNow,
    removeAll: async () => { setValues(await cloudRemoveAll()); },
  } : undefined), [cloudNow]);

  return useMemo(() => {
    if (!inShell || !values) return undefined;
    return {
      prefs: values,
      setPref,
      setProvider,
      providers: OFFERED_PROVIDERS,
      voicesFor,
      recheckModel,
      ...(model ? { modelStatus: model } : {}),
      previewVoice: audition,
      previewing,
      dataDir: dir,
      devBuild: dev,
      revealDataDir: () => void revealDataDir(),
      clearCache,
      weread,
      ...(cloud ? { cloud } : {}),
    } satisfies ShellSettings;
  }, [values, setPref, setProvider, voicesFor, recheckModel, model, audition, previewing, dir, dev, weread, cloud]);
}
