/**
 * The settings only the main process can hold, as the panel sees them.
 *
 * An interface rather than an import, for the same reason `LlmProvider` is one:
 * `packages/ui` must not know that a desktop shell or an RPC bridge exists.
 * `bun run dev` passes nothing here and the pages that need it say so instead
 * of pretending the controls work.
 */
import type { Locale } from '../i18n/locale';

/** Which language a book is read aloud in. `follow` uses the book's own. */
export type NarrationLanguage = 'follow' | Locale;

/** Mirrors `ProviderId` in the desktop app's `shared/providers.ts`. */
export type ProviderId = string;

export interface ProviderModelInfo {
  readonly id: string;
  /** A proper noun — never translated. */
  readonly name: string;
  /** Whether the provider holds this model's reply to the schema server-side. */
  readonly strict: boolean;
}

/**
 * A provider as the panel draws it.
 *
 * Supplied by the shell rather than imported, for the same reason the rest of
 * this file is an interface: the catalog it is built from is pi-ai's, and
 * `packages/ui` must not know that a desktop app exists.
 */
export interface ProviderInfo {
  readonly id: ProviderId;
  /** A brand name — never translated. */
  readonly label: string;
  readonly getKeyUrl: string;
  readonly faviconDomain: string;
  readonly baseUrl: string;
  /** The environment variable the key field starts out naming, as `$NAME`. */
  readonly envKey?: string;
  /** Only a custom endpoint has none of its own. */
  readonly needsBaseUrl: boolean;
  /** Uses the account `codex login` signed in: no key field, no endpoint. */
  readonly signIn?: boolean;
  readonly models: readonly ProviderModelInfo[];
}

export interface ProviderProfile {
  readonly apiKey: string;
  /** Empty means the provider's own endpoint. */
  readonly baseUrl: string;
  /** Empty means the provider's default model. */
  readonly model: string;
}

export interface ModelStatus {
  /** The provider that will actually answer. Never translated. */
  readonly provider: string;
  readonly ready: boolean;
  /** An endpoint, a model name, or a reason. Never translated. */
  readonly detail: string;
}

export interface ShellPrefs {
  readonly providers: Readonly<Record<string, ProviderProfile | undefined>>;
  readonly generationProvider: ProviderId;
  /** `inherit` puts the companion on whatever generation uses. */
  readonly chatProvider: ProviderId | 'inherit';
  readonly narration: NarrationLanguage;
  /** Voice id per language, e.g. `en-US-AndrewNeural`. */
  readonly voices: Readonly<Record<Locale, string>>;
  readonly searchProvider: 'brave' | 'firecrawl' | 'tavily';
  readonly braveKey: string;
  readonly firecrawlKey: string;
  readonly tavilyKey: string;
  readonly wereadKey: string;
  readonly wereadAccount: string;
  readonly trace: boolean;
  /** Upload finished books to the owner's iCloud and keep the reader's place in step. */
  readonly icloudSync: boolean;
}

export type WereadLoginFailure = 'expired' | 'otp_expired' | 'no_skill' | 'rejected' | 'network';

/** Where a WeChat Reading sign-in is. `out` carries why the last attempt stopped, if it did. */
export type WereadAccountState =
  | { readonly step: 'loading' }
  | { readonly step: 'out'; readonly failed?: WereadLoginFailure }
  | { readonly step: 'starting' }
  | { readonly step: 'qr'; readonly url: string }
  | { readonly step: 'otp'; readonly wrong: boolean; readonly busy: boolean }
  | { readonly step: 'in'; readonly account?: string };

export interface WereadAccount {
  readonly state: WereadAccountState;
  readonly signIn: () => void;
  /** The four digits the phone showed. */
  readonly submitOtp: (code: string) => void;
  readonly cancel: () => void;
  readonly signOut: () => void;
}

export interface VoiceOption {
  readonly id: string;
  /** Already in the reader's language — the main process does not translate. */
  readonly label: string;
}

/** One book as the iCloud section lists it. */
export interface CloudBookRow {
  readonly id: string;
  readonly title: string;
  /** What it takes in iCloud, and again on the phone. */
  readonly bytes: number;
  readonly state: 'synced' | 'waiting' | 'uploading' | 'off' | 'building' | 'failed';
  readonly done?: number;
  readonly total?: number;
}

/** iCloud as the settings panel sees it. The switch itself is `prefs.icloudSync`. */
export interface CloudPanel {
  /** Whether iCloud can be used from this build and this account at all. */
  readonly reach: 'ready' | 'no_helper' | 'no_account' | 'restricted' | 'unknown';
  readonly running: boolean;
  readonly books: readonly CloudBookRow[];
  /** Off takes the book out of iCloud and keeps it out. */
  readonly setBook: (bookId: string, on: boolean) => void;
  readonly syncNow: () => void;
  /** Switches syncing off and removes every book from iCloud. */
  readonly removeAll: () => Promise<void>;
}

export interface ShellSettings {
  readonly prefs: ShellPrefs;
  readonly setPref: <K extends keyof ShellPrefs>(key: K, value: ShellPrefs[K]) => void;
  /** Patch one provider's profile, leaving every other provider's key untouched. */
  readonly setProvider: (id: ProviderId, patch: Partial<ProviderProfile>) => void;
  /** Every provider the panel can offer, in display order. */
  readonly providers: readonly ProviderInfo[];
  /** Voices the narrator offers, per language. */
  readonly voicesFor: (locale: Locale) => readonly VoiceOption[];
  /** What the model settings currently resolve to. */
  readonly modelStatus?: ModelStatus;
  readonly recheckModel: () => void;
  /**
   * Speak a sample in that voice's own language — never a Chinese sentence in
   * an English voice, which is the noise this whole split exists to avoid.
   */
  readonly previewVoice: (locale: Locale) => void;
  readonly previewing?: Locale;
  readonly dataDir: string;
  /** Recording model calls is for debugging a prompt, so only a dev build offers it. */
  readonly devBuild: boolean;
  readonly revealDataDir: () => void;
  readonly clearCache: () => Promise<void>;
  readonly weread: WereadAccount;
  /** Absent until the main process has answered. */
  readonly cloud?: CloudPanel;
}
