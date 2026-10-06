# Cairn — PRD

2026-09-25 · the current product definition

Organised by module. Each section is one part of the system: what it does, the decisions inside
it, and what is deliberately left out. [ARCHITECTURE.md](./ARCHITECTURE.md) covers how the
modules fit together; [DESIGN.md](./DESIGN.md) covers how they look.

| § | Module | Where it lives |
| --- | --- | --- |
| 1 | What this is | — |
| 2 | Intake: shelf, parse, budget | `parse/`, `pipeline/budget.ts`, `AddBook.tsx` |
| 3 | Path generation | `pipeline/map` → `classify` → `reduce` → `recap` |
| 4 | Decks: slides and narration | `pipeline/slides.ts`, `tts.ts`, `build.ts`, `packages/ui` |
| 5 | Player: the three panes | `apps/desktop`, `packages/ui` |
| 6 | Companion | `main/companion/`, `CompanionPane.tsx` |
| 7 | Memory across books | `main/companion/shelf-tools.ts`; generation use not built |
| 8 | Quality signals | `PathQuality` on each `LibraryEntry` |
| 9 | Boundaries | — |

---

## 1. What this is

**Turn an ebook into a path you can walk to the end, and walk it yourself.**

One owner, run locally: books are made on the Mac, and can be listened to on an iPhone.

### What it is not

- **Not a chat-first reading product.** The companion is a side path; **finishing the walk is the
  main line.**
- **Not a video generator.** Slides are data; the player is one way of rendering them.
- **Not a course platform.** There is no curriculum, no grading, no schedule.

It is also **not a knowledge base today** — but that is a matter of sequence, not principle. See
§7: remembering across books is a direction, and the one place a vector store would earn its
keep.

### How success is judged

There is no metric. The only honest signal: **does its owner reach for it again on a second
book.**

---

## 2. Intake: shelf, parse, budget

**A note on the word.** The code and these documents call one node of the path a *station*. The
reader sees 章, because that is the word they reached for. The two are not the book's own
chapters — those appear only in a quote's provenance, which says 原书第 N 章 to keep them apart.
The reader-facing noun lives in `packages/ui/src/copy.ts` so changing it stays one edit.

1. **Pick a book** — a local EPUB, PDF, MOBI/AZW3, DOCX, TXT or Markdown file. A PDF must have a
   text layer; a Kindle file must be DRM-free. Or one or more Markdown files of the reader's own
   notes, walked as one path in file-name order and narrated as theirs, not an author's.
2. **Preview** — parse only, no model call, so picking a file stays instant: title, author,
   chapter count, word count.
3. **Pick a budget** — four rungs, described below.
4. **Generate** — per-chapter progress, interruptible, resumable from where it stopped.

**Deleting** is on the shelf row, behind a confirm, and takes the whole book: its path, decks,
audio, pipeline cache and stored reading position. Nothing is archived — this is one machine and
one owner, and a "deleted" book still occupying a gigabyte of audio would be a lie about disk.

The position has to go with it. Re-adding the same file produces the same id (`bookSlug` hashes
the path), so a kept position would resume the new path at a station that no longer exists.

### The budget is the constraint; the station count is the result

The reader picks how long the whole walk should take. `budget.ts` derives the station count and
how ruthless the selection should be. A tighter budget **drops whole stations** rather than
making each one shallower — a station that cannot make one thing clear is worth nothing.

The four rungs are fixed in intent, not in minutes:

| Rung | Intent | Coverage |
| --- | --- | --- |
| `quick` | Know roughly what it says | The spine argument only |
| `brief` | Get the key points | The spine plus the arguments holding it up |
| `solid` | Actually understand it | Concepts, arguments, representative examples |
| `full` | Walk the whole thing | Nearly all substantive content |

**Their durations are derived per book, never hardcoded.** A complete walk scales with the
square root of word count, anchored at two hours for a 200k-word book and clamped to 30–240
minutes: a book four times as long does not carry four times as many distinct ideas. Each rung
takes a share of that, with a minimum gap between rungs so four choices stay four choices on a
short book. Station count then follows from the target duration, capped by the book's own
chapter count — past roughly two stations per chapter, extra stations split hairs.

A rung whose arithmetic does not work out for this book is **still offered, but labelled**: for a
7-million-word serial, `quick` would put a million words behind each station, and the note says
so rather than hiding the option.

---

## 3. Path generation

```
parse     ebook → Chapter[]                      local, no model
chunk     reshaped into even map units           local
map       each chapter → ChapterNote             N model calls; the text is read exactly once
classify  book type                              1 call
reduce    ChapterNote[] → PathNode[] + stages    1–2 calls, bound by the budget
recap     the path's own briefs → closing node   1 call, reads the path, not the notes
```

### Structure comes from the real text

Station count and ordering derive from the table of contents plus the per-chapter notes. **The
model's pretraining memory is never used to decide structure**: it works for famous books and
turns into confident fabrication on the long tail. A wrong fact can be caught by someone who read
the book; a fabricated structure looks exactly like a real one.

Every station carries `sourceChapters`. Stations citing chapters that do not exist are dropped,
and the count is recorded (§8).

### Stages come from the path, not from the table of contents

The left pane groups by the path's **own** stages. The path has already reordered things: chapter
44 of Pro Git (reset and the three trees) becomes station 3, because it is a mental model that
belongs early. Grouping by the original structure would fight the actual order.

A stage name describes **what the reader is doing right now** — "build the model", "work through
the argument", "put it into practice" — not the table of contents.

### The path closes with a recap

The last station is the walk's own ending: it reconnects the stations into one line, says what
the book finally claims, and tells the reader they have finished. It is built from the path's own
station briefs rather than from the chapters, so it costs no second pass over the book. It quotes
nothing — it has no excerpts of its own, and an invented quotation is exactly what this pipeline
refuses to render.

### The path is decided in one go; the decks fill in behind you

What you wait for after picking a budget is the **path**, not every station. For a 200k-word book
at the full budget that is roughly 24 model calls against 36 more for the decks — the decks are
about six tenths of the wait.

So `reduce` installs the path immediately and the book appears on the shelf; the first station
follows and you start walking. Jump to station 10 and the queue re-orders to 10, 11, 12, with the
stations you skipped moved to the end rather than dropped.

**The path itself cannot be progressive.** `reduce` needs every chapter note before it can select
and order stations; adding stations as you read would let arrival time decide the station count
instead of the budget — the one thing the budget exists to decide. The station list is complete
from the first moment, with deckless stations marked pending.

---

## 4. Decks: slides and narration

### Why slides and not video

Slides are data, so one piece of content can render as a player, as plain text, and later as mp4
if it ever needs to. Commit to mp4 first and changing one page means re-rendering the whole
thing — and the text view stops being possible at all.

**Only the player is built.** No code today turns a `Slide` into text; the point is about what
the data model keeps available.

### Data model

```
PathNode {
  …
  slides:    Slide[]
  narration: NarrationCue[]
  audio:     { src, durationMs }
}

Slide        { id, layout, data, atMs }     // atMs = when it appears on the audio timeline
NarrationCue { text, startMs, endMs }       // drives the caption
```

### Layouts

| `layout` | Used for |
| --- | --- |
| `title` | Opening each station |
| `points` | Three claims at most |
| `number` | Experimental data, key ratios |
| `quote` | A line from the book |
| `compare` | A versus B |
| `flow` | A chain of reasoning or cause |
| `timeline` | A dated or staged progression |
| `matrix` | The same question asked of both sides |
| `relation` | Cause and effect, as the book states it |
| `cycle` | A loop the book closes: the last step feeds the first |
| `pyramid` | A ranking the book states, apex first |
| `quadrant` | Two dimensions crossed into four named types |
| `overlap` | Two or three things that meet, and what the book calls the meeting place |
| `causes` | One effect and its grouped causes, as a fishbone |

Slides per station follow the station's length — roughly one per 22 seconds of narration, four
at the fewest and fourteen at the most (`slideCount`). A fixed cap of six left a four-minute
station holding one card for fifty seconds, which reads as a stall. `world` (a novel's setting)
is not built.

The last nine draw only on material the map stage extracted verbatim — `figures`, `sequences`,
`contrasts`, `relations`, `cycles`, `ranks`, `quadrants`, `overlaps`, `causes` on each
`ChapterNote`. A chapter that yields none of a kind produces no
slide of that kind. These are the layouts that look most evidenced, so a fabricated one does the
most damage; the rule is enforced in the prompt and in normalization, not left to taste.

The reasoning behind each layout — what shape of claim it is for, and the decision inside it —
is in [DESIGN.md](DESIGN.md).

**No image-generation model is called.** Abstract ideas do not yield informative illustrations,
and a good deck is mostly type and simple diagrams anyway. Pictograms are not generated images:
`core/src/icons.ts` is a closed list of glyph names and `ui/src/slides/glyphs.ts` draws each with
a few stroked paths — local, offline, free, identical on every render. A slide's `icon` picks a
name from that list or leaves it empty.

Icons appear in exactly two places: `title` (so a station has a recognisable mark) and the two
halves of `compare` (so it is obvious which side is which). **Never on every bullet of `points`**
— the numbering already carries the rhythm. The list deliberately contains no abstract concepts:
"compounding" and "identity" have no honest glyph, and inventing one turns the deck into clipart.

### Generating and syncing

```
slides   PathNode + the ChapterNotes of its sourceChapters
           → Slide[] + a narration script split into sentences    1 call per station
             ↓
tts      narration script → mp3 + per-sentence timing             Edge read-aloud, free
             ↓
         timings become NarrationCue[]; each slide's atMs aligns
         to the start of the sentence it belongs to
```

The service emits word-boundary events alongside the audio; `cuesFromBoundaries` folds them into
sentence-level cues, and **both the caption and the slide changes are driven from those** —
nothing is timed by hand.

Captions are cut finer than narration sentences: `caption.ts` splits at clause punctuation, drops
the trailing mark, and enforces a minimum line length and on-screen time. A 40-character sentence
is the right unit for a script and the wrong one for a subtitle.

Quote provenance: `slides.ts` resolves each quote back to the `ChapterNote` excerpt it came from,
and the slide renders it. A quote it cannot locate says so on the slide.

Deck caching is keyed on **content, not position**: `deckKey()` fingerprints the station, because
`reduce` is not deterministic and one audio directory is shared by every budget.

---

## 5. Player: the three panes

### The deck plays like a video

The centre pane is a player. Nothing shows over the frame but a progress line until the pointer
moves; the controls fade in on the frame itself and fade out again after 2.5 seconds idle, or
300ms after the pointer leaves. They stay up while paused, because pausing means looking for
something.

Play/pause, volume with mute, elapsed and total, playback rate, slide count, fullscreen —
all bare marks with no container, so the strongest thing on screen stays the slide. Keyboard:
space, ← / → to seek (hold to rewind or to speed up), ↑ / ↓ volume, `m` mute, `f` fullscreen.

Fullscreen goes through the frame's centring wrapper, so the slide keeps its 16:9 and
letterboxes rather than stretching to the display's shape.

```
┌──────────┬────────────────────────────┬──────────────┐
│ Progress │        Slide (16:9)        │     Ask      │
│          │                            │              │
│ Model    │                            │  ┌────────┐  │
│  ✓ 1     │        Anchoring           │  │ quoted │  │
│  ✓ 2     │                            │  └────────┘  │
│  ● 3     │   The first number you     │  What does   │
│    4     │   hear hijacks every       │  this mean?  │
│          │   judgement after it       │              │
│ Argument ├────────────────────────────┤  A: …        │
│    5     │ Caption (one line at a time)│  ch. 11     │
│    …     │ ▶ ━━━━━━━──────  1:14/3:12 │  [input]     │
└──────────┴────────────────────────────┴──────────────┘
```

| Pane | Contents | Behaviour |
| --- | --- | --- |
| **Left: progress** | Every station, grouped by the path's stages, in three states: walked / current / ahead | Click to jump. This is a personal tool; skipping is not gated |
| **Centre: slide** | The current deck, with caption and transport below | Plays and advances itself |
| **Right: ask** | Questions from a selection or typed freely, answers, provenance | Asking pauses narration; it does not resume automatically |

### The reader sets the pace

- `←` `→` previous / next slide
- `↓` `↑` previous / next station
- `space` pause and resume
- **Click the slide** to pause and resume. A deck plays like a video, so the frame is the pause
  target; there is no play button below it. A drag that selects caption text is a quote, not a
  pause, so a live selection does not toggle playback.
- Select text in the caption or on the slide → the right pane picks it up as a quote

### Asking pauses, answering does not resume

Asking means attention has already left the main line; resuming automatically would make the
reader miss what just played. Resuming is the reader's own keypress.

### Closing the app does not lose your place

Which book, which station, which second — remembered per book. The next launch reopens the last
book where it stopped, **paused**: being dropped into the middle of a sentence unannounced is
worse than pressing play. A position in the first or last few seconds of a station starts that
station over, because resuming there buys nothing. Going back to the shelf is deliberate, so the
launch after that opens on the shelf; each book's position is still kept.

For a book in iCloud the position also travels: the Mac reads iCloud's copy when the book opens,
before the first station plays, and keeps whichever of the two was written later.

### On the iPhone

A player, and nothing else: no generation, no companion, no chapter text on the device. Books
arrive from the Mac through the owner's private iCloud; one book is built in, so a fresh install
with no account has something to open.

- **Shelf.** One card per book: cover (or the title on a plain board), author, chapter count and
  minutes, the intro, and a foot line — where the reader is, `Not started`, `Finished`, or
  `Downloading 6 / 17` while stations arrive. A book is listed once its book record has landed and
  opens once its first station is on disk; stations still on the way show as pending, never
  hidden. Tapping a book plays it at the stored place; a finished one starts again from the top and
  stays `Finished` until a minute of it has been heard again. Pull to refresh asks iCloud for changes.
- **Player, after YouTube.** The slide pinned on top with captions inside it; below, the
  station's title and brief and the chapters grouped by stage. A tap shows the controls (back,
  captions, speed, sleep timer, previous / play / next, time, full screen, a scrubber); they leave
  after 2.5 s and stay while paused. Double tap seeks 10 s and repeats add up; holding plays at
  2× (3× if the chosen speed is already 2×) without changing pitch. Full screen by button or by
  turning the phone; there, the chapters open as a sheet.
- **Around it.** Sound continues in the background with lock-screen controls; a call or pulled
  headphones pause it; the screen does not dim while playing. A sleep timer offers 15 / 30 / 45
  minutes, an hour, or the end of the chapter, and fades out over the last five seconds. Going
  back to the shelf stops playback — there is no mini player.
- **Settings.** Language (follow the system, English or 简体中文 — it takes effect at once),
  iCloud account state and `Sync now`, `Autoplay next chapter`, storage used, version,
  acknowledgements. Appearance follows the system.

**What is in iCloud is what is on the phone.** On the Mac, Settings → Data has one switch, off
by default: with it on, every finished book uploads. The list under it is there either way, so
what goes up can be chosen first: it shows what each book takes and lets any one be switched off —
which takes it out of iCloud and off the phone and keeps it out. On the phone, touching and holding a book that came from iCloud offers the same removal;
the Mac notices and switches that book off. The book itself always stays on the Mac. Turning the
main switch off stops uploading and stops syncing the place but leaves iCloud as it is; emptying
it is a separate, confirmed button.

Not in this version: keeping a book in iCloud but off the phone, a mini player, the companion, iPad.

---

## 6. Companion

The right pane is a chat companion. The reader can ask about the current book, about other books
they have finished, or about anything else. It reads local book material and searches the web
when that helps it answer accurately.

**Implemented in the desktop app**, with live model, book chat, finished-book recall and
public-page fetch verified against synthetic data. Firecrawl is the keyless search default;
Brave Search and Tavily are selectable with keys. The three search adapters have mock-response
tests; Firecrawl and Brave have had no live-query verification.

### 6.1 How heavy it is allowed to be

**Lightweight describes the architecture, not a feature list.** Against a coding or research
agent it has a small read-only tool surface and no subagents, shell, workspace editing, or task
orchestration. It still needs the ordinary chat machinery: multi-turn conversation, streaming,
interruption, tool calls and results, clarifying questions, persisted sessions, context
management, provider selection, clear errors. That machinery lives in an existing agent library
where it fits; Cairn owns the book context, the evidence rules, and the completed-reading
memory. Tools are added for a concrete reader need and stay read-only.

### 6.2 Evidence, not provenance theatre

Three rules, and the reasoning behind each, because each replaces an earlier rule that said the
opposite.

**Sources may be mixed in one answer; source-dependent claims carry a citation.** The old rule
rendered book-sourced and web-sourced content in separate blocks, never merged, so a reader who
has not read the book could still tell them apart. Readable prose can do the same job with
nearby citations. The model writes the whole answer — its synthesis is not an evidence source,
and general explanation can be uncited. What must never happen is an unsupported claim
masquerading as a quote or a sourced fact.

| Source | What it is | Cited as |
| --- | --- | --- |
| `book` | The current book's text or notes returned by a tool | The chapter; quote only from text actually fetched |
| `web` | A page fetched from a search result or a URL | Title and URL, next to the claim |
| `shelf` | A completed book's station (§7) | The book and the station |

**The model decides when to go outside.** The old rule made leaving the book the reader's click,
on the grounds that the model should not decide to leave on its own. `search_web` and
`fetch_web` are now model-directed; citations, not a permission gate, are what keep the answer
checkable. `ask_user` is for genuine ambiguity, never as a web-permission prompt. A query
carries the minimum context needed, not whole chapters.

**Claims about this book come from book material the tools actually returned**, not from
recollection of a known title. Exact quotations must occur in chapter text fetched in the
current context, and that is checked mechanically — the same principle
`PathQuality.unsourcedQuotes` applies to slides (§8). General questions may use the model's own
knowledge; uncertain or current facts get a search and a fetch.

Three things must not regress:

- **An active turn pauses background deck building** (`pauseBackgroundBuilds`), and resumes it
  when the model finishes or waits for the reader. An open chat must not pause generation
  forever.
- **Web access is visible.** Searches and fetched pages appear in the tool trail; source links
  stay attached to the answer.
- **The answer is in the interface's language**, not the book's. A reader with an English
  interface can walk a Chinese book: the narration stays Chinese, the conversation is English.
  The prompt names the language outright — "the reader's language" gets answered in whatever
  language the book and the tool results happen to be in (AGENTS.md invariant 11).

### 6.3 Book context ladder

What is resident on every turn, and what is one tool call away:

| Rung | Artifact | ~Size, 200k-word book | Reached by |
| --- | --- | --- | --- |
| 0 | The path — station titles and briefs | 1–2k | Resident |
| 1 | One line per chapter: index, title, gist | ~3k | Resident |
| 2 | The full `ChapterNote` — key points, quotes, figures | ~18k total | `read_notes` |
| 3 | Raw chapter text | the book | `read_chapter` |

Rung 0 *is* the book already: curated, ordered, and the thing the reader is walking. Rung 1 sits
beside it because the budget drops chapters, and a question about a dropped chapter must not be
answered with "that is not in this book".

An earlier draft kept every `ChapterNote` resident, on the argument that the notes *are* the
index and ~18k fits. For a single question that is the right trade — one call, everything
present, no round trip. A conversation changes the arithmetic: the 18k is paid **per turn**, so
twenty turns pay it twenty times. Splitting the note into a resident gist and a fetchable body
takes the standing context from ~20k to ~5k and loses nothing the model cannot ask for. The
index is still complete; only its depth is deferred.

### 6.4 Conversation compaction

The ladder bounds book material; compaction bounds past chat and tool output. They are different
problems, and a chat cannot be compacted with the book's chapter notes.

The complete session stays on disk while the model gets a bounded working context. Tokens are
estimated before each call — system prompt, book and shelf indexes, recent messages, tool
results, room for the reply. Approaching the model's limit, older turns fold into a short
structured summary and the most recent turns stay verbatim. **Cut only between user turns**, so a
tool call never loses its result.

The summary carries the reader's current goal, stable preferences stated in the chat, conclusions
reached, open questions, and the references those conclusions rest on. It may record which
chapters and pages were consulted; that does not make their contents available. Chapter text and
large web results leave the working context and are fetched again for a fresh quotation.

Compaction is automatic: a button the reader must press to keep a conversation working is a
defect with a label on it. The original messages are kept for history and audit and are never
overwritten. The trigger and the recent-turn budget come from the selected model's window and
measured usage, not a fixed token count. Individual tool results are bounded before they enter
the context, and a call is retried after compaction if the provider still reports overflow. A
failed compaction leaves the durable transcript intact and surfaces an error.

The pattern is borrowed, not invented:
[Claude Code's auto-compact](https://support.claude.com/en/articles/14552983-models-usage-and-limits-in-claude-code),
[nanobot's split of session history from durable memory](https://github.com/HKUDS/nanobot/blob/main/docs/architecture.md),
and [Pi's compaction design](https://github.com/ai-cre/pi-mono/blob/main/packages/coding-agent/docs/compaction.md)
for preserving whole turns and a full archive.

### 6.5 Tools

| Tool | Returns | Notes |
| --- | --- | --- |
| `read_chapter(idx[])` | Verbatim chapter text | Grounds current-book claims and quotations. N chapters per call, truncated per chapter |
| `read_notes(idx[])` | Full `ChapterNote`s | Rung 2. Cheaper than raw text when the question is what a chapter argues, not how it worded it |
| `recall_reading(query)` | Stations from other finished books | §7. `{ bookId, bookTitle, nodeId, title, brief }`, never another book's raw text |
| `search_web(query)` | Titles, URLs, snippets | Model-directed |
| `fetch_web(url)` | Bounded page text and metadata | Fetch before citing a page. Non-public and local addresses rejected |
| `ask_user(question, options[])` | The reader's choice | A material ambiguity context cannot settle |

The loop needs a tool-call limit, cancellation, and visible errors. A snippet alone does not
support a detailed factual claim — fetch the page the answer uses.

**Not built:** `load_skill(name)`, which would load a reader skill's instructions on demand. A
skill adds guidance, never new machine permissions.

Deliberately absent:

- **`find_chapters`** — the index is already in context. A search tool would be a round trip to
  re-derive what the model can read.
- **Anything that writes.** The companion cannot edit the path, rebuild a station, or change
  settings. A reading companion that can silently rebuild the thing being read is a different
  product with a different risk profile.

### 6.6 Data model

The pane renders chat text with inline references; a reference points at a tool result the
session actually received.

```
Message
  | { role: 'user',  text: string, selection?: string, atNode?: string }
  | { role: 'assistant', text: string, citations: Citation[] }
  | { role: 'tool', name: string, summary: string, resultId: string }

Citation = {
  span: [start, end]        // range in assistant text
  source: 'book' | 'web' | 'shelf'
  resultId: string         // evidence returned by a tool in this session
  ref: ChapterRef | WebRef | ShelfRef
}
```

- **A citation is accepted only if its `resultId` exists and its reference was in that result.**
- **`role: 'tool'` messages are kept and shown**, collapsed by default, so searches and book
  reads stay inspectable. Their detailed output can be left out of the compacted context.
- **A shelf reference cites a station, not a page.** `ShelfRef = { bookId, bookTitle, nodeId,
  nodeTitle }` — enough to open that station and check, which is the only version of "you read
  this before" worth making.
- **`atNode`** replaces the old anchored / whole-book split. Where the reader was is context, not
  a separate code path.

One conversation per book, stored beside it (`books/<id>/chat.json`), for the same reason the
resume position is: a path is walked over several sittings. A conversation therefore **syncs with
the book**, and it contains quoted chapter text, so it inherits the question `chapters.json` has
(see the iCloud note in AGENTS.md). The full transcript, the tool audit trail and the compaction
summaries are separate records from the working context; a summary never replaces the original
chat or the references needed to inspect an earlier answer.

The ask log (`store/asks.ts`, `stationHeat`) survives from the retired ask pane: where the reader
stopped to ask is still the closest thing to a quality signal this tool has, and a conversation
knows which station it was on.

### 6.7 Why no retrieval inside one book

The pipeline is **sweep-driven**: every chapter is read exactly once, in a fixed order. Retrieval
answers "find the relevant piece among many", and here nothing is picked — it is swept. The
chapter index fits: ~18k tokens for a 200k-word book, ~42k for a 500k-word one, and only rung 1
of it is resident. The model picks chapters by reading the index it already has.

What crosses the line is a serial of a thousand chapters or more, and even there retrieval is not
the answer. `map` is linear in chapter count, so 2300 chapters is roughly 580 calls, and skipping
them would leave `reduce` ordering stations from chapters the model never read. The answer is
**hierarchical summarisation**: fold every 20 `ChapterNote`s into a volume note, let `reduce`
read the volume list (2300 chapters → 115 entries), and drill down for detail. About N/20 extra
calls, and just another `runJob`.

### 6.8 Why no MCP

One web search is a function, not a protocol. MCP earns its keep when the tools are many and
unpredictable — Obsidian, Zotero, later. We also do not use the model's own built-in search:
knowing what was searched and which sentence came from the web is the whole value of the
citation rules in §6.2.

### 6.9 Open questions

1. **Cost per conversation.** §6.3 takes the standing book context from ~20k to ~5k per turn,
   while compaction adds occasional model calls. Measure both before choosing a default model.
2. **Which provider is the default**, and whether the companion and the pipeline should share
   one. The pipeline needs strict schema support; the companion needs good tool calling.
3. **Does the conversation sync?** It contains quoted book text (§6.6); the iCloud note in
   AGENTS.md applies unchanged.
4. **What "related" means in `recall_reading`.** Matching on the shelf index is a model
   judgement, and a model asked for a connection will produce one. The citation rule in §7 makes
   a bad connection checkable, not rare. Whether that needs a relevance floor — or just a reader
   who can say "stop doing that" — is unresolved.
5. **Streaming and citation timing.** Draft text streams, then validated citations attach before
   the answer counts as complete. The UI needs an unambiguous provisional state, so an
   unsupported draft claim is not mistaken for a cited one.

---

## 7. Memory across books

The companion recalls stations from paths the reader has finished, cited back to each book and
station. Using that memory while *generating* new paths or slides remains planned.

### 7.1 The recap is the memory

It costs almost nothing, because the artifact already exists. `pipeline/recap.ts` reads the
*path* — not the book — and writes a closing station whose whole job is "what this book finally
argues". That is a compressed account of a finished book, generated once. Nothing new needs
summarising, so the shelf index is derived rather than stored:

```
ShelfEntry = {
  bookId, title, author?
  finished: boolean        // LibraryEntry.complete, and the reader reached the recap
  claim: string            // the recap station's brief
}
```

Resident cost is ~30 tokens a book. Fifty books is ~1.5k, smaller than one chapter note. Other
books' station titles and briefs are fetched on demand, never resident.

### 7.2 Only books actually walked

`finished` means the path completed **and the reader got to the end of it**, which `resume.ts`
already knows. A book merely added to the shelf is not a book the reader has read, and "you met
this in X" about a book they never opened is a lie that costs the feature its credibility the
first time it happens.

### 7.3 A shelf citation must point at a returned station

Prior reading is a source like any other (§6.2), and the same mechanical rule applies: the
station must be one `recall_reading` returned in this conversation. Cross-book connection is
where a model most wants to confabulate — asked to find a resonance it will always find one — so
the citation is what separates a real connection from a flattering one. An answer with no shelf
citation is a normal answer; the companion is not scored on how often it connects.

### 7.4 It never decides structure

Station count and ordering come from the current book's real text alone. The companion has no
write tools (§6.5), which makes this hold by construction rather than by discipline. And it
stays local, like everything else.

### 7.5 Why no vector store yet

An earlier plan expected one, on the argument that retrieval across a library read over years
does not fit in context. With the ladder in §6.3 it fits for far longer: a shelf line is ~30
tokens, the model reads the shelf index the way it reads the chapter index, and drills into a
specific book's path with a tool. The threshold is roughly **two hundred finished books**, where
the resident index reaches ~6k and embeddings start to earn their keep. Until then a vector store
is a dependency bought before it is needed.

`ChapterLocator` already returns a `ChapterRef` with an optional `bookId` — that is the seam.

---

## 8. Quality signals

Every run records four numbers on the `LibraryEntry`, all of which should be 0:

| Signal | Meaning |
| --- | --- |
| `dropped` | Stations citing chapters that do not exist |
| `retries` | Times the path was regenerated for overrunning the budget |
| `failed` | Decks that never built |
| `unsourcedQuotes` | Quote slides whose text was not found in any chapter excerpt |

They are recorded, not recomputed. With no completion metric, they are the only objective way to
tell whether a prompt change made things better or worse.

---

## 9. Boundaries

| Not doing | Why |
| --- | --- |
| Sharing / publishing / accounts / telemetry / a networked server | Personal tool |
| DRM removal, KFX | Not ours to break; KFX is undocumented. A DRM'd Kindle file is refused by name |
| OCR of scanned PDFs | A scan has no text layer; OCR brings a model runtime and its own errors. A text PDF is read, with bookmarks as chapters and headings as the fallback. Multi-column layouts are read in content-stream order and may interleave |
| mp4 rendering | The slide player replaces it |
| Image generation | Abstract ideas do not yield informative illustrations |
| MCP | One search is not worth a protocol |
| Spaced repetition | Conflicts with "you walk it, then you are done" |
| Retrieval **within** one book | The index fits in context (§6.7). Retrieval **across** books is a separate question, and the answer there is yes at ~200 finished books (§7.5) |

**Not built yet, but in scope:** the sync helper shipped inside the packaged Mac app (the iCloud
switch works in a development build only until then); the `world` layout (a novel's setting); the plain-text
rendering of a deck; cross-book memory (§7); pruning the pipeline cache — content-addressed keys
mean every regeneration adds a fresh set of entries and audio, and nothing removes the old ones.
