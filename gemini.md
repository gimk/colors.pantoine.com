# colors.pantoine.com — Technical Architecture & Project Guide

`colors.pantoine.com` is a client-side palette engineering tool for designing perceptual tint and shade ramps from a base color. Instead of relying on rigid, linear lighten/darken steps or non-perceptual color spaces (like HSL), it gives designers direct control over **Lightness**, **Chroma**, and **Hue shift** through independent cubic Bézier curves evaluated in the **OKLCH** color space.

---

## 1. Core Principles & Philosophy

1. **Perceptually Uniform (OKLCH, not HSL)**:
   - HSL lightness is distorted (e.g. yellow at `L=50%` appears dramatically brighter than blue at `L=50%`).
   - OKLCH models human visual perception, guaranteeing that constant steps in lightness genuinely appear uniform.
2. **Free-Form Tangent Bézier Curves**:
   - Each channel is controlled by a cubic Bézier with two anchors (Start and End) and two freely draggable tangent handles.
   - Handle heights can move anywhere within the channel bounds, allowing non-monotonic curves (peaks, dips, humps, arcing hue).
   - Hue is stored as a **delta** ($\Delta H \in [-90^\circ, +90^\circ]$) relative to the base color's hue, preserving curvature when re-basing.
3. **Gamut-Aware Adaptive Defaults**:
   - Every RGB gamut is irregular: yellow can support high chroma only when light, whereas blue supports high chroma when dark.
   - The default chroma curve samples the chroma ceiling of the **document's target gamut** across lightness steps and fits a curve that maintains a proportional fraction of the ceiling. Widening the gamut therefore changes the shape of every derived curve, not just the preview.
4. **Base Color as a Strict Fit Constraint**:
   - The base color is not bent into place after curve fitting (which causes severe distortion and gamut clipping); it is incorporated directly as a Lagrange multiplier constraint during least-squares curve fitting.
5. **Strict Gamut Mapping**:
   - Instead of standard CSS Color 4 gamut mapping (which allows up to $\sim 9^\circ$ of hue drift for minimal chroma gains), culori's `toGamut` is run with `jnd = 0`, holding hue within $0.5^\circ$ while reducing chroma.
   - Visibly clipped swatches are flagged with an angular corner notch (`CHROMA_JND = 0.004`).
6. **Zero Backend / Serverless**:
   - State lives in the URL hash and `localStorage`. Links encode the complete state of all palettes.
7. **Brutalist UI**:
   - Black/white chrome, $1\text{px}$ rules, no border radii, no drop shadows, monospace typography. All visual color belongs solely to the swatches.

---

## 2. Directory Structure

```
colors.pantoine.com/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions deploy to GitHub Pages (gates on npm test)
├── public/
│   ├── CNAME                   # Custom domain: colors.pantoine.com
│   └── favicon.svg             # App favicon
├── src/
│   ├── color/                  # Mathematical and color science core
│   │   ├── base.test.ts        # Invariant tests: base color placement & monotonicity
│   │   ├── bezier.ts           # Cubic Bézier evaluation & Newton-Raphson/bisection inversion
│   │   ├── color.test.ts       # Mathematical tests for Béziers, curves, and ramp generation
│   │   ├── curve.ts            # Channel definitions, IRLS curve fitting, Lagrange constraints
│   │   ├── gamut.test.ts       # Wide-gamut clipping and mapping tests across color spaces
│   │   ├── gamut.ts            # Binary search for maximum chroma at given L and H per gamut
│   │   ├── harmony.test.ts     # Tests for harmony offsets, gamut safety, and pastel preservation
│   │   ├── harmony.ts          # Colour-harmony rules as OKLCH hue rotations from a seed
│   │   ├── oklch.ts            # Culori wrappers, strict gamut mapping, WCAG 2.1 contrast, formatting
│   │   ├── presets.ts          # Default curve generators, adaptive fitting, base pinning
│   │   ├── ramp.ts             # PaletteConfig -> Swatch[] generation, clipping & duplicate detection
│   │   ├── shapes.ts           # One-click curve presets (Flat, Linear, Arc, Ease)
│   │   ├── slice.test.ts       # Tests for the constant-hue slice: boundary, cusp, axis, cells
│   │   └── slice.ts            # Constant-hue slice geometry for the picker (wedge, cusp, hue strip)
│   ├── export/                 # Export engines (Code, Tokens, Canvas, SVG)
│   │   ├── export.test.ts      # Unit tests for text serializers & SVG generators
│   │   ├── formats.ts          # Hex, OKLCH, CSS Vars, Tailwind, SCSS, JSON token formats
│   │   └── image.ts            # Pixel-grid Canvas PNG, whole-board PNG & SVG, Figma-compatible layers
│   ├── state/                  # Multi-palette state, history, URL, and persistence
│   │   ├── document.test.ts    # Tests for document actions, selection, and URL codecs
│   │   ├── document.ts         # Document reducer (add, remove, reorder, rename, select)
│   │   ├── history.test.ts     # Tests for undo/redo and time-windowed coalescing
│   │   ├── history.ts          # Generic snapshot-based undo/redo engine with coalescing
│   │   ├── paletteReducer.ts   # Reducer for an individual palette
│   │   ├── review.test.ts      # Tests for the splitter arithmetic and the board's pixel tracks
│   │   ├── storage.ts          # localStorage sync ('colors.pantoine.com/v1') with merge logic
│   │   ├── url.ts              # Compact URL hash encoder/decoder (multi-palette separated by '~')
│   │   ├── useDocument.ts      # React hook coordinating state, history, and WeakMap ramp caching
│   │   └── useReview.ts        # Review-board layout (axis, spacing, weights) + its own localStorage key
│   ├── ui/                     # Brutalist React UI components
│   │   ├── BaseColorInput.tsx  # Text input + swatch that opens the OKLCH picker
│   │   ├── ColorPicker.test.tsx  # Tests for slice geometry, gamut wedge, and clipping readout
│   │   ├── ColorPicker.tsx     # OKLCH picker: L/C slice with drawn gamut wedge, hue strip, fields
│   │   ├── ColorPickerDialog.tsx # Modal wrapper and the swatch that opens it
│   │   ├── CurveEditor.tsx     # Interactive SVG curve editor (tangent handles, keyboard controls)
│   │   ├── CurvePanel.tsx      # Channel box with numeric endpoints, shapes, and curve editor
│   │   ├── ExportPanel.tsx     # Copy/download buttons for text, PNG, SVG, and share link
│   │   ├── NewPaletteDialog.test.tsx # Tests for both panes, rule rows, and dialog styling
│   │   ├── NewPaletteDialog.tsx  # Guided new-palette modal: paste a list, or pick from a harmony
│   │   ├── NumberField.tsx     # Controlled numeric input with draft state to avoid caret fighting
│   │   ├── PaletteRow.tsx      # Row in the document stack (title, move/delete, ramp strip)
│   │   ├── RampStrip.tsx       # Swatch strip: either axis, fixed or filling, per-step weights
│   │   ├── ReviewBoard.tsx     # The review board: bar, two resize rulers, the bands, board PNG
│   │   ├── Toolbox.tsx         # Contextual controls for currently selected palette
│   │   └── useCopy.ts          # Hook managing clipboard write and transient "copied" indicators
│   ├── App.test.tsx            # SSR smoke tests and DOM structure assertions
│   ├── App.tsx                 # Root application component
│   ├── main.tsx                # React 19 entrypoint
│   └── styles.css              # Brutalist stylesheet (CSS variables, dark/light theme, layout)
├── index.html                  # HTML entrypoint
├── package.json                # Dependencies, build & test scripts
├── tsconfig.json               # TypeScript configuration (strict, ES2022, bundler module resolution)
└── vite.config.ts              # Vite & Vitest configuration
```

---

## 3. Technical & Mathematical Architecture

### 3.1 Color Engine (`src/color/`)

- **`oklch.ts`**:
  - Leverages `culori` for color model conversions (`oklch`, `rgb`, `p3`, `a98`, `rec2020`).
  - Supports multiple target gamuts: **sRGB** (`rgb`), **Display P3** (`p3`), **Adobe RGB** (`a98`), and **Rec. 2020** (`rec2020`).
  - `CHANNEL_TOLERANCE = 0.5 / 255`: Prevents false clipping warnings for values that round cleanly into 8-bit channels.
  - `mapToGamut(color, gamut)`: Strict gamut reduction using culori's `toGamut(mode, 'oklch', null, 0)` holding hue fixed. Emits `displayColor` using CSS Color 4 `color(display-p3 ...)` / `color(a98-rgb ...)` for wide gamut preview, and `chroma` / `chromaLost` / `clipped` measured against that gamut.
  - `hex` is **always the strict sRGB map of the request**, never `formatHex` of a wide-gamut value: clamping P3 channels into 8-bit is precisely the hue-drifting clip the `jnd = 0` search exists to avoid, and `hex` is what every text and image export writes. A wide-gamut palette therefore exports a faithful sRGB rendition, and `toColorCss` / the `color()` formats carry the wide-gamut colour itself.
  - `isInGamut(color, gamut)` applies the channel tolerance above; `settle()` rounds mapped channels to 4 places so a copied `color()` does not print the boundary's float dust.
  - Computes WCAG 2.1 relative luminance and contrast against black (`L=0`) and white (`L=1`).
- **`bezier.ts`**:
  - Evaluates $y(x)$ for cubic Bézier curves where anchors are fixed at $x=0$ and $x=1$.
  - Solves for parameter $t$ given horizontal position $x$ using Newton-Raphson iteration (up to 8 steps), falling back to binary bisection (up to 32 steps) if slope goes flat.
  - Computes the Bernstein basis $[(1-t)^3, 3(1-t)^2 t, 3(1-t) t^2, t^3]$ used for closed-form solving in curve fitting.
- **`gamut.ts`**:
  - `maxChromaFor(l, h, gamut)`: Performs binary search up to precision $10^{-4}$ against `isInGamut` to determine the maximum achievable chroma for any given lightness and hue in the target gamut (sRGB, P3, Adobe RGB, Rec. 2020).
- **`slice.ts`**:
  - Geometry for the constant-hue slice the picker draws. Pure and unit-scaled (x and y in $[0, 1]$, lightness 1 at the top), so the component owns the pixels and this owns the colour.
  - `AXIS_MAX`: the widest chroma each gamut reaches anywhere — sRGB `0.33`, P3 `0.37`, Adobe RGB `0.39`, Rec. 2020 `0.46` — measured by sweeping `maxChromaFor` across every hue and lightness. **Fixed per gamut, not normalised per hue**: the axis has to mean the same thing as the hue turns, or the wedge would breathe and the marker would slide sideways while the colour held still. The cost is genuine dead space (cyan's cusp is $0.161$, magenta's $0.294$), and that asymmetry is itself information.
  - `gamutBoundary(h, gamut)`: 97 samples of `maxChromaFor` tracing the wedge outline from black up to white.
  - `cuspFor(h, gamut)`: the hue's most saturated colour, found by ternary search refining around the widest sample. The cusp is a corner where two gamut faces meet, so it falls between samples and a coarse peak understates it.
  - `sliceCells(h, gamut)`: the painted body, as 22 rows of 28 cells with each row **fitted** to the gamut width at its own lightness rather than a uniform grid clipped to the wedge. Every cell is therefore inside the gamut — its colour is exact rather than something the mapper had to talk down — and no half-cell fringe is left where a clip would have cut through. The exact boundary is stroked over the resulting staircase.
  - `boundaryChromaAt(l, h, gamut)`: the exact, unquantised ceiling. Used for the out-of-gamut indicator, which sits on the edge by definition and where a degree of error would show.
  - **Caching**: a slice costs a measured 1.8 ms in sRGB and 6.2 ms in Rec. 2020 to build — far too much to repeat per frame. Entries are keyed to the **nearest degree**, since the wedge changes shape far more slowly than that; this caps a full hue sweep at 360 builds per gamut and lets a pass back over the same hues come out of the cache. A lightness or chroma drag holds the hue still and so runs entirely out of it. The marker and the readout always use the exact hue — only the painted body is shared between neighbours.
- **`curve.ts` & `presets.ts`**:
  - Channels:
    - **Lightness**: Range $[0, 1]$, step $0.005$, default bounds $0.97 \to 0.16$.
    - **Chroma**: Range $[0, 0.4]$, step $0.002$.
    - **Hue shift**: Range $[-90^\circ, +90^\circ]$, step $0.5^\circ$.
  - **Constrained Least Squares**: Solves linear systems via Gauss-Jordan elimination with Lagrange multipliers to satisfy exact pass-through constraints (endpoints and base color).
  - **Iterative Reweighted Least Squares (IRLS)**: Runs 5 passes with an overshoot penalty of 6 to penalize curves going above the gamut ceiling.
  - **`stepsAreMonotonic`**: Verifies that sampled step values never reverse direction (within tolerance $0.002$).
  - **`bendThrough`**: Exact closed-form adjustment shifting handles first (and anchors only if handles run out of headroom) to pass through a target point while preserving bounds.
  - **Base Lock (`baseLocked`)**: Corrects curves dynamically during edits so that the base color step remains fixed at the exact requested OKLCH coordinates.

- **`harmony.ts`**:
  - Eight classic rules as **hue rotations in OKLCH**, not on the artist's HSB wheel. Measured both: the HSB complement of `#0044ff` lands at $L0.83$ against the seed's $L0.51$, so the source and the new palette would carry completely different weight, while OKLCH holds lightness. The hue families land in the same place regardless — within $5$–$25^\circ$ of the HSB answer across the seeds checked — so the artist's-wheel intuition is not lost.
  - Offsets never include $0$: the seed is already a palette in the document, so offering it back would only duplicate one.
  - Chroma is `min(seed.c, maxChromaFor(seed.l, newHue, gamut))`. Holding a *share* of the ceiling — the trick `chromaCurveFor` uses — was tried and rejected: it breaks on pastels, turning `#f0abfc` (94% of its own modest ceiling) into `#45ef2c`, a screaming lime, where capping gives `#96de8c`. A vivid seed already sits at its ceiling, so capping hands it the most saturated colour each hue can hold, and every candidate is inside the gamut **by construction** — none needs a clipped marker.
  - `hasUsableHue` refuses a grey rather than offering eight identical swatches: hue is meaningless below `CHROMA_JND`.

### 3.2 State Management & Persistence (`src/state/`)

- **Document Model (`document.ts`)**:
  - A Document is a list of `PaletteEntry` items (`{ id, name, state }`) with a `selectedId` and a `gamut`.
  - **Global Steps**: The step count is unified document-wide across all palettes. Modifying steps updates every palette in the document stack simultaneously, and new palettes inherit the current document step count.
  - **Global Gamut**: The target gamut is document state, not a view preference, because it decides how much chroma every derived curve may ask for. `setGamut` rebuilds each palette's chroma curve only where it was still derived (`regamut`), leaving hand-edited curves alone — the same rule `setBaseIndex` follows. `paletteReducer` takes the gamut as its third argument so every derivation sees the one in force.
  - **Adding palettes**: `new` is the no-dialog quick-add and offsets the base hue by 72° around the wheel. `add` takes a list of `{ base, name? }` and appends one palette per colour — the action behind the guided modal. It drops bases `parseToOklch` rejects (a batch has no field left to keep typing in, unlike `setBase`), hands back the state it was given when nothing survives so no empty undo entry is recorded, truncates at `MAX_PALETTES`, and lands the selection on the *first* of the batch, following the rule a shared link already follows. Names go through one uniqueness pass: the name rides inside the encoded link segment and the merge in `storage.ts` de-dupes segments through a `Set`, so two identical names can cost a palette.
  - Moving/reordering with `move(-1 | 1)` and deletion (guarded so at least one palette always remains).
- **Undo / Redo with Smart Coalescing (`history.ts`)**:
  - Snapshot-based history holding up to 100 past states.
  - Coalesces rapid sequential edits (such as dragging handles or typing hex/name) within a `700ms` window using action keys (`curve:key:control`, `endpoint:key:end`, `rename:id`, etc.).
  - Distinguishes transient actions (`select`) so changing active palette does not pollute the undo stack.
- **Serialization & URL Encoding (`url.ts`)**:
  - Encodes palettes as readable query params: `c` (base hex), `n` (name), `s` (steps), `b` (baseIndex), `x` (locked), `l` (lightness curve), `k` (chroma curve), `h` (hue curve).
  - Joins multiple palettes using `~` (URI unreserved character).
  - The document gamut rides in a leading `g=<gamut>` segment, omitted at the sRGB default. It carries no palette key, so `decodeDocument` drops it exactly as it drops any unreadable segment — which is what lets an older reader open a newer link. `decodeGamut` reads it back, defaulting to sRGB.
  - `restoreBaseColor` re-attaches the stripped `#` only for a bare hex string (3, 4, 6 or 8 hex digits), so an `oklch()`, `rgb()`, `hsl()`, `color()` or named base survives the round trip.
  - Fully backwards-compatible with single-palette URL hashes.
- **LocalStorage Autosave (`storage.ts`)**:
  - Saved under key `colors.pantoine.com/v1`, as the same hash string a share link carries — so the gamut is stored with it and there is one deserialiser to trust.
  - When loading from a shared link, foreign palettes are merged into existing local storage without erasing prior user work. A link that brings new palettes also brings its gamut, since otherwise its colours would not be the ones the sender saw.
- **Review Layout Store (`useReview.ts`)**:
  - Its own key, `colors.pantoine.com/review/v1`, kept apart from the document key on purpose: the layout says *how you are looking* at the palettes, not what you made, so it never travels in a share link and a mangled layout cannot take the document down with it.
  - Sizes are held as **weights, never pixels**. A weight is a share of whatever room there is, and the grid tracks are `flex-grow` over a zero `flex-basis`, so a band's size is exactly its fraction of the axis. That is what makes the board fit the window *by construction* rather than by clamping something against the viewport.
  - `splitPair` is the whole of the resize behaviour and is pure: it moves share between two neighbours and returns their pair total **unchanged**. Nothing in the UI can add weight, which is why no arrangement can push the board out of the window. A `MIN_BAND` floor (10px, or half the pair when the pair is smaller than two floors) keeps a band grabbable — a band dragged to nothing cannot be dragged back.
  - Palette weights are keyed by **id in memory** but serialised as an **array in document order**. Palette ids are per-session handles that `document.ts` regenerates on every load, so an id is the right key while dragging a palette should carry its thickness with it, and a meaningless one on disk. Order is what persists, so order is what the stored weights are pinned to.
  - `stepWeightsFor` reconciles the step-weight array's length **on read** rather than subscribing to the document: the step count is global, and nine stored shares say nothing about a ramp of fifteen. Nothing to subscribe to is nothing to get out of sync.
- **Performance Caching (`useDocument.ts`)**:
  - Ramps are derived and cached using a `WeakMap<PaletteConfig, Map<Gamut, Swatch[]>>`. Because `PaletteConfig` is treated as immutable, re-renders and undo/redo operations avoid re-computing gamut mappings, and switching gamut back and forth re-uses both sets.

### 3.3 Export Engine (`src/export/`)

- **Code & Tokens (`formats.ts`)**:
  - Hex list (`txt`)
  - OKLCH list (`txt`)
  - CSS custom properties (`css`, in Hex, OKLCH, or `color()`)
  - Tailwind object scale (`js`)
  - SCSS map (`scss`)
  - JSON containing detailed step data (Hex, `color()` display value, OKLCH, L/C/H components, clipping flag, WCAG contrast ratios) plus the document `gamut` — named because `clipped` is relative to it while `hex` is not.
  - Every hex-valued format is sRGB whatever the document gamut, so the `color()` CSS format is the one that ships what a wide-gamut palette actually shows.
- **Images & Vector Graphics (`image.ts`)**:
  - **PNG**: Rendered on an integer-aligned HTML `<canvas>` without borders or gaps, ensuring accurate pipetting/eyedropping in external design software. Optional label strip. Directly copyable to clipboard as `image/png` or downloadable.
  - **SVG**: Generates SVG with individual named `<rect>` elements (`{palette}-{label}`) ready for pasting directly as editable layers into Figma.
  - **Board PNG (`drawBoard` / `copyBoardPng`)**: the whole review board as one image, arranged exactly as it is on screen — same axis, spacing, weights, names and stamped values. Copied at a fixed 2000px long edge with the board's own proportions, so a paste is usable whatever window it was arranged in. Values arrive on `BoardPalette.values` **pre-formatted by the caller**, so this file stays out of the business of knowing formats and gamuts and the image cannot disagree with the board about what a step reads as. Text is boxed in ink with knocked-out glyphs (as on screen), and any box that will not fit its cell is dropped rather than spilling; the palette name is drawn last, so a band thin enough for the two to meet keeps the mark that says which palette it is.
  - **Board SVG (`boardSvg`)**: the same geometry as vector rectangles, one `<g>` per palette. **No background and no baked text**, unlike the PNG — this exists to be pasted into Figma as editable layers, and there the labels are better carried as *names*: the group takes the palette's name and each rect takes its step's, so the layer panel reads the board back to you. Copied as text through the shared `useCopy`, exactly as the export panel's own Copy SVG is.
  - `tracks` is the pixel twin of the board's `fr` grid, and the rounding is the entire problem it solves: boundaries are rounded **once, cumulatively**, and each span is the distance between two of them. Rounding each span independently lets the error accumulate into a 1px seam of background between two steps — and a pipette landing on a seam picks the seam, which is the one thing this file exists to prevent. The gaps between palettes are painted in the active canvas colour, since the spacing is being judged against that ground.

---

## 4. UI Features & Interactions

- **Guided New Palette (`NewPaletteDialog`)**: `+ New palette` opens a modal with two panes, because a 72° hue step is a fair guess for a second ramp and a poor one for a fifth — a five-palette document ends up being the hue wheel walked in equal steps whatever the brand actually is. The 72° step survives beside it as a `+72°` quick-add for when another ramp is all that is wanted.
  - **Paste**: one or many colour strings in any format CSS accepts, separated by newlines, commas, semicolons or spaces, one palette per colour. `parseColorList` tokenises **parenthesis-aware**, because the obvious split on commas and whitespace shreds `rgb(1, 2, 3)` and `oklch(0.54 0.247 293)`. Tokens that parse to nothing are listed rather than silently dropped, and the text goes through as the base **verbatim** — re-emitting it as `oklch()` would round a colour sitting on the gamut boundary (#00ff66 comes back #05ff66).
  - **Harmony**: pick any swatch already in the document as a seed, then a rule. Candidates are named after the rule, and a candidate *is* formatted as `oklch()` since it has no original text — hex would be worse than a rounding, because `toHex` gamut-maps to sRGB first and `chromaCurveFor` would then derive the whole ramp from that reduced chroma against the wide ceiling.
  - **All rules** is the first entry in the rule list and renders every rule's row at once, to compare. Each row is led by the seed, dashed and not clickable, which is what makes a one-candidate rule like Complementary read as a relationship rather than a lone swatch.
  - Both variable regions are **fixed height with their own scroll**. The dialog is centred, so a region that grows re-centres the whole modal — between keystrokes in the paste preview, and by eight rule rows at once under All rules. Same lesson as `.cpick`, different cause.
- **Global Step Count**: One control in the top header bar — where the document-level controls live — adjusting the number of steps (5–21) across all palettes simultaneously. Not duplicated in the toolbox: two fields driving one value read as though the palette under the toolbox had a count of its own.
- **Per-Channel & Document-Wide Curve Sync**: "Apply all" button in each channel panel (Lightness, Chroma, Hue shift) to sync individual curves across all palettes, plus a "Match all curves" button in the toolbox to sync all three curves at once. Applying a curve a palette already has returns the same state, so it does not become an undo entry.
- **Color Gamut Selector**: Dropdown switching the whole document between **sRGB**, **Display P3**, **Adobe RGB**, and **Rec. 2020**. It steers derivation as well as preview: chroma ceilings, corner clipping triangles, and tooltips all follow it, and it travels in the share link and the autosave.
- **Numeric Fields (`NumberField`)**: `type="text"` with `inputMode="decimal"`, not `type="number"`. A number input's value sanitiser discards anything that is not a valid float, so a comma decimal ("0,85") arrived as an empty string and the digits were lost on blur; its spinner also clipped visible digits. Arrow-key stepping (shift for a coarser nudge) is implemented here as a result. Blur commits, but only a change the field can actually display — an unguarded commit would mark the channel hand-edited and push an undo entry merely for tabbing past it.
- **Canvas Contrast**: Light / Dark ground toggle (`data-canvas="dark"` on `document.documentElement`).
- **Review Board (`ReviewBoard`)**: `Review` replaces the old `Hide labels` and `Hide tools` toggles. Between them those two could put the editor into four states and only one was ever wanted — tools away, labels off — and as a **mode** of its own that state can also carry a *layout*, which a pair of toggles could not. The editor is consequently always labelled and always has its header; the board is colour, palette names, and nothing else.
  - **Two layouts**: `Rows` (palettes as horizontal bands stacked down the window, as in the editor) and `Columns` (palettes as vertical bands stacked across it). Step count is document-global, so the board is a perfect N×S grid and `Columns` is simply its transpose — `RampStrip` gained an `orientation` and a `fill` for it rather than the board growing a second chip implementation, so the clipped notch, base badge and copy flash cannot drift between the two modes.
  - **Fits the window, always**: nested flex with `flex-basis: 0` and a per-track `flex-grow`, which is auto-layout's "fill container" and cannot overflow. The `Spacing` slider gaps palettes only — steps within one ramp always meet edge to edge, the same rule the PNG follows and for the same eyedropper reason.
  - **Resize on two rulers, not on the colour**: an L of rulers along the two axes, ticks placed by percentage (no measuring, since a track's size *is* its share). Dragging a tick moves share between the two tracks it divides. Step weights are **board-level, shared by every palette**, so the columns stay aligned across ramps — comparing step 500 across eight palettes only works if the 500s line up. Grips laid over the chips instead would put a strip that cannot be copied either side of every boundary, in the one mode that is nothing but chips.
  - **Drag maths**: sizes are measured once at `pointerdown` and every move recomputes from that snapshot against the total distance travelled. Applying each event's own increment compounds the rounding and the boundary drifts away from the pointer over a long drag.
  - **`Labels` + `Format`**: one switch prints the palette names *and* each step's value on its chip, because both answer the same question — which colour is this — and a board that named its palettes but not its steps would be halfway to the editor's label grid without being any use. The value is **stamped on the chip** (`swatch__stamp`), boxed and centred like the copy flash, rather than in the editor's `swatch__meta` grid row: on filling chips a row under each would eat the colour and put back the very rows the board exists to be rid of. It is the one boxed mark in this UI that is neither uppercased nor tracked out — a value is read and compared, and letter-spacing on a hex makes two of them harder to tell apart. The stamp also **reports the copy in place**, since a second mark landing in the middle of the same chip would collide.
    - The `Format` select drives the **document's** one format (the editor's "Click copies"), not a second of its own: what a chip reads as and what clicking it copies have to be the same string, and two settings for one idea is how you end up showing a hex while copying an `oklch()`.
    - Labels default **on**, because the names are also the visible advertisement that a band can be dragged — a board that opened bare would open with its arranging hidden.
  - **Reordering**: the **whole band** is draggable, not only its name badge, so switching the labels off does not take reordering away with them. Nothing competes for the gesture (resizing is on the rulers), and a native HTML5 drag stays distinct from a click, so a chip still copies. It goes through the document's own `reorder`, so it is a real edit and lands in undo history — which is why `App` keeps every hook above the mode branch.
  - **`Copy PNG` / `Copy SVG`**: the same two gestures the export panel leads with — paste as pixels, or as layers — on the whole board rather than one ramp. Both measure the board's live box so the copy carries the arrangement actually on screen. `Reset sizes` restores every weight to an even share and leaves the axis, spacing and labels alone: those were chosen deliberately, the weights are what a stray drag can wreck.
  - `Escape` or `← Back` leaves. Dark canvas lives in the board's bar too, since judging a ramp against the other ground is a review activity rather than an editing one.
- **OKLCH Base Color Picker (`ColorPicker`)**: Replaces `input[type="color"]`, which speaks sRGB hex only and so cannot express a base on a wide-gamut document. Two views: the **constant-hue slice** (lightness up, chroma across, with the gamut drawn as the curved wedge it is and its cusp marked) and a **hue strip** painted at the lightness and chroma in hand, so it goes visibly flat across hues that cannot hold the chroma being asked for. Three `NumberField`s carry L, C and H, and the readout gives `oklch()` with the sRGB hex beneath it.
  - The slice **respects the document gamut**: switching to Rec. 2020 widens the wedge, since peak chroma runs $0.322$ in sRGB against $0.454$ in Rec. 2020.
  - Out-of-gamut requests are **shown, not forbidden**, consistent with how curve values are treated everywhere else: a dashed spill line and a ring mark where the colour will actually land, both carrying the resolved chroma in their tooltips. Reported **inside the plot only** — every child of `.cpick` is a fixed height on purpose, because the dialog is centred and a notice appearing mid-drag re-centres the modal and pulls the plot out from under the pointer.
  - A **modal `<dialog>`** rather than a popover for a structural reason — the toolbox dock is a `max-height` scroll container, so anything absolutely positioned inside it is clipped at the dock edge. `showModal` escapes that and brings Escape and focus trapping for free.
  - **Picking emits `oklch(...)`** into the base field rather than a hex, which is lossless and would otherwise silently discard a wide-gamut pick. Edits apply live and there is no cancel, because `setBase` coalesces: a whole session at the picker steps back in one undo.
- **Base Color Placement & Lock**: Dropdown to choose which step carries the base color, plus a "Lock base" toggle.
- **Squeezed Steps Notice**: Warns when severe compression causes duplicate hex colors in consecutive steps.
- **Keyboard Shortcuts**:
  - `Ctrl+Z` / `Cmd+Z`: Undo document edit.
  - `Ctrl+Shift+Z` / `Cmd+Shift+Z` or `Ctrl+Y`: Redo.
  - Arrow keys on curve handles: Fine nudge (`Shift` for $10\times$ increment).

---

## 5. Development & Testing Workflow

### Commands

| Command | Action |
|---|---|
| `npm install` | Install project dependencies |
| `npm run dev` | Start Vite local development server |
| `npm test` | Run Vitest test suite (runs 240+ tests across 10 suites) |
| `npm run build` | TypeScript compile check (`tsc -b`) and Vite production build (`dist/`) |
| `npm run preview` | Preview production build locally |

### Invariant & Test Notes

- **Vitest Config (`vite.config.ts`)**:
  - `test.css: true` is required because `App.test.tsx` tests the raw stylesheet (`styles.css?raw`) to verify swatch borders and reset styles.
- **Color Invariant Tests (`base.test.ts`, `color.test.ts`, `gamut.test.ts`)**:
  - Asserts that for realistic positions across diverse hues (yellow, violet, cyan, red, green, navy, slate), lightness strictly descends and the base color appears exactly at its assigned step.
  - Verifies that wide-gamut colors are accurately classified and mapped across sRGB, P3, Adobe RGB, and Rec. 2020.
- **Review Board Tests (`review.test.ts`, `App.test.tsx`)**:
  - `splitPair` is tested for the property the board's fit-the-window promise actually rests on: the pair total comes out unchanged for every drag, the boundary tracks the pointer in proportion, and no band can be squeezed out of existence.
  - `tracks` is tested for contiguity — each span starting exactly where the last ended, the set summing to the total — because the failure mode is a 1px seam a pipette can land on, which no eye test would catch.
  - The board's render tests hand in a plain `ReviewApi` object rather than driving `useReview`, so an axis and a labels state can just be stated; the hook has its own tests for the arithmetic.
  - `boardSvg` is tested for the two properties that make it worth having beside the PNG: named groups and rects (the labels as *layer names*), and no background or baked text to get in the way of editing.
- **GitHub Actions (`.github/workflows/deploy.yml`)**:
  - Deploys automatically to GitHub Pages on pushes to `main`.
  - Enforces `npm test` prior to `npm run build` to prevent mathematical regressions from deploying.

---

## 6. Project Status & Future Roadmap

### Recently Implemented
- Multi-palette document stack (creating, reordering, deleting, renaming palettes).
- Base color pinning / locking (`baseLocked` and `holdBase`).
- Document-level undo/redo with action coalescing.
- Local storage persistence with smart link-merging.
- **Wide Gamut Selection (Display P3, Adobe RGB, Rec. 2020)**: Real-time clipping re-evaluation, CSS Color 4 preview, gamut-aware chroma ceilings driving derivation, `color()` copy and CSS export, and the gamut carried in the share link and autosave.
- **Global Step Count**: Unified step count across all palettes in the document.
- **OKLCH Color Picker**: Constant-hue slice with the gamut wedge drawn and its cusp marked, a live hue strip, numeric L/C/H, and an out-of-gamut readout — replacing the sRGB-only system picker.
- **Per-Channel & All-in-One Curve Sync**: "Apply all" buttons on Lightness, Chroma, and Hue shift curve panels, alongside "Match all curves" in the toolbox.
- **Gamut Chroma Ceiling on the Chroma Graph**: the boundary drawn dashed with the unreachable region hatched above it, and the step dots plotted where the colour actually landed with a leader back up to the curve.
- **Guided New Palette**: a modal to paste a list of colours, or to pick a base from a colour harmony built on any swatch already in the document, with an "All rules" view for comparing every rule at once.

- **Review Board**: the whole document at once as a fit-to-window N×S board, in rows or columns, with palette spacing, drag-to-reorder, splitter resizing of both palettes and steps on a pair of rulers, an optional label stamping each step's value (in any format) plus the palette names, and the arrangement copyable as one PNG or as grouped, named SVG layers. Replaces the `Hide labels` and `Hide tools` toggles.

### Potential Future Enhancements
- **APCA Contrast**: Advanced Perceptual Contrast Algorithm calculations alongside existing WCAG 2.1 ratios.
- **Automated Neutral / Gray Scale Derivation**: Generating tinted grays derived from a palette's base hue with suppressed chroma.
- **Live Reordering on the Board**: the board keeps the editor's HTML5 drag-and-drop, which shuffles on drop rather than under the pointer. Pointer-driven reordering would preview the new order as the palette moves, at the cost of hand-rolling what the browser currently provides.
- **True Full Screen on the Board**: `requestFullscreen` to drop the bar as well, for showing a palette set to a room.
