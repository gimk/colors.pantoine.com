# SCHEME — a second mode for colors.pantoine.com

A plan, not a spec. Written against the codebase as it stands at `d4398b3`.

> **Status: built.** Steps 1–6 landed as written, and step 7 all but the bar
> resize, which was dropped. What changed on the way is recorded at the foot of
> this file under *What actually shipped*.

The app today is a tint-and-shade tool: you hand it a colour, it derives a ramp
through three Bézier curves in OKLCH. The only help it offers in *choosing* that
colour is the Harmony pane inside the New palette dialog — one rule, one seed,
eight candidates, and it closes the moment you click. SCHEME is that pane grown
into the other half of the product: a full-screen, minimal-chrome generator for
multi-colour palettes.

---

## The shape of it

Three top-level views, not two. `App.tsx` already branches to `ReviewBoard` by
replacing the tree rather than hiding parts of it; SCHEME is a third branch of
exactly that kind. Review stays a sub-mode of ramps, reached from the ramps
control bar — it reviews a document of ramps, and a scheme has nothing to
review.

```
mode: 'ramps'  ──▶  editor (masthead + controls + stack + toolbox)
                └▶  ReviewBoard          (Escape returns)
mode: 'scheme' ──▶  SchemeBoard
```

The mode switch lives in the masthead, left, where `— TINTS & SHADES` currently
sits inside the `<h1>`. That suffix moves into the switch, so the title shortens
to `COLORS // PANTOINE` and the switch is what says which half you are in.

The masthead is currently rendered only in ramps mode. It has to come out of
`App`'s ramps branch so `SchemeBoard` can carry the switch too — otherwise there
is no way back.

### Naming

`SCHEME`, because it names the output the way `TINTS & SHADES` does, and the two
read as a pair. `HARMONY` names the mechanism and would go narrow the moment the
mode does more than rotate hues. `PALETTE` is already taken: it means one ramp
everywhere in this codebase. `PICKER` collides with `ColorPicker`, and
everything in the tool picks colours.

---

## 1. Colour science — `src/color/scheme.ts` (new)

The generator is the actual product, and the existing one will not do.
`harmonyCandidates()` holds lightness at the seed's, which is correct for "give
me a hue to build a *ramp* from" and wrong for a scheme: it returns five colours
of identical weight. What comes back has to have tonal range or it reads as a
colour wheel rather than a palette.

Two orthogonal inputs.

**Rule** picks the hues. Reuses `HARMONIES` from `color/harmony.ts` untouched,
plus:

```
hueSequence(anchorHue, rule, n) → number[]
```

which fills `n` slots from `[0, ...rule.offsets]`, wrapping with a small
deterministic jitter once it runs out so a sixth slot is not a clone of the
first.

**Profile** picks lightness and chroma per slot. New named data, shaped like
`HARMONIES` so the two read the same way in the UI and in the toolbar.

| id | what it gives | L range | chroma share of ceiling |
| --- | --- | --- | --- |
| `even` | straight spread, `L_LIGHT` → `L_DARK` | .97 → .16 | ~.75 |
| `anchored` | one dominant mid, one near-white, one near-black | .95 .72 .55 .38 .18 | ~.8 on the mid |
| `vivid` | poster colours, no tonal range | .55 – .75 | .90 – 1.0 |
| `muted` | editorial, desaturated | .40 – .80 | .30 – .40 |
| `pastel` | light and soft | .85 – .94 | .25 – .35 |

Chroma is `maxChromaFor(l, h, gamut) * share`, reusing `color/gamut.ts`. Two
consequences worth stating: every slot is in gamut by construction, so no slot
ever needs a clipped marker; and widening the document gamut makes every scheme
more saturated, which is the same promise the chroma curve already makes for
ramps.

Note this is the *cap* rule, not the *share* rule — the same choice
`harmonyCandidates` documents. Holding chroma as a share of the ceiling breaks
on pastels: a colour at 94% of its own modest ceiling becomes a screaming lime
at 94% of green's much higher one.

```
generateScheme(slots, rule, profile, gamut, rng) → Slot[]
```

1. Anchor is the first locked slot with `hasUsableHue`, else one rolled from `rng`.
2. Locked slots pass through byte-identical, and are skipped when hues are assigned.
3. Unlocked slots take `hueSequence[i]` × `profile.lightness(i, n)` × capped chroma.

**The RNG is a parameter, defaulting to `Math.random`.** That is what makes the
generator testable at all. And rather than repeat what `steppedBase()` does
today — call `Math.random()` from inside the reducer — the `generate` action
**carries its seed**, rolled in the UI and dispatched. The reducer stays pure,
undo replays identically, and the tests get exact expected values out of a
`mulberry32(1)`.

Also in this module:

- `contrastLadder(slots)` over the existing `contrastRatio` /
  `relativeLuminance` — the adjacent-pair ratios, so the board can flag two
  neighbours nobody can tell apart. This is the difference between a tool and a
  randomiser. **(Built, then removed — see *What actually shipped*.)**
- Slot naming through `nameForColor` from `color/names.ts`. The 30k list is
  already a dependency, and a named bar is most of what makes coolors feel
  finished.

### Tests — `src/color/scheme.test.ts`

- locked slots survive a generate byte-identical
- every generated slot is in gamut, across every gamut × profile
- a fixed seed is reproducible
- the profiles actually produce distinct L spreads (the whole point)
- `hueSequence` never duplicates a hue within `n ≤ 8`

---

## 2. State — `src/state/scheme.ts` and `useScheme.ts` (new)

```ts
type Slot = { id: string; color: Oklch; locked: boolean }

type SchemeState = {
  slots: Slot[]
  rule: HarmonyId | 'auto'
  profile: ProfileId
}

type SchemeAction =
  | { type: 'generate'; seed: number }
  | { type: 'toggleLock'; id: string }
  | { type: 'setColor'; id: string; color: Oklch }
  | { type: 'add'; at?: number }
  | { type: 'remove'; id: string }
  | { type: 'reorder'; sourceId: string; targetId: string }
  | { type: 'setRule'; value: HarmonyId | 'auto' }
  | { type: 'setProfile'; value: ProfileId }
  | { type: 'setCount'; value: number }
```

`MIN_SLOTS 2`, `MAX_SLOTS 8`. Full-bleed bars stop being legible past eight, and
a scheme that needs more than eight is a document, which is what the other mode
is for.

`state/history.ts` is already generic over its reducer, so `useScheme` wraps it
with no changes to it:

```ts
withHistory(schemeReducer, { coalesce })
```

Coalesce `setColor:<id>` so a drag in the picker collapses to one entry.
Everything else returns `null` and begins an entry of its own.

**`generate` getting its own undo entry is the feature.** Mash space, find
nothing you like, `Ctrl+Z` back to the roll from three presses ago. Coolors
handles this badly and the machinery is already sitting in this repo.

`gamut` is **not** duplicated into the scheme. It is a property of the display
being designed for, not of one mode, so it stays on the document and the scheme
reads it — the same argument `ColorPickerDialog` already makes about not keeping
a local copy of it.

---

## 3. Persistence

### URL — `src/state/url.ts`

A scheme is one more `~`-separated segment. It carries no `c=` key, so
`decodePalette` returns `null` for it and `decodeDocument` drops it — the exact
trick `g=` and `u=` already use, which is what lets an older reader open a newer
link.

```
#g=p3~sc=264653-2a9d8f-e9c46a-f4a261-e76f51&sl=01000&sr=split&sp=anchored&m=scheme
```

Locks travel as a 0/1 bitmask, which stays short. The colours travel as a hex
list, which stays legible and hand-editable — the property the whole hash format
is built around — and happens to look like a coolors link, which is a format
people already recognise.

`m=scheme` so a shared link opens in the mode it was made in.

### Storage — `src/state/storage.ts`

Its own key, `colors.pantoine.com/scheme/v1`, following the `useReview`
precedent rather than growing `Stored`. Same guarded try/catch: blocked, full,
or a private window all fall back to a fresh scheme.

---

## 4. UI

### `src/ui/ModeSwitch.tsx`

`.review__group` is already a segmented control — `button + button {
margin-left: -1px }` plus `.is-on`. Reuse it. No new pattern, no new CSS idea.

### `src/ui/SchemeBoard.tsx`

`100dvh`. `.scheme__bars` is a flex row of `.sbar`, each `flex-grow` weighted.
Full-bleed colour, minimal chrome — bolder than anything else in the app, which
is the brief.

Per bar: the name from `nameForColor`, the value in the document's `Format`, the
lock state, and on hover a small cluster — lock, edit, remove, drag grip.

Ink colour comes from `inkOn(simulate(color, vision))`, which is exactly what
`ReviewBoard` already does for `.rband__name`. Vision simulation therefore works
in SCHEME on day one for nothing.

The top bar carries: the mode switch, rule, profile, slot count, Generate,
format, vision, dark canvas, export, and the two bridges. That is a lot of
controls for a mode whose whole point is the colour, so it should be hideable.

### Keyboard

- **Space generates.** Guarded against `input, select, textarea` the way the
  existing undo listener is — and additionally skipped when the focused element
  is a `<button>`, since Space natively activates those and the toolbar is full
  of them.
- `1`–`8` toggle that slot's lock.
- `Ctrl+Z` / `Ctrl+Shift+Z` already work, provided the existing App-level
  listener dispatches to whichever mode is active.

### Editing one colour

`ColorPickerDialog` renders its own swatch as the trigger. It needs a small
refactor to accept a `trigger` render prop; the alternative is dropping to
`ColorPicker` directly inside a scheme-side panel. The refactor is the smaller
change and pays off in both modes.

---

## 5. The bridges

Keeping the two modes on separate state is what lets the handoff be explicit and
lossless. Neither direction destroys anything.

- **Send to ramps** —
  `doc.addPalettes(slots.map(s => ({ base: formatColor(s.color, 'oklch'), name: … })))`.
  That API exists, and already caps at `MAX_PALETTES`. One click turns a
  five-colour scheme into five curve-driven ramps.
- **Seed from ramps** — the base colour of each palette (or of the selected one)
  becomes a slot, locked.

The alternative — one shared document, where a spacebar press re-rolls the base
under curves you spent an hour tuning — was considered and rejected for exactly
that reason.

---

## 6. Export

`buildText` takes `NamedRamp[]`, i.e. `{ name, ramp: Swatch[] }`. A slot is not
a `Swatch`: it has no `label`, `x`, `clipped` or `chromaLost`.

Synthesise a one-entry `Swatch[]` per slot rather than adding a `NamedColor`
path through `formats.ts`. A scheme *is* a document of one-step ramps, the types
line up, and every text format plus both image exporters work immediately.

---

## Files

| | |
| --- | --- |
| new | `src/color/scheme.ts` · `src/color/scheme.test.ts` |
| new | `src/state/scheme.ts` · `src/state/useScheme.ts` · `src/state/scheme.test.ts` |
| new | `src/ui/SchemeBoard.tsx` · `src/ui/SchemeBar.tsx` · `src/ui/ModeSwitch.tsx` |
| edit | `src/App.tsx` — mode state, three-way branch, masthead extracted |
| edit | `src/state/url.ts`, `src/state/storage.ts` — scheme segment, key, mode |
| edit | `src/ui/ColorPickerDialog.tsx` — custom trigger |
| edit | `src/styles.css` — a `/* --- scheme --- */` section |
| edit | `README.md` |

## Order

1. `color/scheme.ts` and its tests — no UI, provable in isolation
2. `state/scheme.ts`, `useScheme`, tests
3. `ModeSwitch`, the App branch, `SchemeBoard` rendering static bars
4. Generate, lock, keyboard
5. URL and storage
6. The bridges, both ways
7. Export, contrast ladder, vision, bar resize

Steps 1–4 are a usable mode. 5–7 are what make it a product.

---

## Explicitly not in scope

**Image extraction** — pulling a scheme out of a photograph. It is the one large
coolors/Adobe feature deliberately left out: it is a file drop, a k-means
quantiser and a new dependency, and it shares nothing with any of the above.
Worth doing. Worth doing separately.

---

## One thing to fix while nearby

`steppedBase()` in `state/document.ts` calls `Math.random()` from inside the
reducer, which makes `{ type: 'new' }` non-replayable — undo and redo across it
cannot be guaranteed to land on the same colour. The seed-in-the-action pattern
above fixes that class of bug for SCHEME; applying it to `new` as well is a
small, separate cleanup.

> **Done**, though not for the reason given here — see the foot of the file.

---

## What actually shipped

Steps 1–6 landed as planned. Five things came out differently, and one is not
done at all.

**The spread bounds are not the ramp's.** `even` runs L 0.92 → 0.22, not
`L_LIGHT` → `L_DARK` (0.97 → 0.16). Those constants are the ends of a *ramp*,
where a near-white and a near-black step are wanted as tokens. Here they are
two of only five colours, and a scheme that spends two of its five on
near-white and near-black has three left to do the work.

**`auto` rolls a rule rather than meaning "no rule".** The plan left `auto`
vague. It now picks one of the eight harmonies with the same seeded RNG and
reports which, so every scheme the tool produces can still answer *why these
colours go together* — which is the line between this and a random colour
generator.

**State carries `rolled` as well as `rule`.** The rule the last roll used, or
`null` for colours that never came out of a roll — loaded from a link, or
seeded from the ramp document. Held separately so `auto` can stay `auto`
instead of being silently pinned to whatever came up first.

**Editing a colour by hand locks it.** Not in the plan, and it should have
been: picking the exact blue you wanted and then having the next spacebar press
throw it away is the obvious trap, and the reducer closes it.

**Export got its own dialog.** `SchemeExportDialog` rather than a path through
`ExportDialog`. The editor's panel leads with *which palettes*, and a scheme is
one row, so that whole first step disappears — it is the second half of that
dialog on its own, reusing every `.exportd` class so it cost no new CSS. Slots
export as `Swatch`es numbered in scheme order (`--brand-1` … `--brand-5`), not
by lightness token: five colours chosen to sit together are not five tints of
anything.

**Bar resize is dropped.** Step 7 listed it, and the bars stay equal shares of
the row. The mechanism was there for the taking — `splitPair` in `useReview.ts`
is pure and generic, and the review board's ruler ticks are the pattern — but
the review board resizes because it is comparing ramps of different lengths
against each other, and a scheme is a handful of colours of equal standing. A
weight per slot would be a composition tool bolted to a colour picker, and it
would then have to answer whether widths travel in the link, which is the
question that gives the whole thing away: they are not part of what a scheme
*is*.

**The contrast ladder was built and then removed.** `contrastLadder` marked any
boundary below 1.25:1 as `flat`. It measured WCAG contrast, which is a
*luminance* ratio and therefore blind to hue — a red beside a green at the same
lightness came out at 1.14:1 and got flagged, though it is an obvious boundary.
That is precisely what the generator is built to produce, so the `vivid`
profile, which deliberately holds every slot in a narrow lightness band, would
have marked almost every boundary. The right measure would have been perceptual
distance (Euclidean in OKLab, which `culori` already offers), but the warning
was solving a problem nobody had, so it went rather than getting a better
metric. Contrast ratio stays where it belongs: the white/black figures on the
ramp swatches, which really are about reading text.

**The masthead is shared.** `src/ui/Masthead.tsx` carries the title, the mode
switch and the help, identical in both modes and above each mode's own toolbar.
It is a three-column grid — `1fr auto 1fr` — rather than spacers, so the switch
is centred on the window instead of on whatever room the title and the credit
left over, and it does not drift as those change width. Below 860px the columns
stack, since centring costs more than it is worth once they collide. The review
board keeps its own bar and is untouched: it is a way of looking at a document
rather than a third mode, so the switch has no business there.

**A third way to set a colour: its own shades.** A tool on the bar opens the
tints and shades of that colour over it, one click each. It is deliberately
not a lightness ladder invented for the board — it is `createPalette` and
`generateRamp` at the document's gamut, so the strip is the ramp the other
half would build from this colour and the step you pick is one the tool
already stands behind, chroma held to what the hue can carry there. The colour
you are on is in the strip, marked, wherever its own lightness puts it, so the
gesture reads as *move from here* rather than *choose again*. A step whose
chroma did not fit is picked as the colour that was drawn rather than the one
the curves asked for: nobody should be able to choose a colour they were never
shown, and the scheme's in-gamut promise survives.

It was a modal `<dialog>` first, for the Escape and the click-away that come
free with one, and that was wrong in a way worth recording: `showModal` makes
the whole document inert, and this board is a wall of colour with nothing else
on it. The backdrop had to stay transparent — the other colours are exactly
what the choice is being made against — so what you got was every bar lit,
nothing dimmed, and none of it answering. It read as an application that had
hung, and it was reported as one. It is a panel inside the bar now, dismissed
by hand on Escape, on a press outside it, and on the pointer leaving; the
board behind stays alive while you choose. `spaceRolls` had to learn about it,
since the guard it used looked for `dialog[open]` and a panel is not one —
`OVERLAY_SELECTOR` names both, so a press meant to choose a shade cannot roll
five new colours instead.

**The other half is called RAMPS, and SCHEME is what opens.** The switch said
`TINTS & SHADES`, which is what the tool made when it was the whole tool; beside
a one-word label it was three words describing the technique rather than naming
the output, and `RAMPS` is what everything in the codebase already calls the
thing. The default went with it: choosing colours that go together comes before
opening any one of them out, so that is the honest first screen. The mode is
remembered in a key of its own — a view preference, like the review board's
layout, never part of a document link — so anyone who works in ramps says so
once. A link that names a mode still wins, and a link carrying palettes but no
mode is read as a document, since only the scheme board writes `m=`. The
page title lost the suffix it never should have kept once there were two modes.

**The `steppedBase()` cleanup is done**, and the reason for it turned out not
to be quite the one written at the foot of this file. Undo was never actually
at risk: `history.ts` keeps snapshots, so stepping back restores a state rather
than replaying the action that made it. The live bug is React's own: a reducer
is invoked more than once for the same action — twice on every dispatch under
StrictMode, which exists precisely to surface this — and one that rolled inside
answered differently each time, so the colour that survived was not the colour
the first run produced.

`{ type: 'new' }` therefore carries a seed, exactly as `generate` does, and
`mulberry32` moved out of `color/scheme.ts` into `state/random.ts` beside
`rollSeed`, which is now the one line in the app that calls `Math.random`. It
belongs in `state/` rather than beside the generators because a seed is a
property of the *action*: `color/` takes an `rng` and asks nothing about where
it came from. The document tests take a seed with the action too, so the
quick-add's colour is now something they can name rather than bound.

### Where it lives

| | |
| --- | --- |
| `src/color/scheme.ts` | profiles, `hueSequence`, `generateScheme` |
| `src/ui/Masthead.tsx` | the shared header, identical in both modes |
| `src/state/scheme.ts` | `SchemeState`, the reducer, `coalesceKey` |
| `src/state/useScheme.ts` | the hook, over the existing `withHistory` |
| `src/state/random.ts` | `mulberry32`, and the one `Math.random` in the app |
| `src/state/mode.ts` | the two halves, and which one opens |
| `src/ui/SchemeBoard.tsx` | the board, the toolbar, the keyboard |
| `src/ui/SchemeBar.tsx` | one colour, full height |
| `src/ui/ShadePicker.tsx` | that colour's tints and shades, inside its bar |
| `src/ui/SchemeExportDialog.tsx` | text, PNG and SVG |
| `src/ui/ModeSwitch.tsx` | the masthead control |
| `src/export/scheme.ts` | a slot dressed as a `Swatch` |

Tests: 23 in `color/scheme.test.ts`, 41 in `state/scheme.test.ts` (reducer,
undo, and the link round-trip), 5 in `state/random.test.ts`, and more in
`App.test.tsx` for the board, the export, the shades and which half opens. 574
across the suite, all green.
