import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import type { Messages } from '../i18n/messages/en';
import { LOCALES, type Locale } from '../i18n/locale';
import { Link } from '../Link';
import { useUi } from './SettingsProvider';
import { TEXT_SIZES, THEMES, type TextSize, type ThemeChoice } from './prefs';
import type { NarrationLanguage, ShellSettings } from './shell';
import { Offline, Row, SecretField, Section, Segmented, Select, StackedRow, Switch } from './rows';

const LOCALE_LABEL: Readonly<Record<Locale, string>> = {
  en: 'English (US)',
  // Its own name in its own script: a language list nobody can read is useless
  zh: '简体中文',
};

export function GeneralPage(): ReactElement {
  const { prefs, setPref, t } = useUi();
  const languageId = useId();

  const themes: readonly { value: ThemeChoice; label: string }[] = [
    { value: 'light', label: t.settings.general.themeLight },
    { value: 'dark', label: t.settings.general.themeDark },
    { value: 'system', label: t.settings.general.themeSystem },
  ];

  return (
    <Section title={t.settings.pages.general}>
      <Row
        label={t.settings.general.language}
        hint={t.settings.general.languageHint}
        htmlFor={languageId}
      >
        <Select
          id={languageId}
          value={prefs.locale}
          choices={LOCALES.map((l) => ({ value: l, label: LOCALE_LABEL[l] }))}
          onPick={(value) => setPref('locale', value)}
        />
      </Row>

      <Row label={t.settings.general.theme}>
        <Segmented
          value={prefs.theme}
          choices={THEMES.map((value) => themes.find((x) => x.value === value)!)}
          onPick={(value) => setPref('theme', value)}
          label={t.settings.general.theme}
        />
      </Row>
    </Section>
  );
}

export function AppearancePage(): ReactElement {
  const { prefs, setPref, t } = useUi();

  const sizes: Readonly<Record<TextSize, string>> = {
    s: t.settings.appearance.sizeS,
    m: t.settings.appearance.sizeM,
    l: t.settings.appearance.sizeL,
    xl: t.settings.appearance.sizeXL,
  };

  return (
    <Section title={t.settings.pages.appearance}>
      <StackedRow
        label={t.settings.appearance.slideText}
        hint={t.settings.appearance.slideTextHint}
        aside={(
          <Segmented
            value={prefs.textSize}
            choices={TEXT_SIZES.map((value) => ({ value, label: sizes[value] }))}
            onPick={(value) => setPref('textSize', value)}
            label={t.settings.appearance.slideText}
          />
        )}
      >
        {/* The sample is the control's own feedback: a size picker with nothing
            to look at makes the reader close the panel to see what they did. */}
        <p className="set-sample">
          {t.settings.appearance.sample}
          <span className="set-sample-cue">{t.settings.appearance.sampleCue}</span>
        </p>
      </StackedRow>
    </Section>
  );
}

export function PlaybackPage(): ReactElement {
  const { prefs, setPref, t } = useUi();
  const autoId = useId();
  const resumeId = useId();

  return (
    <Section title={t.settings.pages.playback}>
      <Row label={t.settings.playback.autoNext} hint={t.settings.playback.autoNextHint}>
        <Switch
          id={autoId}
          checked={prefs.autoNext}
          onChange={(next) => setPref('autoNext', next)}
          label={t.settings.playback.autoNext}
        />
      </Row>

      <Row label={t.settings.playback.resume} hint={t.settings.playback.resumeHint}>
        <Switch
          id={resumeId}
          checked={prefs.resume}
          onChange={(next) => setPref('resume', next)}
          label={t.settings.playback.resume}
        />
      </Row>
    </Section>
  );
}

export function NarrationPage({ shell }: { shell?: ShellSettings }): ReactElement {
  const { t } = useUi();
  const languageId = useId();

  if (!shell) return <Offline title={t.settings.pages.narration} />;

  const languages: readonly { value: NarrationLanguage; label: string }[] = [
    { value: 'follow', label: t.settings.narration.followBook },
    { value: 'en', label: t.settings.narration.alwaysEn },
    { value: 'zh', label: t.settings.narration.alwaysZh },
  ];

  return (
    <Section title={t.settings.pages.narration}>
      <Row
        label={t.settings.narration.language}
        htmlFor={languageId}
      >
        <Select
          id={languageId}
          value={shell.prefs.narration}
          choices={languages}
          onPick={(value) => shell.setPref('narration', value)}
        />
      </Row>

      {/* Both voices are always shown: with "follow the book" chosen, which
          one a given book uses is decided by the book, not here. */}
      <VoiceRow shell={shell} locale="en" />
      <VoiceRow shell={shell} locale="zh" />
    </Section>
  );
}

function VoiceRow({ shell, locale }: { shell: ShellSettings; locale: Locale }): ReactElement {
  const { t } = useUi();
  const id = useId();
  const options = shell.voicesFor(locale);
  const playing = shell.previewing === locale;

  return (
    <Row
      label={locale === 'en' ? t.settings.narration.voiceEn : t.settings.narration.voiceZh}
      htmlFor={id}
    >
      <span className="set-voice">
        <Select
          id={id}
          value={shell.prefs.voices[locale]}
          choices={options.map((v) => ({ value: v.id, label: v.label }))}
          onPick={(value) => shell.setPref('voices', { ...shell.prefs.voices, [locale]: value })}
        />
        <button
          type="button"
          className={playing ? 'set-btn busy' : 'set-btn'}
          onClick={() => shell.previewVoice(locale)}
        >
          {playing ? t.settings.narration.stop : t.settings.narration.preview}
        </button>
      </span>
    </Row>
  );
}

type KeyedService = 'brave' | 'firecrawl' | 'tavily';

const SEARCH_KEY_URL: Readonly<Record<KeyedService, string>> = {
  brave: 'https://api-dashboard.search.brave.com/app/keys',
  firecrawl: 'https://www.firecrawl.dev/app/api-keys',
  tavily: 'https://app.tavily.com/home',
};

export function SearchPage({ shell }: { shell?: ShellSettings }): ReactElement {
  const { t } = useUi();
  const providerId = useId();

  if (!shell) return <Offline title={t.settings.pages.search} />;

  return (
    <Section title={t.settings.pages.search}>
      <Row label={t.settings.search.searchProvider} hint={t.settings.search.searchProviderHint} htmlFor={providerId}>
        <Select
          id={providerId}
          value={shell.prefs.searchProvider}
          choices={[
            { value: 'brave', label: t.settings.search.braveProvider },
            { value: 'firecrawl', label: t.settings.search.firecrawlProvider },
            { value: 'tavily', label: t.settings.search.tavilyProvider },
          ]}
          onPick={(value) => shell.setPref('searchProvider', value)}
        />
      </Row>
      <SearchKeyRow
        shell={shell}
        which="brave"
        label={t.settings.search.brave}
        hint={t.settings.search.braveHint}
      />
      <SearchKeyRow
        shell={shell}
        which="firecrawl"
        label={t.settings.search.firecrawl}
        hint={t.settings.search.firecrawlHint}
      />
      <SearchKeyRow
        shell={shell}
        which="tavily"
        label={t.settings.search.tavily}
        hint={t.settings.search.tavilyHint}
      />
    </Section>
  );
}

function SearchKeyRow({ shell, which, label, hint }: {
  shell: ShellSettings;
  which: KeyedService;
  label: string;
  hint: string;
}): ReactElement {
  const { t } = useUi();
  const id = useId();
  const field = `${which}Key` as const;

  return (
    <StackedRow
      label={label}
      hint={hint}
      htmlFor={id}
      aside={(
        <Link className="set-link" href={SEARCH_KEY_URL[which]}>
          {t.settings.search.getKey}
        </Link>
      )}
    >
      <SecretField
        id={id}
        value={shell.prefs[field]}
        onChange={(value) => shell.setPref(field, value)}
        showLabel={t.settings.search.showKey}
        hideLabel={t.settings.search.hideKey}
      />
    </StackedRow>
  );
}

export function DataPage({ shell }: { shell?: ShellSettings }): ReactElement {
  const { t } = useUi();
  /** Irreversible and one click away, so it takes two — as deleting a book does. */
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const traceId = useId();

  if (!shell) return <Offline title={t.settings.pages.data} />;

  const clear = async (): Promise<void> => {
    setBusy(true);
    try {
      await shell.clearCache();
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t.settings.pages.data}>
      <Row
        label={t.settings.data.location}
        hint={<code className="set-path">{shell.dataDir}</code>}
      >
        <button type="button" className="set-btn" onClick={shell.revealDataDir}>
          {t.settings.data.reveal}
        </button>
      </Row>

      {/* A trace is the book's own text written down a second time, so it lives
          beside the data directory rather than among the keys. */}
      {shell.devBuild && (
        <Row label={t.settings.data.trace} hint={<span className="set-hint warn">{t.settings.data.traceHint}</span>}>
          <Switch
            id={traceId}
            checked={shell.prefs.trace}
            onChange={(next) => shell.setPref('trace', next)}
            label={t.settings.data.trace}
          />
        </Row>
      )}

      <Row label={t.settings.data.cache} hint={t.settings.data.cacheHint}>
        {confirming ? (
          <span className="set-confirm">
            <span className="set-hint">{t.settings.data.confirm}</span>
            <button type="button" className="set-btn danger" disabled={busy} onClick={() => void clear()}>
              {busy ? t.settings.data.clearing : t.settings.data.confirmYes}
            </button>
            <button type="button" className="set-btn" disabled={busy} onClick={() => setConfirming(false)}>
              {t.settings.data.confirmNo}
            </button>
          </span>
        ) : (
          <button type="button" className="set-btn danger" onClick={() => setConfirming(true)}>
            {t.settings.data.clear}
          </button>
        )}
      </Row>
    </Section>
  );
}

/** What a page shows when there is no main process behind it (`bun run dev`). */
