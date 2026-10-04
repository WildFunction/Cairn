import type { BudgetId } from '@cairn/core/pipeline/budget';
import type { ContentLocale } from './settings';

/** Parse-only summary shown before any model call, so the budget choice is informed. */
export interface BookPreview {
  readonly id: string;
  /** One book, or several Markdown notes. */
  readonly filePaths: readonly string[];
  readonly title: string;
  readonly author?: string;
  readonly chapters: number;
  readonly words: number;
  /**
   * What this book will be read aloud in, decided before a single model call.
   * Shown at the same point the budget is chosen: a book about to be narrated
   * in the wrong language is worth catching before paying for it, not after.
   */
  readonly narration: { readonly locale: ContentLocale; readonly voice: string };
  /**
   * Numbers, not sentences. `ReadingBudget.label` is composed for the terminal
   * tool and is Chinese either way; the player words these itself.
   */
  readonly budgets: readonly {
    id: BudgetId;
    minutes: number;
    honest: boolean;
    /** Present only when the rung would flatten this book: words per station. */
    wordsPerNode?: number;
    recommended: boolean;
  }[];
}

/** What WeChat Reading adds to a shelf row. `cover` is relative to the library root. */
export interface BookMeta {
  readonly cover?: string;
  readonly intro?: string;
  /** WeChat Reading's recommendation score, 0–100. */
  readonly rating?: number;
}

/** A book on the reader's WeChat Reading shelf. `cover` is a remote https URL. */
export interface WereadShelfBook {
  readonly bookId: string;
  readonly title: string;
  readonly author?: string;
  readonly cover?: string;
  /** The original thumbnail, for a book the CDN has no larger cover of. */
  readonly coverFallback?: string;
}

/** Whether a key is in force, and whose account it came from when a QR login stored it. */
export interface WereadStatus {
  readonly connected: boolean;
  readonly account?: string;
}

export type { DeckStatus, Progress } from '@cairn/core/books/progress';
