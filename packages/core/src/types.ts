/** Domain types. No framework imports — shared by apps/web and apps/desktop. */
import type { IconName } from './icons';
import type { ContentLocale } from './parse/language';

export type { ContentLocale, IconName };

export type BookType = 'knowledge' | 'narrative';
export type BookFormat = 'epub' | 'txt' | 'markdown' | 'pdf' | 'mobi' | 'docx';

/** Whose words these are. The pipeline speaks of a book's author, but of notes as the reader's own. */
export type SourceKind = 'book' | 'notes';

/** One chapter from parsing. `text` lives only in IndexedDB and never enters an exported bundle. */
export interface Chapter {
  readonly idx: number;
  readonly title: string;
  readonly text: string;
  readonly wordCount: number;
}

export interface ParsedBook {
  readonly title: string;
  readonly author?: string;
  readonly format: BookFormat;
  /** Absent means a book. */
  readonly kind?: SourceKind;
  readonly chapters: readonly Chapter[];
  readonly totalWords: number;
  /**
   * What the book is written in, which decides what it is narrated in. See
   * `parse/language.ts` — never inferred from the reader's interface language.
   */
  readonly language: ContentLocale;
  /** The file's own cover, when it declares one. */
  readonly cover?: BookCover;
  /** The file's own blurb, as plain text. */
  readonly description?: string;
}

export interface BookCover {
  readonly data: Uint8Array;
  readonly mediaType: CoverType;
}

export type CoverType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

/** Map-stage output: one chapter compressed. Every downstream stage reads this, never the raw text. */
export interface ChapterNote {
  readonly idx: number;
  readonly title: string;
  /** One or two sentences on what this chapter covers. */
  readonly gist: string;
  readonly keyPoints: readonly string[];
  /** Verbatim excerpts, used by quote slides and for traceability. */
  readonly quotes: readonly string[];
  /**
   * Structured material for the layouts that need more than prose. Optional
   * because notes cached before these existed are still valid; a chapter with
   * nothing of the kind returns an empty list rather than an invention.
   */
  readonly figures?: readonly ChapterFigure[];
  readonly contrasts?: readonly ChapterContrast[];
  readonly sequences?: readonly ChapterSequence[];
  readonly relations?: readonly ChapterRelation[];
  readonly cycles?: readonly ChapterCycle[];
  readonly ranks?: readonly ChapterRank[];
  readonly quadrants?: readonly ChapterQuadrant[];
  readonly overlaps?: readonly ChapterOverlap[];
  readonly causes?: readonly ChapterCauses[];
}

/** A quantity as the book writes it, unit included — `magnitude` reads the unit back out. */
export interface ChapterFigure {
  readonly value: string;
  readonly label: string;
}

export interface ChapterContrast {
  /** The dimension being contrasted, which becomes a row label. */
  readonly about: string;
  readonly left: string;
  readonly right: string;
}

export interface ChapterSequence {
  readonly title: string;
  /** `mark` is a stage, year or ordinal; empty when the book gives none. */
  readonly steps: readonly { readonly mark: string; readonly text: string }[];
}

export interface ChapterRelation {
  readonly from: string;
  readonly how: string;
  readonly to: string;
}

/** A loop the text closes itself: the last step feeds the first. */
export interface ChapterCycle {
  readonly title: string;
  readonly steps: readonly string[];
}

/** A ranking the text states, top level first. */
export interface ChapterRank {
  readonly title: string;
  readonly levels: readonly string[];
}

export type Pole = 'low' | 'high';

/** Two dimensions crossed into four named types; one cell per corner. */
export interface ChapterQuadrant {
  readonly xLow: string;
  readonly xHigh: string;
  readonly yLow: string;
  readonly yHigh: string;
  readonly cells: readonly QuadrantCorner[];
}

export interface QuadrantCorner {
  readonly x: Pole;
  readonly y: Pole;
  readonly name: string;
  readonly text: string;
}

/** Two or three things the text says meet, and what it calls the place they meet. */
export interface ChapterOverlap {
  readonly sets: readonly string[];
  readonly meet: string;
}

/** One effect and the causes the text gives for it, grouped by kind. */
export interface ChapterCauses {
  readonly effect: string;
  readonly groups: readonly CauseGroup[];
}

export interface CauseGroup {
  readonly name: string;
  readonly causes: readonly string[];
}

/**
 * One station on the learning path. Produced by reduce; slides/narration are
 * generated later.
 *
 * `recap` is not one the model may choose: it marks the single closing station
 * appended to the path after reduce (see pipeline/recap.ts), which is built from
 * the path itself rather than from chapter notes.
 */
export type NodeKind = 'concept' | 'argument' | 'event' | 'character' | 'recap';

export interface PathNode {
  readonly id: string;
  readonly idx: number;
  readonly title: string;
  readonly kind: NodeKind;
  /** What this station must make clear. The slides stage expands this. */
  readonly brief: string;
  readonly keyPoints: readonly string[];
  /** Provenance: which chapters this station came from. Cheapest hedge against hallucination. */
  readonly sourceChapters: readonly number[];
  readonly estMinutes: number;
}

/** A contiguous run of stations. Named for what the reader is doing, not for the book's TOC. */
export interface Stage {
  readonly title: string;
  readonly nodeIds: readonly string[];
}

export interface Path {
  readonly bookId: string;
  readonly title: string;
  readonly type: BookType;
  readonly nodes: readonly PathNode[];
  readonly stages: readonly Stage[];
  readonly totalMinutes: number;
  readonly generatedAt: string;
}

/**
 * Every layout renders from structured data, never from a generated image — see
 * PRD.md. `icon` names a glyph from the fixed set in ./icons and appears on two
 * layouts only, because decoration on every line is noise.
 */
export type Slide =
  | { readonly layout: 'title'; readonly kicker?: string; readonly title: string; readonly subtitle?: string; readonly icon?: IconName }
  | { readonly layout: 'points'; readonly heading: string; readonly points: readonly string[] }
  | ({ readonly layout: 'number'; readonly heading?: string; readonly items: readonly NumberItem[]; readonly note?: string } & Focus)
  | {
      readonly layout: 'quote';
      readonly text: string;
      readonly cite?: string;
      /** Where this line was found verbatim. Absent means it was not found at all. */
      readonly source?: QuoteSource;
    }
  | { readonly layout: 'compare'; readonly heading?: string; readonly left: ComparePane; readonly right: ComparePane }
  | ({ readonly layout: 'flow'; readonly heading?: string; readonly steps: readonly string[] } & Aside)
  | { readonly layout: 'timeline'; readonly heading?: string; readonly items: readonly TimelineItem[] }
  | ({
      readonly layout: 'matrix';
      readonly heading?: string;
      readonly left: string;
      readonly right: string;
      readonly rows: readonly MatrixRow[];
    } & Aside)
  | ({ readonly layout: 'relation'; readonly heading?: string; readonly links: readonly RelationLink[] } & Focus & Aside)
  | ({ readonly layout: 'cycle'; readonly heading?: string; readonly steps: readonly string[] } & Focus & Aside)
  | ({ readonly layout: 'pyramid'; readonly heading?: string; readonly levels: readonly string[] } & Focus & Aside)
  | ({
      readonly layout: 'quadrant';
      readonly heading?: string;
      readonly x: AxisPoles;
      readonly y: AxisPoles;
      /** Reading order: top-left, top-right, bottom-left, bottom-right. */
      readonly cells: readonly QuadrantCell[];
    } & Focus & Aside)
  | ({ readonly layout: 'overlap'; readonly heading?: string; readonly sets: readonly string[]; readonly meet: string } & Aside)
  | ({
      readonly layout: 'causes';
      readonly heading?: string;
      readonly effect: string;
      readonly groups: readonly CauseGroup[];
    } & Focus & Aside);

/** The one item the slide is for, by index. Absent when the items weigh the same. */
export interface Focus {
  readonly focus?: number;
}

/** A margin note in the book's own words; slides.ts drops one it cannot find in the quotes. */
export interface Aside {
  readonly aside?: string;
}

export interface AxisPoles {
  readonly low: string;
  readonly high: string;
}

export interface QuadrantCell {
  readonly name: string;
  readonly text: string;
}

/**
 * Provenance for one quoted line, down to the excerpt it came from.
 *
 * `sourceChapters` already traces a station to its chapters, but a chapter is
 * ~3000 words — too coarse to answer "where does this sentence come from?".
 * The map stage already stores verbatim excerpts, so the finer link costs a
 * lookup rather than another pass over the book.
 */
export interface QuoteSource {
  /** Chapter index, matching ChapterNote.idx. */
  readonly chapter: number;
  /** Position in that chapter's `quotes`. */
  readonly index: number;
}

export interface NumberItem {
  readonly value: string;
  readonly label: string;
}

export interface ComparePane {
  readonly title: string;
  readonly points: readonly string[];
  readonly icon?: IconName;
}

/** `mark` is the spine label — a year, a stage, an ordinal. Never empty on a slide. */
export interface TimelineItem {
  readonly mark: string;
  readonly text: string;
}

/** One row of an aligned comparison: the same question asked of both sides. */
export interface MatrixRow {
  readonly aspect: string;
  readonly left: string;
  readonly right: string;
}

export interface RelationLink {
  readonly from: string;
  readonly how: string;
  readonly to: string;
}

/** A slide before narration timing exists, keyed to the sentence it appears on. */
export interface DraftSlide {
  readonly slide: Slide;
  readonly atSentence: number;
}

/** Output of the slides stage: what to show and what to say, no timing yet. */
export interface DraftDeck {
  readonly nodeId: string;
  readonly slides: readonly DraftSlide[];
  readonly sentences: readonly string[];
}

/** One narration sentence with its span in the audio. Drives subtitle highlight. */
export interface NarrationCue {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

/** Output of the tts stage: the deck with audio and timing attached. */
export interface NodeDeck {
  readonly nodeId: string;
  /** atMs = when this slide appears on the audio timeline. */
  readonly slides: readonly (Slide & { readonly atMs: number })[];
  readonly narration: readonly NarrationCue[];
  /**
   * Where this station's audio is.
   *
   * Absolute while the deck is in flight — it points into the content-keyed
   * build cache, and `install` copies from exactly that name rather than
   * rebuilding it from the node id (invariant 8). Once installed it is stored
   * **relative to the book's own directory**, because a generated book is meant
   * to be movable: copied to another machine, or synced to a phone that has no
   * idea what `/Users/karen` means. Players derive the URL from
   * `audioFile(bookId, nodeId)` regardless and never read this.
   */
  readonly audioPath: string;
  readonly durationMs: number;
}

/** Expected parse failures. Callers turn the code into a message a human can act on. */
export class ParseError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unsupported_format'
      | 'empty_file'
      | 'corrupt_archive'
      | 'no_content'
      | 'decode_failed'
      | 'scanned_pdf'
      | 'unreadable_pdf'
      | 'drm_protected'
      | 'mixed_selection',
    /** Values the reader's own wording needs — the extension, the missing part. */
    readonly params: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = 'ParseError';
  }
}
