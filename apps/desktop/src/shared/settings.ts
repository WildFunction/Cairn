/**
 * The settings the main process owns, and the voices it can speak with.
 *
 * Shared by both sides of the bridge, and deliberately free of React and of
 * `node:*` — the main process validates what it reads off disk with the same
 * code the player uses to type what it sends.
 *
 * The *renderer's* own settings (language, theme, text size, speed) are not
 * here: they never leave the webview, and `packages/ui/src/settings/prefs.ts`
 * holds them.
 */
import { DEFAULT_VOICES } from '@cairn/core/pipeline/voice';
import { defaultModelOf, PROVIDER_IDS, providerById, type ProviderId } from './providers';

export { PROVIDER_IDS, type ProviderId } from './providers';

export const CONTENT_LOCALES = ['en', 'zh'] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

/**
 * The language the *interface* is in.
 *
 * The same two values as `ContentLocale` today, and deliberately a separate
 * type anyway: one is a property of a book and the other is a choice the reader
 * made, and the moment they are the same type someone will pass one where the
 * other belongs. That is the bug this whole split exists to prevent.
 */
export type UiLocale = 'en' | 'zh';

/** `follow` reads a book in the language the book is written in. */
export type NarrationLanguage = 'follow' | ContentLocale;

export interface VoiceSpec {
  /** What edge-tts is invoked with. */
  readonly id: string;
  /** A proper noun — never translated. */
  readonly name: string;
  readonly gender: 'male' | 'female';
  readonly style: 'narration' | 'warm' | 'casual' | 'youth';
}

/**
 * A short, opinionated list rather than everything `edge-tts --list-voices`
 * prints: that is several hundred entries, most of them other languages, and a
 * picker nobody can get to the end of is not a choice.
 *
 * Every id below was checked against `edge-tts --list-voices`. A wrong one
 * fails loudly at synthesis rather than silently, and the engine row in the
 * settings panel is where that surfaces.
 */
export const VOICES: Readonly<Record<ContentLocale, readonly VoiceSpec[]>> = {
  en: [
    { id: 'en-US-AndrewNeural', name: 'Andrew', gender: 'male', style: 'narration' },
    { id: 'en-US-AvaNeural', name: 'Ava', gender: 'female', style: 'warm' },
    { id: 'en-US-BrianNeural', name: 'Brian', gender: 'male', style: 'casual' },
    { id: 'en-US-EmmaNeural', name: 'Emma', gender: 'female', style: 'casual' },
    { id: 'en-GB-RyanNeural', name: 'Ryan', gender: 'male', style: 'narration' },
  ],
  zh: [
    { id: 'zh-CN-YunjianNeural', name: '云健', gender: 'male', style: 'narration' },
    { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', gender: 'female', style: 'warm' },
    { id: 'zh-CN-YunxiNeural', name: '云希', gender: 'male', style: 'youth' },
    { id: 'zh-CN-XiaoyiNeural', name: '晓伊', gender: 'female', style: 'casual' },
    { id: 'zh-CN-YunyangNeural', name: '云扬', gender: 'male', style: 'narration' },
  ],
};

/**
 * One provider's credentials, keyed by `ProviderId`.
 *
 * Each field's empty string is a deliberate deferral rather than a missing value:
 * no key means read the environment, no base URL means the catalog's, no model
 * means this provider's default. That keeps a half-filled panel working and
 * keeps the stored file free of values nobody chose.
 */
export interface ProviderProfile {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
}

export type ProviderProfiles = Readonly<Partial<Record<ProviderId, ProviderProfile>>>;

export const EMPTY_PROFILE: ProviderProfile = { apiKey: '', baseUrl: '', model: '' };

/**
 * A key field holding `$NAME` reads that environment variable; anything else is
 * the key itself, and empty is no key. The fields start out as `$NAME`, so the
 * default is visible in the field rather than explained beside it.
 */
const ENV_REF = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;

export const envRef = (name: string): string => `$${name}`;

export function envNameOf(value: string): string | undefined {
  return ENV_REF.exec(value.trim())?.[1];
}

export function resolveSecret(
  value: string, env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const name = envNameOf(value);
  return (name ? env[name]?.trim() : value.trim()) || undefined;
}

/** A vendor's key before the reader has typed one: its environment variable, if pi-ai names one. */
export function defaultApiKey(id: ProviderId): string {
  const name = providerById(id)?.envKey;
  return name ? envRef(name) : '';
}

export const KEY_ENV = {
  braveKey: 'BRAVE_SEARCH_API_KEY',
  firecrawlKey: 'FIRECRAWL_API_KEY',
  tavilyKey: 'TAVILY_API_KEY',
  wereadKey: 'WEREAD_API_KEY',
} as const;

type KeyField = keyof typeof KEY_ENV;
const KEY_FIELDS = Object.keys(KEY_ENV) as KeyField[];

/** `inherit` puts the companion on whatever generation uses. */
export type ChatProvider = ProviderId | 'inherit';

export interface ModelStatus {
  /** Which route is in force. */
  readonly provider: ProviderId;
  /** False means generation will fail until the reader fixes something. */
  readonly ready: boolean;
  /** The endpoint, the model, or why it is not ready. Shown verbatim. */
  readonly detail: string;
}

export interface ShellSettingsValues {
  readonly providers: ProviderProfiles;
  readonly generationProvider: ProviderId;
  readonly chatProvider: ChatProvider;
  readonly narration: NarrationLanguage;
  readonly voices: Readonly<Record<ContentLocale, string>>;
  readonly searchProvider: 'brave' | 'firecrawl' | 'tavily';
  /** Each is a key, a `$NAME` reference, or empty for none. See `resolveSecret`. */
  readonly braveKey: string;
  readonly firecrawlKey: string;
  readonly tavilyKey: string;
  readonly wereadKey: string;
  /** Whose WeChat Reading account the key came from, when a QR login stored it. Display only. */
  readonly wereadAccount: string;
  readonly trace: boolean;
}

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export const DEFAULT_SHELL_SETTINGS: ShellSettingsValues = {
  // Nothing configured: `resolveProvider` reports not ready until a key or a codex login exists.
  providers: {},
  generationProvider: 'openai',
  chatProvider: 'inherit',
  narration: 'follow',
  // From `pipeline/voice.ts`, not a second copy: the terminal path has no
  // settings file and falls back to those, and two lists would drift.
  voices: { en: DEFAULT_VOICES.en, zh: DEFAULT_VOICES.zh },
  searchProvider: 'firecrawl',
  braveKey: envRef(KEY_ENV.braveKey),
  firecrawlKey: envRef(KEY_ENV.firecrawlKey),
  tavilyKey: envRef(KEY_ENV.tavilyKey),
  wereadKey: envRef(KEY_ENV.wereadKey),
  wereadAccount: '',
  trace: false,
};

function known(locale: ContentLocale, id: unknown): string | undefined {
  return typeof id === 'string' && VOICES[locale].some((v) => v.id === id) ? id : undefined;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

function profileOf(value: unknown): ProviderProfile | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Partial<Record<keyof ProviderProfile, unknown>>;
  return { apiKey: str(raw.apiKey), baseUrl: str(raw.baseUrl), model: str(raw.model) };
}

function parseProfiles(value: unknown): ProviderProfiles {
  if (typeof value !== 'object' || value === null) return {};
  const raw = value as Record<string, unknown>;
  const out: Partial<Record<ProviderId, ProviderProfile>> = {};
  for (const [id, profile] of Object.entries(raw)) {
    if (!isProviderId(id)) continue;
    const parsed = profileOf(profile);
    if (parsed) out[id] = parsed;
  }
  return out;
}

/**
 * Fold a pre-registry settings file into the provider shape.
 *
 * The old file had one generation route (`model.source`, `'codex' | 'key'`) and a
 * separate chat one naming a vendor. Both carried a key that must survive: losing
 * it would look like the panel silently forgetting what the reader typed.
 */
function migrate(raw: Record<string, unknown>): Partial<ShellSettingsValues> {
  const model = (typeof raw.model === 'object' && raw.model !== null ? raw.model : undefined) as
    Record<string, unknown> | undefined;
  const chat = (typeof raw.chatModel === 'object' && raw.chatModel !== null ? raw.chatModel : undefined) as
    Record<string, unknown> | undefined;
  if (!model && !chat) return {};

  const providers: Partial<Record<ProviderId, ProviderProfile>> = {};
  let generationProvider: ProviderId | undefined;

  if (model) {
    const baseUrl = str(model.baseUrl).trim();
    // A base URL that is not OpenAI's was, by definition, a custom endpoint —
    // there was no other way to name one.
    const id: ProviderId = baseUrl && baseUrl !== DEFAULT_OPENAI_BASE_URL ? 'custom' : 'openai';
    const profile = { apiKey: str(model.apiKey), baseUrl, model: str(model.model) };
    // An all-empty profile is a value nobody chose; leaving it out keeps the
    // stored file to what the reader actually set.
    if (model.source === 'key' && Object.values(profile).some(Boolean)) {
      providers[id] = profile;
      generationProvider = id;
    }
  }

  let chatProvider: ChatProvider | undefined;
  if (chat && isProviderId(chat.source)) {
    const id = chat.source;
    providers[id] = {
      apiKey: str(chat.apiKey),
      baseUrl: '',
      model: str(chat.model),
      // A profile written by the generation branch above wins on base URL only
      ...(providers[id]?.baseUrl ? { baseUrl: providers[id]!.baseUrl } : {}),
    };
    chatProvider = id;
  } else if (chat?.source === 'inherit') {
    chatProvider = 'inherit';
  }

  return {
    ...(Object.keys(providers).length > 0 ? { providers } : {}),
    ...(generationProvider ? { generationProvider } : {}),
    ...(chatProvider ? { chatProvider } : {}),
  };
}

/**
 * Validate a settings record read off disk.
 *
 * Untrusted for the same reason the renderer's is: an older build wrote it, and
 * a voice id that no longer exists would fail at synthesis — after a model call
 * has already been paid for. `defaultBudget` is read and dropped: the budget is
 * chosen when a book is added, and a second copy here only went stale.
 */
export function parseSettings(
  value: unknown,
  fallback: ShellSettingsValues = DEFAULT_SHELL_SETTINGS,
): ShellSettingsValues {
  if (typeof value !== 'object' || value === null) return fallback;
  const raw = value as Record<string, unknown>;
  const voices = (typeof raw.voices === 'object' && raw.voices !== null ? raw.voices : {}) as
    Partial<Record<ContentLocale, unknown>>;
  const narration = raw.narration;
  const old = migrate(raw);

  return {
    providers: raw.providers === undefined ? old.providers ?? fallback.providers : parseProfiles(raw.providers),
    generationProvider: isProviderId(raw.generationProvider)
      ? raw.generationProvider
      : old.generationProvider ?? fallback.generationProvider,
    chatProvider: raw.chatProvider === 'inherit' || isProviderId(raw.chatProvider)
      ? raw.chatProvider
      : old.chatProvider ?? fallback.chatProvider,
    narration: narration === 'follow' || narration === 'en' || narration === 'zh'
      ? narration
      : fallback.narration,
    voices: {
      en: known('en', voices.en) ?? fallback.voices.en,
      zh: known('zh', voices.zh) ?? fallback.voices.zh,
    },
    searchProvider: raw.searchProvider === 'brave' || raw.searchProvider === 'firecrawl' || raw.searchProvider === 'tavily'
      ? raw.searchProvider : raw.searchProvider === 'keenable' ? 'firecrawl'
        : typeof raw.tavilyKey === 'string' && raw.tavilyKey.trim() && !envNameOf(raw.tavilyKey)
          ? 'tavily' : fallback.searchProvider,
    braveKey: str(raw.braveKey, fallback.braveKey),
    firecrawlKey: str(raw.firecrawlKey, fallback.firecrawlKey),
    tavilyKey: str(raw.tavilyKey, fallback.tavilyKey),
    wereadKey: str(raw.wereadKey, fallback.wereadKey),
    wereadAccount: str(raw.wereadAccount, fallback.wereadAccount),
    trace: typeof raw.trace === 'boolean' ? raw.trace : fallback.trace,
  };
}

/**
 * Written before `$NAME` references existed, when an empty key field meant
 * "read the environment". Read once off disk, so a machine configured that way
 * keeps working; an empty field saved since means no key.
 */
export function upgradeLegacyKeys(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const field of KEY_FIELDS) {
    if (typeof raw[field] !== 'string' || !(raw[field] as string).trim()) out[field] = envRef(KEY_ENV[field]);
  }
  return out;
}

/** The model a provider will actually be called with. */
export function modelOf(settings: ShellSettingsValues, id: ProviderId): string {
  return settings.providers[id]?.model.trim() || defaultModelOf(id);
}

/**
 * Which voice a book gets, decided once when it is built.
 *
 * `follow` is the default because a book read aloud in a language it was not
 * written in is noise — the narration script is generated in the book's own
 * language unless the reader overrode it, and the voice has to match the script,
 * not the interface.
 */
export function voiceFor(
  settings: ShellSettingsValues,
  bookLanguage: ContentLocale,
): { readonly locale: ContentLocale; readonly voice: string } {
  const locale = settings.narration === 'follow' ? bookLanguage : settings.narration;
  return { locale, voice: settings.voices[locale] };
}
