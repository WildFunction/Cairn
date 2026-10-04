import { openExternal, openFileDialog } from 'electrobun/main/utils';
import type { BookBuilder } from '@cairn/core/books/builder';
import type { Weread } from './weread/service';
import type { WereadLogin } from './weread/login';
import type { LoginStep } from '../shared/weread-login';
import { ACCEPTED_EXTENSIONS } from '@cairn/core/parse/format';
import type { BudgetId } from '@cairn/core/pipeline/budget';
import { isBookId, type LibraryEntry } from '@cairn/core/store/library';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { speakSample } from '@cairn/core/runtime';
import { effectiveWereadKey, readSettings, writeSettings } from './settings';
import type {
  ContentLocale, ModelStatus, ShellSettingsValues, UiLocale,
} from '../shared/settings';
import { webUrl } from './external-url';
import { libraryServer, previewFile } from './library-server';
import { DATA_DIR, library } from './store';
import { markBookFinished } from './reading';
import { loadSession, saveSession } from './companion/session';
import { saveWorking } from './companion/working';
import { runTurn } from './companion/run';
import type { CompanionEvent } from '../shared/companion-events';
import type { RequestParams } from '../shared/schema';
import { modelStatus } from './provider';
import type {
  BookMeta, BookPreview, Progress, WereadShelfBook, WereadStatus,
} from '../shared/types';
import { inspect, readBook, sourceOf } from './inspect';
import { CairnError } from '@cairn/core/errors';
import { encodingErrors } from '../shared/errors';


const quietly = <T>(what: string, fallback: T) => (cause: unknown): T => {
  console.error(what, cause);
  return fallback;
};

const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** What the handlers need from the rest of the process, assembled once in `index.ts`. */
export interface HandlerDeps {
  readonly books: BookBuilder;
  readonly weread: Weread;
  readonly wereadLogin: WereadLogin;
  readonly devBuild: boolean;
  /** Rebuilds the native menu in the reader's language. */
  readonly menu: (locale: UiLocale) => void;
  /** Pushed to the window; fire-and-forget, so each has a pull-side twin. */
  readonly emit: {
    readonly progress: (p: Progress) => void;
    readonly companion: (event: CompanionEvent) => void;
  };
}

export function createHandlers({ books, weread, wereadLogin, devBuild, menu, emit }: HandlerDeps) {
  /** One reader, one conversation: a second send while a turn runs is refused. */
  let activeChat: { readonly turnId: string; readonly controller: AbortController } | undefined;

  /**
   * The last progress of the run in flight. Pushed messages are fire-and-forget:
   * a reloaded window, or a dropped message, would leave the modal frozen for a
   * run that takes minutes, so the window can also ask.
   */
  let latest: Progress | undefined;

  const rawHandlers = {
    /** Where the webview reads generated books from. Token included; do not log it. */
    async libraryBase(): Promise<string> {
      return libraryServer().base;
    },

    /** Where the run in flight has got to, or nothing when none is running. */
    async progressNow(): Promise<Progress | null> {
      return latest ?? null;
    },

    /** Native picker, then a parse-only preview so the budget choice is informed. */
    /** Several files are several notes; `readBook` refuses a mix of notes and books. */
    async pickBook(): Promise<BookPreview | null> {
      const picked = (await openFileDialog({
        allowedFileTypes: ACCEPTED_EXTENSIONS.map((e) => e.slice(1)).join(','),
        canChooseFiles: true,
        canChooseDirectory: false,
        allowsMultipleSelection: true,
      })).filter((p) => p.length > 0);
      return picked.length > 0 ? inspect(picked) : null;
    },

    async generateBook(params: { filePaths: readonly string[]; budgetId: BudgetId }): Promise<LibraryEntry> {
      latest = { stage: 'map', done: 0, total: 1 };
      try {
        const book = await readBook(params.filePaths);
        const { entry } = await books.generate(book, sourceOf(params.filePaths), params.budgetId, (p) => {
          latest = p;
          emit.progress(p);
        });
        return entry;
      } finally {
        latest = undefined;
      }
    },

    /**
     * The reader moved. Build what they are about to reach, not what comes next
     * in the path they have already walked past.
     */
    async focusStation(params: { bookId: string; nodeId: string }): Promise<null> {
      books.schedulerFor(params.bookId)?.focus(params.nodeId);
      return null;
    },

    /** Opening a half-built book restarts its builder where it stopped. */
    async resumeBook(params: { bookId: string }): Promise<boolean> {
      return books.resume(params.bookId).catch(() => false);
    },

    async retryBook(params: { bookId: string }): Promise<boolean> {
      if (!isBookId(params.bookId)) throw new Error('invalid_book_id');
      return books.retry(params.bookId);
    },

    /* ---- WeChat Reading: an extra, so a failure is logged and reads as nothing ---- */

    async wereadQuotes(params: { title: string; author?: string }): Promise<readonly string[]> {
      return weread.quotes(params.title, params.author).catch(quietly('wereadQuotes', []));
    },

    async bookMeta(params: { bookId: string }): Promise<BookMeta | null> {
      return weread.meta(params.bookId).catch(quietly('bookMeta', null));
    },

    async wereadStart(params: { bookId: string }): Promise<string | null> {
      return weread.startStation(params.bookId).catch(quietly('wereadStart', null));
    },

    async wereadShelf(): Promise<readonly WereadShelfBook[]> {
      return weread.shelf().catch(quietly('wereadShelf', []));
    },

    async wereadIntro(params: { wereadId: string }): Promise<string | null> {
      return weread.intro(params.wereadId).catch(quietly('wereadIntro', null));
    },

    async wereadStatus(): Promise<WereadStatus> {
      const settings = await readSettings();
      const connected = effectiveWereadKey(settings) !== undefined;
      return { connected, ...(connected && settings.wereadAccount ? { account: settings.wereadAccount } : {}) };
    },

    /** Unlike the calls above, a failure here is the reader's to see: they asked to sign in. */
    async wereadLoginStart(): Promise<{ id: string; url: string }> {
      return wereadLogin.start();
    },

    async wereadLoginPoll(params: { id: string; otp?: string }): Promise<LoginStep> {
      return wereadLogin.poll(params.id, params.otp);
    },

    async wereadLoginCancel(params: { id: string }): Promise<null> {
      wereadLogin.cancel(params.id);
      return null;
    },

    async wereadSignOut(): Promise<null> {
      await writeSettings({ wereadKey: '', wereadAccount: '' });
      return null;
    },

    async markBookFinished(params: { bookId: string; nodeId: string }): Promise<boolean> {
      return markBookFinished(params.bookId, params.nodeId);
    },

    async chatHistory(params: { bookId: string }) {
      if (!isBookId(params.bookId)) throw new Error('invalid_book_id');
      const path = await library.loadPath(params.bookId);
      return loadSession(DATA_DIR, params.bookId, path.generatedAt);
    },

    async chatSend(params: RequestParams<'chatSend'>): Promise<boolean> {
      if (activeChat) return false;
      const controller = new AbortController();
      activeChat = { turnId: params.turnId, controller };
      let terminal = false;
      void runTurn({ ...params, signal: controller.signal }, (event) => {
        if (event.type === 'final' || event.type === 'error') terminal = true;
        emit.companion(event);
      }, () => books.pauseAll())
        .catch((cause: unknown) => {
          if (!terminal) emit.companion({
            type: 'error', turnId: params.turnId, bookId: params.bookId,
            code: 'model_failed', message: cause instanceof Error ? cause.message : String(cause),
          });
          console.error('chatSend failed', cause);
        })
        .finally(() => { if (activeChat?.turnId === params.turnId) activeChat = undefined; });
      return true;
    },

    /** Refused mid-turn: the turn would save the old conversation back over the cleared one. */
    async chatClear(params: { bookId: string }): Promise<boolean> {
      if (!isBookId(params.bookId)) throw new Error('invalid_book_id');
      if (activeChat) return false;
      const { generatedAt } = await library.loadPath(params.bookId);
      await saveSession(DATA_DIR, params.bookId, { pathGeneratedAt: generatedAt, messages: [], evidence: [] });
      await saveWorking(DATA_DIR, params.bookId, generatedAt, { summary: '', retainedFrom: 0 });
      return true;
    },

    async chatCancel(params: { turnId: string }): Promise<boolean> {
      if (activeChat?.turnId !== params.turnId) return false;
      activeChat.controller.abort();
      return true;
    },

    /** Irreversible, and the reader has already confirmed it in the shelf. */
    async deleteBook(params: { bookId: string }): Promise<boolean> {
      try {
        const removed = await books.remove(params.bookId);
        if (!removed) throw new CairnError('book_not_listed', { id: params.bookId });
        return true;
      } catch (cause) {
        // The terminal gets the stack; the reader gets a code the player words.
        console.error('deleteBook failed', params.bookId, cause);
        if (cause instanceof CairnError) throw cause;
        throw new CairnError('delete_failed', { id: params.bookId }, message(cause));
      }
    },

    /* ---- settings ---- */

    async getSettings(): Promise<ShellSettingsValues> {
      return readSettings();
    },

    async setSettings(patch: Partial<ShellSettingsValues>): Promise<ShellSettingsValues> {
      return writeSettings(patch);
    },

    async devBuild(): Promise<boolean> {
      return devBuild;
    },

    /** Where generated books live, as a path a human can read and open. */
    async dataDir(): Promise<string> {
      return DATA_DIR;
    },

    /**
     * Audition a voice, in that voice's own language.
     *
     * The sample is never translated across languages: an English voice reading a
     * Chinese sentence is exactly the noise the per-language split exists to
     * prevent, and hearing it would teach the reader nothing about the voice.
     *
     * Written under the library root so the player can fetch it over the same
     * loopback server as the book audio — the webview cannot play a file path.
     */
    async previewVoice(params: { locale: ContentLocale }): Promise<string> {
      const settings = await readSettings();
      const voice = settings.voices[params.locale];
      // Named after the voice: a fixed name per language made the player replay
      // the audio it already had, so every voice after the first sounded broken.
      const rel = previewFile(voice);
      await speakSample(SAMPLE[params.locale], voice, join(DATA_DIR, rel));
      return rel;
    },

    /** Show the library in the system file manager. Never opens a file, only reveals the folder. */
    async revealDataDir(): Promise<null> {
      const opener = { darwin: 'open', win32: 'explorer' }[process.platform as string] ?? 'xdg-open';
      Bun.spawn([opener, DATA_DIR], { stdout: 'ignore', stderr: 'ignore' });
      return null;
    },

    /** Which model route is in force, for the settings panel to show. */
    async modelStatus(): Promise<ModelStatus> {
      return modelStatus();
    },

    async openExternal(params: { url: string }): Promise<boolean> {
      const url = webUrl(params.url);
      return url !== undefined && openExternal(url);
    },

    async setMenuLocale(params: { locale: UiLocale }): Promise<null> {
      menu(params.locale);
      return null;
    },

    /**
     * Throw away everything derived from the books, keeping the books themselves.
     * Irreversible, and the reader has already confirmed it in the panel.
     */
    async clearCache(): Promise<null> {
      await rm(join(DATA_DIR, '.cache'), { recursive: true, force: true });
      await rm(join(DATA_DIR, '.preview'), { recursive: true, force: true });
      return null;
    },
  };

  /** Every failure leaves as an encoded payload, so the player can word it in the reader's language. */
  return encodingErrors(rawHandlers);
}

/** One sentence per language, each written in that language on purpose. */
const SAMPLE: Readonly<Record<ContentLocale, string>> = {
  en: 'A chapter that cannot make one thing clear is worth nothing.',
  zh: '一章讲不清一件事，就什么都不是。',
};
