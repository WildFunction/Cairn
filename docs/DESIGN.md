# Visual design

Why the interface looks the way it does. Read this before changing
`packages/ui/src/tokens.css` or any CSS that affects appearance — several values here are
load-bearing, and changing one silently breaks contrast or the depth hierarchy.

The rules come from Apple's design talks (*Designing Fluid Interfaces*, WWDC 2018; *The Details
of UI Typography*, WWDC 2020; *Principles of Great Design*, WWDC 2026), taken only where they
apply to this app.

## The strategy: stage-led

**Chrome recedes; the slide is the only object in the window with real elevation.**

This is a player. Attention belongs on the content. Three rules follow, and they come up
constantly:

1. **Only the slide gets a shadow** (`--elev-stage`). A bigger surface reads as a thicker one,
   so the deepest shadow is reserved for it. Everything else is flat or uses `--elev-low`.
2. **The current station is not a painted block.** It is marked by weight (620), full ink, and
   the accent dot. A filled highlight bar competes with the slide for attention — that was the
   problem with the previous design.
3. **Regions separate by surface, not by rules.** The sidebar and the ask pane use `--chrome`
   and carry no border. Where a divider seems necessary, use a scroll-edge fade instead of a
   1px line. The one exception is a **draggable** splitter, which is a control and not a
   divider: it carries a `--line` rule at rest. In the dark theme `--chrome` and `--page` sit
   1.03 apart, so surface alone leaves nothing to grab for.

### Directions that were rejected

- **Floating translucent chrome** (content scrolling under a `backdrop-filter` layer). The best
  looking of the three, but the payoff lands in the moment of scrolling and is nearly invisible
  at rest, and its performance in WKWebView is unverified.
- **Solid panels** (three rounded cards with gaps). The most robust, but the gaps eat content
  width the sidebar does not have, and it reads as tidy rather than as depth.
- **Native macOS sidebar vibrancy.** **Not possible.** Electrobun's native layer ships no
  `NSVisualEffectView`; only `transparent: true`, which makes the window background see-through
  but not blurred. Real material would mean patching its native code.

## Colour

Every token lives in `packages/ui/src/tokens.css`, named for its role rather than its
appearance. `--chrome` means "the surrounding interface", not "grey": it is darker than
`--page` in dark mode and lighter in light mode.

| Token | Role |
| --- | --- |
| `--page` | The content area — the centre pane |
| `--chrome` | Sidebar and ask pane. Deliberately close to `--page` |
| `--card` | Floating surfaces: menus, modals |
| `--ink` | Body text and the current item |
| `--ink-quiet` | The chrome's default text. Chrome recedes by being quiet, never by dropping below 4.5:1 |
| `--dim` | Secondary information: durations, counts, hints |
| `--accent` | Current station, transport controls, actionable emphasis |
| `--stage` / `--stage-*` | The slide surface and the type on it |
| `--elev-low` / `--elev-mid` / `--elev-stage` | Three levels of elevation; the third belongs to the slide alone |

### Contrast, measured

Recompute this table whenever a colour changes. Text needs ≥ 4.5; state colours ≥ 3.0.

| Pair | Light | Dark |
| --- | --- | --- |
| `--ink` / `--chrome` | 13.81 | 16.79 |
| `--ink-quiet` / `--chrome` | 9.19 | 11.64 |
| `--dim` / `--chrome` | 4.99 | 6.01 |
| `--accent` / `--chrome` | 4.93 | 9.54 |
| `--ink` / `--page` | 15.50 | 16.37 |
| `--dim` / `--page` | 5.60 | 5.86 |
| `--accent` / `--page` | 5.54 | 9.30 |
| `--stage-ink` / `--stage` | 15.57 | 12.17 |
| `--stage-dim` / `--stage` | 6.47 | 5.06 |
| `--done` / `--chrome` | 4.06 | 8.08 |

Two more numbers decide whether the hierarchy holds at all. WCAG does not grade them; adjacent
surfaces normally sit between 1.2 and 1.6.

| Relationship | Light | Dark |
| --- | --- | --- |
| `--chrome` / `--page` (region) | 1.12 | 1.03 |
| `--stage` / `--page` (elevation) | 15.31 | 1.47 |

In dark mode `--stage` is **lighter** than `--page`, the reverse of light mode: in the dark a
stage cannot separate by being darker, only by being lifted. The previous palette had both as
warm blacks at 1.17, and the slide sank into the background — the most visible flaw it had.

### Accent

Terracotta `#b03a0b`, `#f0a44f` in dark. Swapping it is an isolated decision: change `--accent`,
`--soft` and `--stage-accent`, then recompute the three accent rows above.

## Typography

**One fixed `letter-spacing` is wrong somewhere.** Tracking and leading both follow size, in
opposite directions.

| Level | Size | Weight | Tracking | Leading |
| --- | --- | --- | --- | --- |
| Slide title `.s-h1` | 7.4cqw | 800 | `-.035em` | 1.1 |
| Slide heading `.s-h2` | 3cqw | 700 | `-.015em` | — |
| Pane and station titles | 15px | 640 | `-.011em` | — |
| Body | 15px | 400 | `0` | 1.55 |
| Station rows | 13px | 400/620 | `0` | — |
| Secondary text | 11.5px | 450 | `+.004em` | — |
| Small labels (stage names, kickers) | 10px | 620 | `+.075em` | — |

The pattern: **large type tightens, body sits at zero, small type opens up**; leading moves
inversely to size. Hierarchy is built from weight, size and leading together, not from size
alone — weight adds presence without taking more space.

System fonts first (`-apple-system` / `SF Pro Text` / `PingFang SC`; `Segoe UI` /
`Microsoft YaHei` on Windows), with
`font-optical-sizing: auto`. They already ship optical sizing and tracking tables; override only
with a reason.

### The fit ladder

Every slide size above is a fraction of the stage, so a string longer than its box **overflows
rather than shrinks**. The text comes from a model and has no length limit, so the sizes in the
table are the *designed* sizes, not the only ones a field is drawn at.

`packages/core/src/fit.ts` holds one budget per field — how many display units fit at the
designed size, derived as `available width ÷ font size × allowed lines` and shown with its
arithmetic. The layouts stamp a rung on the element (`data-fit`), and three rules in
`slide.css` turn the rung into type:

| Rung | Size | Tracking | Leading |
| --- | --- | --- | --- |
| `0` | ×1 | +0 | +0 |
| `1` | ×0.8 | `+.008em` | `+.06` |
| `2` | ×0.62 | `+.016em` | `+.12` |

The deltas are why this is one ladder and not three ad-hoc rules: **a field cannot step down in
size without its tracking and leading following**, which is the rule at the top of this section.
Every size is written as `calc(<designed> * var(--fit, 1))`, so the table above still reads as
the design.

Two numbers must move together. The rung thresholds in `fit.ts` are the reciprocals of the
scales here (`1/0.8`, `1/0.62`); change a scale without the threshold and a string lands on a
rung that still does not fit it. Past the last rung there is no size left, and
`pipeline/slides.ts` drops the slide instead of rendering it broken.

A list steps as a whole, from its longest item — three claims at three sizes read as an
emphasis nobody intended.

Nothing here can be unit-tested: overflow is a property of real layout and there is no render
setup. `?gauntlet` in `bun run dev` draws every layout at its worst, which is what the budgets
are checked against. It draws them with the caption band reserved, as the player does, and
measures what it can: any text past the slide's content box, and any two pieces of text drawn
over each other, are listed under the slide (`slides/faults.ts`). A clean list is not a pass —
a label crowding a stroke is still for the eye.

## Slide layouts

Fourteen layouts, each a different *shape of claim*. They are not interchangeable skins: picking the
wrong one makes a true statement unreadable, so the reasoning behind each belongs here rather
than in a comment on the component.

| Layout | The claim it is for | The decision inside it |
| --- | --- | --- |
| `title` | This station, named | The oversized station number and the pictogram exist so the card is recognisable when scrolled back to; a wall of identically-styled titles is unnavigable |
| `points` | Up to three claims | No icons — the numbered marks already carry the rhythm, and a glyph per line competes with the words. One thread down the marks so three claims read as one argument |
| `number` | Figures worth comparing | Bars, not three big numerals: "1" beside "110" says nothing until the eye sees the ratio. No bars at all when the values are not comparable, because a bar drawn from a guess asserts a ratio the book never claimed. A zero gets a marked-empty track — quoting a zero is the point |
| `quote` | The book's own words | Styled unlike everything else, because "this is verbatim" must be visible without saying it. A quote whose source could not be located says so: that is exactly the one worth doubting |
| `compare` | A against B | The right pane is emphasised and arrives a beat later, so the contrast is stated rather than merely laid out. Each side may claim one glyph, which here does real work — it labels which pane is which at a glance |
| `flow` | A causal chain | A column, never a wrapped row: a wrapped row breaks the chain wherever the right edge falls, and the break reads as a meaningful gap. The connector is the content — a chain with gaps is a list |
| `timeline` | A dated or staged progression | Distinct from `flow`: the order is the book's own and the mark carries information a bare chain cannot show. Marks sit on one spine, because marks with gaps between them are a list, not a run |
| `matrix` | The same question asked of both sides | `compare` sets two lists side by side and leaves the reader to pair them up; here the pairing *is* the layout, so a row that does not line up cannot exist |
| `relation` | Cause and effect, as stated | The relation sits on the arrow rather than in a sentence, so the claim cannot be read as a loose association between two nearby nouns |
| `cycle` | A loop the book closes | Nodes on one ellipse, clockwise from the top, and the arrow out of the last lands on the first. That return is the claim; a chain with an end is `flow` |
| `pyramid` | A ranking the book states | Labels sit beside the shape, not in it: the apex is too narrow for a word, and a label shrunk to fit it would read as the least important level instead of the most |
| `quadrant` | Two dimensions crossed into four types | The axes carry their ends as words — never arrows, never rotated text — and the cells are not coloured apart, because position already says which is which |
| `overlap` | Where two or three things meet | Set names sit outside their circle so no word crosses a stroke; the meeting place is the one accent, because it is the claim and the sets are only its terms |
| `causes` | One effect, its causes grouped | A fishbone. The effect arrives first because it is the question; groups alternate above and below the spine so no two bones share a side |

Four rules hold across all fourteen:

- **Every layout builds with the narration, item by item.** An item appears at the caption that
  names it (`reveal.ts` matches the slide's words against the script), falling back to an even
  share of the slide's span when the script names it nowhere, and never arriving before the item
  above it. Evenly spaced beats put a card on screen *after* the sentence that introduced it,
  which reads as the deck lagging the voice. Everything is derived from audio time, so a scrub
  backwards folds the slide up again — an entry animation would replay out of step.
  A connector — `flow`'s link, `timeline`'s spine, a `cycle` arc, the fishbone's spine and
  bones — arrives with the item it leads to, not the one it leaves: drawn early, it points at
  nothing, and a closed `cycle` ring would state the loop before the narration has.
- **No layout invents its own material.** `number`, `timeline`, `matrix`, `relation` and the five
  diagram layouts draw only on the material the map stage extracted (`figures`, `sequences`,
  `contrasts`, `relations`, `cycles`, `ranks`, `quadrants`, `overlaps`, `causes`). These look
  the most evidenced, so a fabricated one does the most damage.
- **One focal item at most.** `number`, `relation`, `cycle`, `pyramid`, `quadrant` and `causes`
  take an optional `focus`, and only that item carries the accent. Without one, nothing is
  singled out: an accent on every row — which `relation` used to put on every effect — marks
  none of them. `compare` and `matrix` keep their emphasised right side; there the emphasis is
  the direction of the contrast, not a pick. `overlap` always accents the meeting place.
- **Nothing is drawn.** Type, stroked shapes, and glyphs from the fixed local set. No generated
  images — see PRD.md.

### Capacity, and when not to use a layout

Every layout has a ceiling past which it stops reading at a glance. Past it, split the material
across two slides or keep what the narration needs; normalization cuts the rest.

| Layout | Holds |
| --- | --- |
| `points` | 1–3 claims |
| `number` | 1–3 figures |
| `flow` | 2–5 steps |
| `timeline` | 2–6 entries |
| `matrix` | 2–4 rows |
| `relation` | 2–4 links |
| `cycle` | 3–6 steps |
| `pyramid` | 3–5 levels |
| `quadrant` | exactly 4 cells |
| `overlap` | 2–3 sets |
| `causes` | 2–4 groups of 1–3 |

The slides prompt names the wrong choices as well as the right ones, because the likeliest
failure is a true claim in the wrong shape:

- `flow` when the order does not matter — that is `points`
- `timeline` when the entries carry no mark — that is `flow`
- `compare` when both sides answer the same questions — that is `matrix`
- `relation` for two things that merely appear together
- `cycle` when the chain has an end — that is `flow`
- `pyramid` for a list with no ranking of the book's own
- `quadrant` when the four types are not the product of two dimensions
- `overlap` for things that are only alike, with no named meeting place
- `causes` for a single cause — that is `relation`

### The aside

`flow`, `matrix`, `relation` and the five diagram layouts may carry an `aside`: a short line in
the margin, in serif and italic where the face has one, led in by a dashed rule rather than a
solid one so it cannot be read as part of the figure. It is the book's voice, so
`pipeline/slides.ts` keeps it only when it is found in the chapter's quotes; an aside nobody can
locate is removed rather than shown. One per slide, arriving once the figure is complete.

### Before adding a layout

Ask whether the claim is a new *shape* or an existing shape with a different subject. A
bottleneck, a feedback loop and a boundary are behaviours; most of them already have a layout
that carries them. A new layout costs a map field, a cache clear for every existing book, a
prompt entry in two languages, a fit budget per field, and a gauntlet entry — so it is for a
shape nothing here can carry, not for a subject.

Not built: `world` (a novel's setting; nothing in the notes supports it yet) and `stack`
(proportional composition, which `number`'s bars already cover).

## Motion

Two places have it: items building with the narration (above), and the player chrome (below).
Everywhere else, still none. When adding more:

- **Springs, not fixed-duration easing.** A spring can be interrupted and carries velocity; a
  scripted animation cannot.
- **Critically damped by default** (damping `1.0`, response `0.3–0.4`), no overshoot. Add bounce
  (damping ~`0.8`) only when the gesture itself carried momentum — a flick, a drag release.
- **Every animation is interruptible**, and starts from the current on-screen value, never from
  the target.
- **Feedback happens on pointer-down, not on release**, and updates continuously during the
  interaction rather than only at the end.
- Animate `transform` and `opacity` only.

### The player chrome

The deck plays like a video, so its controls behave like a video's: nothing but a 3px progress
line until the pointer moves over the frame. The room the old always-on bar took below the stage
goes to the slide, which matters more than it sounds — type is sized in `cqw`, so a bigger frame
is bigger type throughout.

Entering, controls land a beat apart; leaving, they go together in 140ms. A staggered exit reads
as reluctance. The stagger is `transition-delay`, never keyframes, so moving the pointer away
mid-entrance turns them around from wherever they are.

| At | Element | Motion |
| --- | --- | --- |
| 0ms | scrim | opacity only — it is the ground the rest lands on, and moving it drags the eye |
| 0ms | caption | shifts up by `--ctl-h`, so it is never covered for even a frame |
| 20ms | play | `translateY 6px → 0` |
| 60–180ms | volume, time, rate, page, fullscreen | the same, 30ms apart |
| — | scrub | **does not fade in.** It rises from the frame's bottom edge by `--ctl-h` |

That last row is the point. The idle line and the scrub are one object, not a line that fades
out and a bar that fades in. Hovering it scales **the rail only** to 1.9 and grows the thumb from
0 — scaling anything that contains the thumb draws the round handle as an ellipse.

### Holding → to go faster

A hold raises a badge at the top of the frame: three marks running left to right, the label, and
the speed. The three tiers (1.5×, 2×, 3×) sit on a wheel with the current one centred and its
neighbours cut by the badge's edge — that cut is the whole affordance for ↑ / ↓, and it is why
the keys follow the drawing (↓ is the tier drawn below, the faster one) rather than "up is more".

The badge shows whatever the chrome is doing, takes no clicks, and is gone on release. A hold
starts on the tier used last, unless the dial is already that fast, in which case the next one up.
Rewinding (a held ←) raises nothing: there is no speed to choose.

### Staying with the sound

The picture is drawn **90ms ahead of the audio**, and that is deliberate.

ITU-R BT.1359-1 puts the detectability thresholds at roughly -45ms to +125ms, and the asymmetry
is the point: the brain expects sound to arrive after sight, so a picture that lands *before* its
sound goes unnoticed to about 125ms, while one that lands *after* is caught at 45ms. Zero is not
the target; slightly early is.

Three things used to push the picture the wrong way, and all three are fixed:

- **`timeupdate` fires about four times a second**, so everything derived from it was up to 250ms
  late. The position is read from `requestAnimationFrame` instead, committed at most every 32ms —
  a step function does not need 60 commits a second.
- **A 420ms build** meant a revealed item only read as arrived ~200ms after its cue. It is 240ms
  now.
- **Nothing led the sound.** `LEAD_MS` in `reveal.ts` is the single knob; it also absorbs the
  frame quantisation and the audio output latency under it.

### When the chrome goes away

Four things hold it up, and only four: the pointer moved in the last 2.5s, the pointer is resting
on the controls, the rate menu is open, or the deck is paused. Nothing else.

The trap to avoid is **focus**. A clicked control keeps DOM focus for as long as nothing else
takes it, so pinning on `:focus-within` pins forever — in fullscreen there is no "move the mouse
away" to break it, and the bar never comes down again. The pin is `:has(:focus-visible)`, which a
mouse click does not set and a Tab does.

In fullscreen the cursor hides with the controls. There is nowhere for the pointer to go — it
cannot leave the frame — so an arrow left on the slide is the last thing covering it. Any
movement brings both back.

Hidden controls take no clicks (`pointer-events: none`). An invisible button that still responds
is worse than no button: the click does something the reader cannot see.

Two constraints worth keeping:

- **The volume slider's width is always reserved**, and only its opacity and a small `translateX`
  change. Animating the width (as YouTube does) reflows everything to its right.
- **Controls stay up while paused**, and `:focus-within` counts as hover — otherwise the bar is
  unreachable by keyboard. Sizes are `clamp(px, cqw, px)` so the same controls read correctly in
  a narrow pane and in fullscreen.

## Accessibility

- `prefers-reduced-motion`: short opacity cross-fades; drop translation and overshoot.
- `prefers-reduced-transparency`: translucent surfaces such as the caption pill become solid.
- `prefers-contrast: more`: near-solid surfaces with a defined border.

The caption sits on a dark pill with a blur rather than using a text stroke: the stage is dark,
but slide type can run behind the caption, and a shadow alone will not separate them.

## Before changing anything

- [ ] Changed a colour → recompute both contrast tables; text pairs stay ≥ 4.5
- [ ] Added a shadow → check nothing is now competing with the slide for elevation
- [ ] Added a divider → ask whether a surface difference or an edge fade would do instead
- [ ] Added a type size → give it tracking and leading appropriate to that size
- [ ] Looked at it in both light and dark
