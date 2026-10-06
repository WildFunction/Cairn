# Cairn — architecture

2026-09-22 · how the parts fit together, and why

[PRD.md](./PRD.md) says what each module does. This says where the boundaries are, which way
the dependencies point, and which arguments produced them. The decision record at the end (§8)
holds the reasoning behind choices that are easy to undo by accident.

---

## 1. Shape: one local desktop app

```
Electrobun window
├── main process (Bun)                         webview (React)
│   ├── index.ts           composition root
│   ├── rpc.ts             handlers  ◄───────► bridge.ts
│   ├── inspect.ts         parse-only preview  App / AddBook / Home
│   ├── library-server.ts  loopback files      packages/ui panes + slide layouts
│   ├── provider.ts        generation model route
│   ├── companion/         chat agent, tools, session, web search
│   └── store.ts           the process's one Library
└── packages/core   domain + pipeline; the webview imports only its node-free modules
```

Everything that touches a process, the filesystem or the network lives in the **main process**.
The webview renders and sends RPC calls. That split is not ceremony: it is what keeps
`TAVILY_API_KEY` out of the webview, and it is why the bridge exists at all.

**Mac first, Windows intended.** Nothing in `core/` is platform-specific; the platform-bound
parts are `runtime/` (spawning `codex`) and the Electrobun packaging. The
[llm-space](https://github.com/deer-flow/llm-space) monorepo is the reference for both the
`packages/` + `apps/` boundaries and for shipping the same codebase on macOS and Windows.

**No web build.** Generation writes to disk and the fallback `codex exec` needs a local
process; nothing is shared, so there is nothing to deploy.

**And a player on the phone.** `apps/ios` plays what the Mac generated, from the owner's private
iCloud database. It generates nothing and holds no chapter text:

```
Mac                                            iPhone (UIKit)
bun run sync-book ─► CairnSync helper ─┐       CloudKitBooks (CKSyncEngine)
main process ◄─ position ─► helper ────┼─────► LibrarySync ─► books/<id>/ on disk
                                       │       PlayerModel ─► AudioEngine (SwiftAudioEx)
                   iCloud.dev.jasper.cairn     PlayerViewController ─► WKWebView (stage page)
```

---

## 2. Package boundaries

```
packages/core/     Domain types, parsing, pipeline, storage — no framework imports
  parse/           epub.ts  pdf.ts  pdf-layout.ts  mobi.ts  mobi-decode.ts  docx.ts
                   html-blocks.ts  txt.ts  markdown.ts  chunk.ts  text.ts
                   format.ts (accepted types; webview-safe, unlike the parsers)
  llm/             LlmProvider interface + tracing wrapper. No implementations.
  pipeline/        map · classify · reduce · recap · slides · tts · build ·
                   budget · caption · fingerprint
                   job.ts (batch state machine) · scheduler.ts (interactive one)
  books/           builder.ts — adding, resuming, removing a book; progress.ts
  companion/       citation and chat contracts, web search interface
  store/           library.ts (layout) · library-disk.ts (Library) · file-store.ts
  runtime/         codex-cli.ts, codex-credentials.ts, edge-tts-ws.ts, trace-dir.ts
packages/ui/       React components, design tokens, slide layout renderers
apps/desktop/      Electrobun shell: main process + webview; sync-helper/ (CloudKit)
apps/ios/          The iPhone player: Cairn/ (UIKit app) · CairnKit/ (Swift package, no
                   UIKit) · stage/ (the slide page, a second webview entry)
scripts/           add-book.ts, replay.ts, sync-book.ts, export-ios-sample.ts, typecheck.ts
```

**The dependency arrow points one way.** `pipeline/` and `llm/` depend on interfaces —
`LlmProvider`, `Narrator`, `JobStore`, `TraceSink`. `runtime/` implements them. Nothing in
`pipeline/` imports anything in `runtime/`.

The test for whether a file belongs in `runtime/`: **does it import `node:*` for anything but
path arithmetic?** If yes, it is runtime, and the pipeline reaches it through an interface.

This is what makes the pipeline testable without a model or a TTS binary installed, and it is
what makes swapping `codex exec` for an HTTP provider a one-file change.

---

## 3. Data flow

```
file ──parse──► ParsedBook ──chunk──► map units
                                        │
                              map (N calls, batched)
                                        ▼
                                  ChapterNote[] ─────────────┐
                                        │                    │
                                classify (1 call)            │  every downstream
                                        ▼                    │  stage reads the
                                   BookType                  │  notes, never the
                                        │                    │  book again
                              reduce (1–2 calls) ◄───budget──┘
                                        ▼
                              PathNode[] + Stage[]
                                        │
                                 recap (1 call, reads the path)
                                        ▼
                                      Path ──install──► shelf, playable
                                        │
                        scheduler: per station, in walking order
                                        ▼
                     slides (1 call) ──► tts (edge-tts) ──► NodeDeck
```

**The full text is read exactly once.** Map produces the notes; everything after reads notes.
Re-reading per stage multiplies cost roughly 5x for no gain. `recap` goes one further and reads
the station briefs `reduce` already wrote, so closing a book costs no pass over the notes either.

---

## 4. Storage layout

```
$CAIRN_DATA_DIR/            default ~/Library/Application Support/Cairn/
  books/<id>/               everything the player needs; no absolute paths inside
    path.json               the station list; installed the moment reduce finishes
    notes.json              ChapterNote[]
    chapters.json           full text, read by the companion only — never served
    chat.json · working.json  companion conversation and its working memory
    reading.json            completed-reading marker
    decks/<nodeId>.json     one file per station, audioPath relative to the book
    decks/index.json        readiness list the player polls
    audio/<nodeId>.mp3      copied from the cache by deck key
  books.json                LibraryEntry[] incl. PathQuality; replaced atomically
  settings.json             what the settings panel stores
  .cache/<id>/              generation-side, never travels
    map.json                resumable per-chapter results
    decks-<budget>.json     built decks by deck key, for resume
    audio/                  mp3 per deck key
    trace/                  only when CAIRN_TRACE=1
  .preview/<voice>.mp3      voice auditions
```

Never beside the app: its cwd is inside its own bundle and is rebuilt on every `electrobun dev`.

On the phone, `Application Support/Library/books/<id>/` has the same shape, so one reader
serves both — `manifest.json` (the `Book` record's manifest, verbatim), `decks/`, `audio/`,
`cover.*`, and `state.json`, which is local only: the fingerprints on disk, the reader's place,
and whether the book is finished. The built-in book is the same layout inside the app bundle and
is read in place. The directory is excluded from device backups, because iCloud can restore it.

**Deck keys are content fingerprints, not positions.** `reduce` re-runs on every generation and
the model is not deterministic, so station `n0` routinely means a different station than it did
last time — and one audio directory is shared by every budget. A positional key let one budget's
synthesis overwrite another's, then shipped the right subtitles over the wrong voice track.

---

## 5. Long-running work

Near a hundred model calls per book, which is the most fragile part of the system. It is written
as a **resumable task state machine**, never one `await Promise.all`:

- each task's result persists the moment it lands, so an interruption loses nothing
- concurrency is capped; a failure is isolated and retried with backoff
- progress is per unit ("chapter 37 of 82"), not a spinner
- an interrupted run resumes where it stopped

Two state machines, one per shape of work, both driven by `books/builder.ts`:

| | `runJob` (`job.ts`) | `startDeckScheduler` (`scheduler.ts`) |
| --- | --- | --- |
| Order | Fixed | Re-orderable — follows the reader |
| Pausable | No | Yes; reader questions hold it |
| Runs | the map stage | every station's deck |

The app and `add-book` are both thin drivers of the same builder, and its cache lives under the
library's `.cache/<id>/`, so a book half-built by either resumes in the other. A station is
reported ready only after `onReady` has installed its deck and audio into the book.

---

## 6. Process boundary and the loopback server

The main process serves the library over `127.0.0.1` on a random port, because the webview needs
a URL to read a book from: the deck fetches its narration whole, and the voice audition's
`<audio>` range-requests its sample. `main/library-server.ts`:

- binds loopback only, and answers `GET` and `HEAD` only
- serves exactly one directory
- requires a per-launch token as the first path segment
- rejects traversal before the path join, then re-checks the result against the root, because a
  decoded segment can contain a separator

It is the only process that listens, and it is not reachable from outside the machine.

---

## 7. Dependencies

| Need | Choice | Why |
| --- | --- | --- |
| Language, runtime, tests | TypeScript + Bun | One toolchain for the app, the scripts and the tests |
| Desktop shell | Electrobun | Small native shell; the reference project ships Mac and Windows with it |
| Build (webview) | Vite | Small output, fast dev |
| UI | React | The slide layouts are components; nothing heavier is needed |
| Generation model | `LlmProvider` | An API key, or the `codex login` account as the OpenAI Codex provider. See below |
| Companion model | Pi agent core + Pi AI | Streaming tool loop, cancellation, and selected model route |
| Narration | `edge-tts`, voice `zh-CN-YunjianNeural` | Free, no key, sentence-level subtitles alongside the audio; Microsoft tunes this voice for audiobooks and commentary |
| Web search | Tavily | The companion may search when it helps answer accurately |
| EPUB parsing | JSZip, then our own extraction | We only need the text; epub.js brings a whole rendering engine |
| PDF parsing | `unpdf` (pdf.js, serverless build), then `pdf-layout.ts` | Pure JS with no worker, so it runs on cottontail; MinerU, Docling and PyMuPDF would each bring a Python runtime. Bookmarks give chapters, headings are the fallback |
| MOBI / AZW3 parsing | PalmDB reader ported from foliate-js's byte layer (`mobi-decode.ts`) | No JS library reads Kindle text without a DOM: foliate-js needs `DOMParser` throughout, and `@lingo-reader/mobi-parser` writes every image to disk and crashed on a real Gutenberg AZW3. KF8 half preferred; a MOBI6-only body has no heading tags, so its chapters are named "Section n" (its NCX index is not read) |
| DOCX parsing | mammoth, then the EPUB heading split | Handles tables, lists and tracked changes. Headings come from mammoth's style map, by style name: a custom style merely based on Heading 1 is body text |
| Chat surface | `CompanionPane.tsx` | App-owned messages, tool trail, and source citations |

The companion's model loop runs in the main process. Pi supplies the streaming agent and model
adapters; Cairn supplies read-only book and web tools, evidence validation, and the renderer.
See [PRD.md](./PRD.md) §6 for the source and context rules.

**`LlmProvider` does not grow tool calling.** The pipeline is one shot, strict JSON schema, no
tools, cacheable by content; the companion is multi-turn, tool-driven, streaming, not cacheable.
Collapsing them would put a conversational loop behind the interface `deckKey` assumes is
deterministic and single-shot, and the pipeline's whole caching story rests on that assumption.
Two interfaces over one library is the deliberate shape.

**Every model-facing prompt is XML-structured** — the companion, its compaction prompt, and the
pipeline stages. Short named sections for role, behavior, tools and skills, with dynamic context
in its own section, following [LLM Space](https://github.com/deer-flow/llm-space)'s General Agent
prompt. Dynamic titles, book text, web text and reader input are escaped as character data and
never interpolated into tag names or instruction sections; test rendered prompts with input
containing `&`, `<`, quotes, and text that looks like a closing tag. The pipeline prompts are
only partly tagged today, so this is a migration target, not a description of the code.

**The cost of `codex exec`** — generation's original route, now used only by `bun run replay`:
each call carries roughly 18k tokens of agent harness overhead,
several times the chapter text itself. That is why the map stage batches chapters
(`DEFAULT_BATCH_SIZE`) rather than sending one call per chapter. A plain HTTP provider would have
a few hundred tokens of overhead and could drop the batch size to 1 for cleaner per-chapter
notes. Keep everything behind `LlmProvider` so that swap stays a one-file change.

---

## 8. Decision record

Arguments that are easy to undo by accident. They predate the current shape but still hold.

### Slides are data; nothing renders to mp4

1. Changing one page in an mp4 means re-rendering the whole thing. Slides are JSON; changing a
   page changes a page.
2. The same content can render as a player, as plain text, and later as mp4 — commit to mp4 and
   the text view stops being possible at all.
3. The *feel* of video does not require the format. Auto-advancing slides with narration that
   moves into the next station on its own **is** watching a video, except it can be paused,
   skipped, searched and copied.

If mp4 is ever genuinely wanted, it is an **export**, not the core form.

### No image generation

Generated illustrations are close to useless for abstract ideas — draw "the anchoring effect" and
you get something pretty and uninformative. A good deck is mostly type and diagrams anyway.
Slides are structurally generated layouts rendered with React and SVG: free, instant,
stylistically consistent, traceable page by page. Pictograms come from a closed local glyph set,
never from a model.

### Structure never comes from pretraining memory

Memory works for famous books and becomes confident fabrication on the long tail. Letting it
decide how many stations a path has, or where it cuts, moves that dependency from the content
layer to the structural layer — and hides it better. **A wrong fact can be caught by someone who
read the book; a fabricated structure looks exactly like a real one.**

### `sourceChapters` on every station

The cheapest possible hedge against hallucination, and it costs almost nothing: any claim can be
traced back to the text it came from. Stations citing chapters that do not exist are dropped, and
the count is recorded.

### The sidebar was once rejected, and is now right

The original design chose focus mode with no sidebar, because a sidebar invites skipping and
skipping would have polluted a completion-rate experiment. There is no experiment. A sidebar
costs nothing now, and jumping around is a feature.

### edge-tts is an unofficial endpoint, now spoken to directly

It rides Microsoft Edge's read-aloud service: free, no key, Chinese voices close to human. The
risk is that it gets rate-limited or shut off; switching to a paid cloud TTS at that point costs
roughly ¥7.5 per book (≈25k characters). Not the browser's own `SpeechSynthesis`: its voice
varies with the operating system.

It used to run through the `edge-tts` Python CLI, which put an install step in front of the
reader and could never work inside a sandboxed player. `runtime/edge-tts-ws.ts` talks to the same
service over its WebSocket instead. Word-boundary events replace the CLI's SRT, and
`cuesFromBoundaries` in `pipeline/tts.ts` folds them into cues — slicing the *original* text
rather than joining the event texts, because `alignSentences` locates a sentence by cumulative
character offset and joined words drop every space. Measured, that error was two seconds by the
second sentence of an English paragraph.

### Codex is a provider, the way llm-space has it

The codex login used to be a hidden fallback: a default provider with no key quietly became
`codex exec` for generation and the ChatGPT backend for the companion, and a spent Codex quota
surfaced as an unexplained failure. It is now `openai-codex` in the registry, credentials read
exactly as llm-space's `getCodexCredentials` reads them, with the panel saying it uses the
signed-in account. `main/route.ts` follows llm-space's `resolveModelConfig`: the default if
available, else the first available provider by name, else nothing — reported as `no_model`.

### One provider registry for generation and the companion

Both halves used to reach a model their own way: generation through a `codex | key` toggle,
the companion through a hand-written list of vendors. Adding a vendor meant editing both.

They now share `shared/providers.ts`, built from pi-ai's generated catalog. The catalog is what
makes the choice honest rather than cosmetic — it records, per model, whether the provider will
hold a reply to a JSON Schema, under two different field names (`supportsStrictMode` for
OpenAI-shaped APIs, `supportsStrictTools` for Anthropic). Reading one and not the other marks
every Claude model as unconstrained.

The settings panel offers constrained models only, and a vendor with none is not offered —
decided from the catalog at build time (`OFFERED_PROVIDERS`), so a pi-ai upgrade that adds
strict support brings a vendor back unaided. The registry itself keeps every vendor and model,
so a stored pick still resolves. In pi-ai 0.87.1 openai 41/41, anthropic 15/15, deepseek 2/2
and groq 7/7 are fully constrained; moonshotai 0/4, minimax 0/3 and xai 0/4 are not. Gemini
carries no catalog flag — pi-ai decides it by model id (Gemini 3 and later) — so it is read
that way rather than as 0/22.

### One book builder, one library, one composition root

Adding a book used to be written twice: `main/generate.ts` for the app and `scripts/add-book.ts`
for the terminal, each with its own copy of the install code. They drifted in the ways copies do.
The terminal never appended the recap station, and it cached under the repository while the app
cached under the library — so the comment promising that one resumed the other's half-built book
was false.

Three modules replaced them, following [llm-space](https://github.com/deer-flow/llm-space):

- **`store/library-disk.ts`** — the `Library`: the only module that writes a book to disk, with
  the write chain and read cache inside it and the root passed in rather than read at import.
- **`books/builder.ts`** — map, classify, reduce, recap, install, then decks through the
  scheduler; resume, remove and the pause for a reader's question. It takes the library,
  narrator, provider and voice as arguments, which is what lets `tests/books/builder.test.ts`
  run a whole book on stubs.
- **`main/index.ts` as the composition root** — the narrator, the builder and the RPC handlers
  are constructed there and passed in. The late-bound setters (`onProgress`, `onDeckStatus`)
  and the handler module's `let` globals are gone.

The companion's tools still reach `store.ts` at import. That is the next step, not the pattern.

The bridge's request types now come from the schema through Electrobun's own proxy type; the
hand-written copy and its `as unknown as` cast were the one place the contract could drift.

### Narration plays through its own time-stretcher, not `<audio>`

The deck used an `<audio>` element and set `playbackRate` on it. In WKWebView that is AVPlayer's
`setRate:`, and every change stalls the playhead — measured in a bare WKWebView on a station's
own mp3, 150–570ms of nothing per change (after 1x → 2x the first second covered 1.1s of
narration instead of 2). Turning pitch correction off, serving from a blob and never landing on
1x all stalled the same, so nothing on the element's surface avoids it. A held → changes rate
twice, which made the gesture the worst case.

Players that change speed cleanly keep the stretcher in the signal path at every rate, so a
change is a parameter and not a rebuild: Chromium's renderer runs WSOLA behind `playbackRate`,
Firefox runs SoundTouch, ExoPlayer runs Sonic. `packages/ui/src/audio/` does the same —
`stretch.ts` is WSOLA with Chromium's figures, run in an AudioWorklet over the station's decoded
samples, and `NarrationPlayer` gives it the slice of `HTMLMediaElement` the transport already
spoke. The same measurement now reads ~20ms, which is the report interval. At 1x the stretcher
passes the signal through untouched, so nothing is paid when nobody is changing speed.

What it costs: a station is fetched and decoded whole before it plays (~300ms for 8.5 minutes),
and held as 24kHz mono floats (~50MB at that length). The context runs at 24kHz because edge-tts
narrates at 24kHz; anything else is resampled on decode.

The worklet module is the two functions' own source, loaded from a Blob URL — the one form that
is the same under Vite's dev server and `views://`. That is why `makeStretcher` and `register`
may reference nothing outside themselves; `tests/audio/worklet.test.ts` evaluates the text with
only the worklet's globals in reach, so a stray reference fails there.

### The phone's slide is a web page; everything else is native

Fourteen layouts in TypeScript, and more to come, cannot be maintained twice. The phone shows
the built slide page in a `WKWebView` that takes no touches; controls, gestures, the chapter list
and the sound are UIKit on top of and beside it. The sound is the only clock: Swift tells the page
where the audio is (`sync`) on every transport change and every 500 ms, and the page carries the
clock forward per frame between two tellings. Measured on the simulator, a steady sync finds the
page within ±7 ms; the first sync after playback starts can be off by ~270 ms while AVPlayer's
reported time catches up, which is why the app syncs every 250 ms for two seconds after a start.

### iCloud: CloudKit's private database, with the Mac writing through a helper

A book is one zone (`book_<id>`): a `Station` record per station, then the `Book` record, written
last so a phone that sees a book sees all of it; and a `Progress` record both sides write. The
Mac's main process has no CloudKit binding and no entitlement, so a small signed helper does each
call (`sync/wire.ts` is the pipe). The phone uses `CKSyncEngine` behind the `CloudBooks`
protocol; if it ever fails to deliver assets reliably, `CKFetchRecordZoneChangesOperation` behind
the same protocol is the fallback. A record whose fingerprint is already on disk is skipped; a
`manifest` whose `format` is newer than the build is listed as needing an update and not parsed.

The place is merged by one rule written twice and tested against one table: the newer
`updatedAt` wins, and on a tie the one further along the path.

Which books are in iCloud is decided on the Mac (`sync/auto.ts`), from the `icloudSync` setting
and a small ledger, `sync.production.json`: the books this Mac uploaded, the books its owner switched
off, and the ones switched off whose copy in iCloud is still to be removed — chosen while syncing
was off, or while offline — which the next run takes out. A removal on the phone deletes the book's zone and nothing else; the Mac tells it from a
book never uploaded by the ledger — uploaded from here, gone from there — and switches the book
off rather than uploading it again. That is why a place is saved with `createZone: false`: a
place must never bring back a zone its book was removed from.

#### Shipping the helper

iCloud is a restricted entitlement: macOS launches a process that claims it only when the bundle
embeds a provisioning profile granting it. So the helper is its own signed app,
`Cairn.app/Contents/Helpers/CairnSync.app`, found from the main process's executable
(`main/sync-helper.ts`). Two builds of it exist and they reach different databases:

- **A development build** uses the one `bun run sync-helper` builds in the repository, signed by
  Xcode with a development profile. It talks to CloudKit's **Development** environment.
- **A packaged app** carries one built by the `postBuild` hook, `scripts/embed-sync-helper.ts`,
  signed with the Developer ID certificate, `CairnSync.release.entitlements` and the Developer ID
  profile named by `CAIRN_SYNC_PROFILE`. It talks to **Production**, which is also where an App
  Store build of the phone app reads.

Because the two environments hold different books, each build keeps its own ledger
(`sync.development.json`, `sync.production.json`). One shared file made the release read every
book the development build had uploaded as "uploaded from here, gone from there" and switch it off.

Electrobun's packager signs every Mach-O it finds in the bundle with the app's own entitlements,
wherever the file sits and whatever it is called, and offers no way to exclude one. Left alone it
re-signs the helper and strips the iCloud entitlement without failing the build. It finds
`codesign` on `PATH`, so `scripts/signing/codesign` goes first there while packaging: it does
nothing when asked to sign something inside `Contents/Helpers/CairnSync.app` and hands every other
call to `/usr/bin/codesign`. The hook refuses to run without it, and `release.yml` reads the
entitlements back from the packaged app before publishing. Rejected: shipping the helper as an
archive and unpacking it at first use (a second copy outside the bundle to keep current and to
clean up), and signing the whole app ourselves instead of letting the packager do it.

### Superseded, and why it is worth knowing

The v0 plan was a zero-backend browser app with BYOK, two entry points (`/studio` authoring and a
keyless `/p/:id` reader), Cloudflare Pages hosting, an analytics Worker, and IndexedDB storage —
all of it in service of measuring completion rate on ten strangers. None of that exists. The
product is a local desktop app for one owner, and there is no metric.

What survived from that plan, and why it is in the list above: no mp4, no image generation,
structure from real text, `sourceChapters`, the resumable state machine, and the `packages/` +
`apps/` split. Those arguments never depended on the experiment.
