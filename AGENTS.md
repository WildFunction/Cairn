# Cairn

Turn an ebook you already own into a path you can walk to the end.

A path is a sequence of **stations** grouped into **stages**, closing with a recap station. Each
station is a short deck of generated slides with narrated audio, sourced from the book's real
text and traceable to the chapters it came from. The reader picks one of four **budgets**; the
station count and coverage follow from it.

Slides are data, not video — the player is one rendering of them, and the only one built so far.
A plain-text rendering is a possibility the data model leaves open.


## Setup and commands

```bash
bun install
cd apps/desktop && bunx electrobun prepare   # once per checkout; projects the SDK into .hutch/

bun test                                     # every package
bun test packages/core/tests/fit.test.ts     # one file
bun run typecheck                            # all five projects, strict
bun run add-book <file>                      # the app's book builder, from the terminal
bun run replay <bookId> [file]               # list recorded model calls, or re-send one
bun run eval --judge deepseek-v4-pro         # judge a pipeline change against the accepted baseline
bun run sync-book <bookId> | --all           # push finished books to the owner's iCloud; needs the helper below

cd apps/desktop
bun run dev       # Vite only: the three panes, no model, no shell
bun run build     # bundle the webview — catches node:* leaking into it
bun run start     # the real desktop app
bun run package   # a distributable .app, signed when ELECTROBUN_DEVELOPER_ID names an identity
bun run sync-helper   # the Swift helper that talks to CloudKit; needs Xcode signed in to the team

bun run ios:sample   # export the built-in book from the library into the iOS app (git-ignored)
bun run ios:stage    # build the iOS app's slide page (git-ignored)
cd apps/ios && xcodegen                      # regenerate Cairn.xcodeproj after adding or moving a file
cd apps/ios/CairnKit && swift test           # the phone's logic, on the Mac, no simulator
xcodebuild test -project apps/ios/Cairn.xcodeproj -scheme Cairn \
  -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.1' CODE_SIGNING_ALLOWED=NO
```

The iOS app needs both generated folders before it builds, and a build phase says which is
missing. `ios:sample` reads *The Art of War* (`the-art-of-war-ed02db`) from the library, so a fresh
clone needs that book generated first.

`bun run start` needs a model — an API key, or a `codex login` for the OpenAI Codex provider — and a network path to the narration service. Outside-the-book search defaults
to keyless Firecrawl; Brave Search and Tavily are selectable with keys. `bun run dev` needs none of them and says so in the
answer pane rather than faking a reply.

| Environment variable | Effect |
| --- | --- |
| `CAIRN_DATA_DIR` | Where generated books live. Default `~/Library/Application Support/Cairn/` — never beside the app, whose cwd is rebuilt on every `electrobun dev` |
| `CAIRN_TRACE=1` | Record every model call (prompt, schema, raw reply, ms) under the book's cache. Off by default: a trace of the map stage is the book's text a second time |
| `BRAVE_SEARCH_API_KEY` | Optional Brave Search key; required when Brave is selected |
| `FIRECRAWL_API_KEY` | Optional Firecrawl key; without it, search uses Firecrawl's limited anonymous tier |
| `TAVILY_API_KEY` | Optional Tavily search key. Read in the main process only |
| `WEREAD_API_KEY` | Optional WeChat Reading key: popular highlights while a book builds, shelf covers, the reader's WeChat Reading shelf on the home screen, and a first station taken from their progress. The settings panel gets one by QR sign-in instead; this stays for a machine configured the old way. Main process only |

**The settings panel writes `settings.json` beside the library**, and both sources are honoured.
The search-provider picker defaults to keyless Firecrawl. Existing Tavily keys keep Tavily selected
on upgrade; a reader can switch providers explicitly. Every key field starts out as
`$NAME` — `$BRAVE_SEARCH_API_KEY`, `$OPENAI_API_KEY` — and a value in that form reads the variable;
anything else is the key, and empty is none. A file written before this, where empty meant "read
the environment", is upgraded on read (`upgradeLegacyKeys`). Tracing is on if *either*
`CAIRN_TRACE=1` or the stored switch says so — a machine
configured the old way does not silently stop working. The switch is shown in dev builds only; a
release build turns a stored one off at launch, since nothing there could turn it off again. `main/settings.ts` folds the two into one
answer, so nothing downstream reads `process.env` for these.

The reader's own preferences — interface language, theme, text size, default speed — never reach
the main process at all. They live in `localStorage` (`packages/ui/src/settings/prefs.ts`),
because everything they affect is drawn by the webview.

The narration service is reached **before the first model call**, because synthesis runs last
and an unreachable one would otherwise surface only after paying for every station's slides.

## Project structure

```
packages/
  core/          Domain types, parsing, pipeline, storage — no framework imports
    parse/       epub.ts  pdf.ts  mobi.ts  docx.ts  txt.ts  markdown.ts  notes.ts  chunk.ts  text.ts
                 pdf-layout.ts: lines back into prose · mobi-decode.ts: PalmDB and its
                 compressions · html-blocks.ts: heading split shared by EPUB and MOBI
    pipeline/prompts/  Every prompt, one file per language. `en` is the type's
                 source, so a prompt added there fails the build until `zh` has it
    errors.ts    Named failures (`CairnError`). The reader's language is the
                 renderer's business, so nothing here writes a sentence.
    llm/         Provider *interface* + tracing wrapper. No implementations.
    pipeline/    job.ts (batch state machine), scheduler.ts (interactive one),
                 map/classify/reduce/slides/tts stages — all pure or interface-driven
    books/       builder.ts: adding, resuming and removing a book — the one
                 composition of pipeline + library the app and `add-book` share
    eval/        What `bun run eval` runs: code metrics, model judges, and the
                 verdict. Never imported by the app
    store/       library.ts (layout, webview-safe), library-disk.ts (the library
                 on disk: one instance per root), file-backed JobStore
    sync/        What a book is in iCloud (book.ts), the push that sends it
                 (push.ts), the pipe to the helper (wire.ts), the reader's place
                 and which copy wins (progress.ts, position.ts), and keeping
                 iCloud in step with the library once switched on (auto.ts).
                 Pure: the cloud is the `CloudStore` interface
    runtime/     Everything that spawns a process or talks to a service:
                 codex-cli.ts, edge-tts-ws.ts, trace-dir.ts, cloudkit-helper.ts
  ui/            Shared React components and design tokens; slide layout renderers
    i18n/        Two dictionaries and the type that keeps them in step
    settings/    The settings panel, and the preferences the webview owns
apps/
  desktop/       Electrobun shell — the only place books are made. Authoring and playback in one window.
    src/main/    Main process. `index.ts` is the composition root: it builds the
                 narrator, the book builder and the RPC handlers and passes them
                 in. `store.ts` holds the process's one `Library`.
    src/shared/  Types both sides import; `schema.ts` is the one RPC contract
    sync-helper/ CairnSync, a Swift helper app: the only process with the iCloud
                 entitlement. One JSON request in, one reply out, per call
  ios/           The iPhone player, UIKit in Swift. `project.yml` is the source;
                 Cairn.xcodeproj is generated from it by XcodeGen
    Cairn/       The app target: App/ (composition root), Shelf/, Player/,
                 Settings/, Sync/, Theme/, Resources/
    CairnKit/    A Swift package with no UIKit: models, the library on disk, the
                 playback rules, the player model, the iCloud mapping
    stage/       The slide page the app shows in a web view: the desktop's own
                 renderers, driven by `load` / `sync` / `set` from Swift
scripts/         add-book.ts, replay.ts, sync-book.ts, export-ios-sample.ts, typecheck.ts — thin drivers, no logic of their own
```

**The dependency arrow points one way.** `pipeline/` and `llm/` depend on interfaces
(`LlmProvider`, `Narrator`, `JobStore`, `TraceSink`); `runtime/` implements them, never the
reverse. Test for whether a file belongs in `runtime/`: does it import `node:*` for anything but
path arithmetic?

**A second, sharper rule for anything the webview also imports.** Path arithmetic is allowed in
`core`, but a module the *renderer* pulls in may not import `node:*` at all — Vite externalises
it and the build fails at bundle time, after every typecheck has passed — nor a main-process
dependency, which passes the bundle and simply ships. `pipeline/voice.ts` and `parse/format.ts`
exist for exactly this: the player needs the voice defaults and the accepted file types, and
their neighbours import `node:path` and JSZip. `apps/desktop/tests/webview/imports.test.ts`
walks the renderer's real import graph from `main.tsx` and fails on either, so `bun test`
catches it now; the bundle stays a separate check. The phone's slide page (`apps/ios/stage`) is a
second renderer under the same rule, and the same test walks it.

**The phone never models a slide.** Swift hands a deck to the slide page as the text it was
stored as, and which slide, items and caption are on screen at a given second comes from
`frameAt` in `packages/ui/src/slides/frame.ts` — the function the desktop's `DeckPane` calls too.
A layout added on the Mac reaches the phone by rebuilding the page.

**Process-scoped objects are built in one place.** `main/index.ts` constructs them and passes
them to what needs them — the pattern llm-space's `start-desktop-app.ts` uses. A new manager is
a parameter, not a module-level `let` with a setter. The companion's tools still bind `store.ts`
at import; that is the next thing to move, not a pattern to copy.

## Code style

- TypeScript strict, `noUncheckedIndexedAccess` on. No `any`, no non-null assertions on external
  data.
- Immutable data. Functions return new objects; `readonly` on domain types.
- Small focused files. Extract rather than grow past ~400 lines.
- Errors are explicit and typed. `ParseError` carries a `code` so the UI can show something a
  human understands. Never swallow an error.
- Code, identifiers, doc comments and everything under `docs/` are written in **English**.
- Product-facing copy targets **Chinese and English**. Do not bake a language into logic; keep
  user-visible strings where they can be swapped.
- **Follow `karpathy-guidelines`**: state assumptions before coding, write the minimum that
  solves the problem, keep changes surgical, define a verifiable success check per step.
- Visual changes follow [`docs/DESIGN.md`](docs/DESIGN.md). Re-measure its contrast tables after
  changing any colour.

### Change scope and review

- Limit implementation to the requested behavior and contracts it directly affects. Add an
  abstraction, configuration option, or fallback only for a concrete need.
- In code review, report actionable defects with a location, a concrete failure path, and its
  impact. Do not present style preferences or hypothetical edge cases as defects.
- Start with checks relevant to the change. Expand investigation for a concrete failure or
  unresolved risk. Before committing, run the full checks listed below.

### Comments

The default is **no comment**. Code that needs a paragraph usually needs a better name or a
smaller function. Write one only when all three hold:

1. It explains **why**, not what.
2. The why cannot be recovered from the names, the types, or the test.
3. Someone changing this code would get it wrong without it — a rejected simpler approach, a
   non-obvious ordering constraint, a bug this line prevents.

Length ceilings:

| Position | Ceiling |
| --- | --- |
| Inline, or above a statement | **1 line** |
| Above a function, type or constant | **3 lines** |
| File header | **8 lines**, and only where the file carries a decision (`budget.ts`, `fit.ts`) |

Past the ceiling the explanation belongs in `docs/`, and the comment points at it.

Never: restating the signature; narrating steps (`// loop over chapters`); commented-out code; a
`TODO` with no name attached; re-commenting lines the diff did not touch.

```ts
// WRONG — restates the code, and three lines to say nothing
/**
 * Clamps the given minutes value to the budget's per-node range.
 * @param minutes the minutes
 * @param budget the budget
 */

// RIGHT — the constraint that is not visible from here
/** A station that cannot make one thing clear is worth nothing, so the floor is real. */
```

## Testing

- `bun test` for everything; `bun test <path>` for one file or package.
- Tests mirror source paths: `src/parse/chunk.ts` → `tests/parse/chunk.test.ts`.
- **Five separate typechecks must pass, not one**: `packages/core`, `packages/ui`,
  `apps/desktop/tsconfig.json`, `apps/desktop/tsconfig.main.json`, `apps/ios/stage/tsconfig.json`.
  `bun run typecheck` runs all five and names any it skipped; a script that silently checks one
  of four is how the desktop projects went unchecked.
- **The phone has two more**: `swift test` in `apps/ios/CairnKit` (Swift Testing) and
  `xcodebuild test` for the `Cairn` scheme (UI tests, XCTest). The UI tests read the player's
  state from a Debug-only accessibility element, `player.probe`.
- **Two languages, one contract.** `packages/core/tests/sync/fixtures/` holds a synthetic book
  and the position-merge table. The TypeScript tests assert the Mac still writes them; the Swift
  tests decode and apply them. Regenerate the book fixture with `UPDATE_FIXTURES=1` only for an
  intended change, and deploy the CloudKit schema before shipping it.
- Pure logic is extracted so it can be tested without a browser or a model — `caption.ts`,
  `split.ts`, `fingerprint.ts`, `budget.ts`, `scheduler.ts`, `trace.ts`. This is why `runtime/`
  exists: a stage that shells out cannot be tested without the tool installed.
- A change to cache keys, budgets or caption timing needs a regression test **that would have
  caught the original bug**, not just a test that the new code runs.
- Slide overflow cannot be unit-tested. `?gauntlet` in `bun run dev` draws every layout at its
  worst; check there.

### Judging a pipeline change

`bun test` proves the code runs; it cannot say whether a path got better. `bun run eval` can. Run
it after any change to a prompt or to classify, reduce or recap, and put the verdict in the commit
message. Method and rationale: [`docs/EVAL.md`](docs/EVAL.md).

- It re-runs classify + reduce on the library's frozen chapter notes for the books in
  `scripts/eval-set.json`, scores each path with code metrics and model judges, and compares it
  blind against the baseline accepted with `--accept`. Accept a run when its change is merged.
- **Judge with a stronger model than the one generating** (`--judge`). A flash judge misread paths.
  After switching the generating model, accept a fresh run as the baseline before judging code.
- **Trust a verdict, not a record.** It needs a significant sign test and at least three new paths;
  a guard (faithfulness, coverage, budget) dropping past the noise band makes it *worse* whatever
  the record says. The unchanged pipeline once went 2–5 against itself.
- **Read the per-book lines, and read "Tried and rejected" in `docs/EVAL.md` before a fix.** Three
  attempts at Pro Git's front-loading failed there, and the front-loading turned out to cost little.

## Invariants

Load-bearing. Breaking one silently undoes a decision that took real work to reach.

1. **The reading budget is the constraint; the station count is the result.** The reader picks
   one of four budgets, and `budgetsFor()` derives their length from the book's own word count
   and chapter structure — the rungs are fixed in intent (skim / gist / read / walk it all), not
   in minutes. A tighter budget drops whole stations rather than making each one shallower.

2. **Structure comes from the real text, never from the model's pretraining memory.** Station
   count and ordering derive from the table of contents plus the per-chapter notes from the map
   stage. Memory-derived structure fails silently on long-tail books, and a fabricated station
   looks exactly like a real one.

3. **Every station carries `sourceChapters`.** The cheapest hedge against hallucination: any
   claim can be traced back to the text it came from.

4. **A quotation of the book must be real.** The companion's prompt asks for no citation
   markers — they cluttered the pane — so `verifyBookQuotes` checks every quotation attributed
   to the book against the chapter text fetched that turn instead. See [`docs/PRD.md`](docs/PRD.md) §6.2.

5. **The pipeline reads the full text exactly once.** Map produces per-chapter notes — prose
   plus the structured material the chart layouts need (`figures`, `contrasts`, `sequences`,
   `relations`, `cycles`, `ranks`, `quadrants`, `overlaps`, `causes`) — and every downstream stage reads the notes, not the book. Map's task ids are
   positional, so notes cached before a field existed stay valid and stay thin; a book wants its
   cache cleared to gain one. Re-reading per stage multiplies cost ~5x for
   no gain. `pipeline/recap.ts` goes further and reads the *path* — the station briefs `reduce`
   already wrote — so closing a book costs no pass over the notes either.

6. **Long-running work goes through `runJob` or `scheduler.ts`.** Near a hundred model calls per
   book. Results persist per task, concurrency is capped, failures are isolated and retried with
   backoff, and an interrupted run resumes where it stopped. `runJob` is the batch path (fixed
   order: the map stage); `startDeckScheduler` is the interactive one (re-orderable, pausable:
   every deck). Both are driven by `books/builder.ts`, for the app and `add-book` alike, and the
   cache lives under the library's `.cache/`, so a book half-built by either resumes in the
   other. A station counts as ready only once `onReady` has installed it.

7. **The full list of stations exists before the first one plays; only their decks arrive
   progressively.** `reduce` needs every chapter note before it can choose and order stations,
   so the path cannot be streamed — a path that grew as you read would let arrival time decide
   the station count instead of the budget, breaking invariant 1. The decks *are* independent,
   and that is where the wait lives: `generate` returns once station 1 is playable, and the rest
   build behind the reader in walking order, one at a time at first and further ahead as they get
   deeper (`lookaheadFor`) — a reader at station six is far likelier to finish than one at station
   one, so buying ahead stops being speculative, and past halfway the rest is built as fast as the
   machine sensibly allows. Progress is written to the library index on every station, not only at
   the end: a shelf that reads 0 of 15 for a whole run is worse than no count. A station with no deck yet shows as pending, never
   hidden.

8. **Cache keys derive from content, never from position.** `reduce` re-runs on every generation
   and the model is not deterministic, so station `n0` routinely means a different station than
   last time — and one audio directory is shared by every budget. A positional key let one
   budget's synthesis overwrite another's, then shipped the right subtitles over the wrong voice
   track. `deckKey()` in `pipeline/build.ts` fingerprints the station's content instead.

9. **A book keeps the voice it was built with.** The voice is part of `deckKey`, and that one
   key protects both halves of `buildNode` — the model call that writes the script *and* the
   synthesis that speaks it. So changing the voice does not re-synthesise a book, it rebuilds
   it: every station is a cache miss and costs a fresh `slides` call. The voice is therefore
   resolved **once**, when the book is added, and recorded on its `LibraryEntry` along with the
   language it was detected as. Changing the setting only affects books added afterwards. A
   half-built book resumed after a change keeps its original voice, or it would end up in two.
   An entry with no recorded voice was built with `DEFAULT_VOICE`, and must be resolved to that
   and not to the current setting.

10. **The language a book is narrated in comes from the book, not from the interface.** A reader
    with an English interface can walk a Chinese book, and it stays Chinese. `parse/language.ts`
    counts the text and uses `dc:language` only when there is too little of it to count —
    conversion tools routinely stamp `en` on a Chinese translation, and trusting that would
    narrate the whole book in the wrong voice for the price of a full generation.

11. **A prompt states the language it wants back.** The prompts were Chinese and said nothing
    about output language, so the model followed the system prompt — which made an English book
    come back in Chinese, silently. Every stage now takes the book's `ContentLocale` and loads
    its prompts from `pipeline/prompts/`. Thread it through any new stage; a stage that defaults
    to `zh` and is never passed a locale is the bug coming back.

12. **English narration is commissioned in words, Chinese in characters.** `CHARS_PER_SECOND` is
    per language and measured (zh 4.9, en 17.0 — three samples each, recorded in `tts.ts`).
    English prompts ask for a word count because a model counts words far more reliably than
    characters. Re-measure rather than adjust by feel: nothing downstream checks the length, so
    an error here just makes every station the wrong length.

## Security

- **No secret is hardcoded.** Keys come from the environment or the settings panel. The
  selected search service receives model-written queries, which may contain brief book context,
  not whole chapters.
- **With a WeChat Reading key, a book's title and author leave the machine.** They are sent to
  `i.weread.qq.com` to match the book; its id then fetches highlights, progress and chapter
  titles. Chapter text never goes. What comes back is kept in `books/<id>/weread.json` and
  `cover.*`; without a key nothing is sent. Every call degrades to nothing on failure.
- **QR sign-in goes through the WeChat Reading website, not the official skill.**
  `main/weread/login.ts` follows the site's own login (`/api/auth/*`) to read the account's key
  from `/api/skills/apikeyGet`, asking to create one only when none exists. The key and the
  account's display name are kept in `settings.json`; the web session — cookies, access and
  refresh tokens — is held in memory for one login and dropped. Nothing here may use that session
  to read a book's text: that is the reverse-engineered reader, and it is DRM removal by another name.
- **The loopback server is scoped, not open.** `main/library-server.ts` binds `127.0.0.1` on a random
  port (because `<audio>` needs a range-requestable URL), answers GET and HEAD only, serves one
  directory, and requires a per-launch token as the first path segment. Traversal is rejected
  before the join and re-checked against the root after, because a decoded segment can contain a
  separator.
- **A book's text stays local; the rest leaves only when its owner syncs.** `.gitignore` keeps
  the library and pipeline cache out of the repository. Syncing a finished book sends its path,
  decks, narration audio and cover to the owner's private iCloud database (`iCloud.dev.jasper.cairn`)
  and nowhere else. `chapters.json` and `notes.json` never go: `sync/book.ts` is not handed them.
  Nothing is uploaded until the owner turns on `icloudSync` in settings (off by default) or runs
  `bun run sync-book`. A book switched off there, or removed on the phone, is taken out of iCloud
  and recorded in `sync.json` beside the library so it is not uploaded again.
- **The reader's place travels too, for a book in iCloud.** A `Progress` record in the book's zone
  holds the station, the second, when, and which kind of device (`Mac`, `iPhone`). The phone and
  the Mac each write it and the newer one wins. Nothing is written for a book that was never
  pushed: the Mac never creates a zone to hold a place.

## Commits and pull requests

- Conventional commits: `<type>: <description>`, type one of
  `feat` `fix` `refactor` `docs` `test` `chore` `perf` `ci`.
- One reason per commit. A formatting sweep and a behaviour change do not belong together.
- Before committing: `bun test`, all five typechecks, and `cd apps/desktop && bun run build`
  pass, and no generated book, audio file or cache entry is staged. The bundle is a separate
  check on purpose: the import-graph test covers the webview's imports, the bundle covers
  everything Vite does with them.
- A commit that fixes a silent bug names the invariant it restores.

## Boundaries

**Out of scope:** OCR (a scanned PDF is refused as `scanned_pdf`) · DRM removal (`drm_protected`) · KFX · MP4 rendering · image generation · spaced repetition · user
accounts · telemetry · any networked server component.

**Planned, and the reason several decisions look the way they do:** books generated on the Mac
sync (iCloud) and are read on an iPhone. The upload (`sync/`, from the settings switch or
`bun run sync-book`), the phone app (`apps/ios`) and the place syncing both ways exist; shipping
the helper inside the packaged app does not — until then the Mac's side of sync works in a
development build only, and the switch says so elsewhere. Four consequences bind:

1. **The phone can only be a player.** An iOS app ships through the App Store, so it *is*
   sandboxed: no subprocess, no `codex`. Generation stays on the Mac. This is
   already the shape the data model implies — "slides are data, not video" — so keep the split
   clean rather than letting anything player-side depend on a generation-side artifact.
2. **A book must be movable.** Everything the player needs lives under `books/<id>/`, and
   nothing persisted there may hold an absolute path — see `NodeDeck.audioPath`. `.cache/` is
   generation-side and never travels.
3. **The synced book carries no chapter text.** `chapters.json` is the full text of a book the
   owner bought, so it and `notes.json` stay on the Mac. The cost is accepted: no anchored
   questions on the phone, which is a player and nothing more.
4. **Production creates no schema.** CloudKit's Development environment makes record types as
   they are first written; Production refuses every write until the schema is deployed from the
   CloudKit Console, and a type deployed there can never be removed. Deploy before a release
   that changes `sync/book.ts`, and never write a throwaway type outside Development.

**In scope, not built:** the `world` layout (a novel's setting); the plain-text rendering of a
deck; cross-book memory of what the reader has already walked
([`docs/PRD.md`](docs/PRD.md) §7).

**Ask before:** changing `tokens.css`, cache key derivation, budget arithmetic, or anything that
sends data off the machine.

## Agent skills

Matt Pocock's skills live in `.agents/skills/`; `.claude/skills/` links to them. Codex and
Claude Code use the same project-level copies. They are installed per machine and git-ignored;
`skills-lock.json` records which ones. Only `cairn-desktop-verify`, written for this project, is
tracked.

### Issue tracker

Specs and issues live in local Markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage roles. See `docs/agents/triage-labels.md`.

### Domain docs

Use one root `CONTEXT.md` for Cairn's product vocabulary. See `docs/agents/domain.md`.

## Reference

| Document | Read it when |
| --- | --- |
| [`docs/PRD.md`](docs/PRD.md) | Before changing scope. The current product definition, organised by module. §6 is the companion |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Module boundaries, data flow, dependency choices, and the decision record behind them |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Before touching `tokens.css` or any CSS that affects appearance |
| [`docs/EVAL.md`](docs/EVAL.md) | Before changing a prompt or a stage after map, and before trusting an eval verdict |

Two projects worth borrowing from:

- **DeepTutor** — for *features*: how a reading session is structured, how sources are shown, how
  a long piece of material is paced.
- **[llm-space](https://github.com/deer-flow/llm-space)** — for *code architecture and
  multi-platform packaging*. It ships on both macOS and Windows; its monorepo boundaries are
  where this repo's `packages/` + `apps/` split came from.

## A note on the LLM provider

Generation goes through **pi-ai**, which already knows each vendor's wire format and — the part
that decides quality here — which of their models will hold a reply to a JSON Schema. The
pipeline asks for structured output on roughly a hundred calls per book, so guessing that per
vendor is how a schema quietly becomes a suggestion. `shared/providers.ts` reads pi-ai's
generated catalog as plain data; the settings panel lists constrained models first and the rest
after them.

Two details that are load-bearing and not obvious:

- **The forcing value for a tool call is spelled differently per adapter.** `ToolChoice` is
  typed `'auto' | 'none'`, but OpenAI-shaped APIs take `'required'` and the rest take `'any'`.
  `forcedToolChoice` in `main/pi-provider.ts` is the only place that knowledge lives.
- **`completeSimple` resolves an error rather than rejecting.** Its `stopReason` carries the
  outcome, including `'length'` for a truncated reply. Not reading it turns a failed call into
  an empty one.

**Which provider answers follows llm-space.** `openai-codex` is a provider like any other,
signed in with whatever `codex login` left in `~/.codex` (OAuth token first, then an API key);
the settings panel shows no key field for it. `main/route.ts` picks the default if it has
credentials, otherwise the first provider that does, by name — generation and the companion
alike. With none, generation fails with `no_model`; nothing falls back to the `codex exec`
CLI, which only `bun run replay` still uses. That CLI carried ~18k tokens of harness per call,
which is why the map stage batches chapters (`DEFAULT_BATCH_SIZE`).

Everything stays behind `LlmProvider`, so swapping any of this remains a one-file change.
`packages/core` never imports pi-ai; `main/pi-provider.ts` does.
