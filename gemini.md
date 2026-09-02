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
│   │   ├── oklch.ts            # Culori wrappers, strict gamut mapping, WCAG 2.1 contrast, formatting
│   │   ├── presets.ts          # Default curve generators, adaptive fitting, base pinning
│   │   ├── ramp.ts             # PaletteConfig -> Swatch[] generation, clipping & duplicate detection
│   │   └── shapes.ts           # One-click curve presets (Flat, Linear, Arc, Ease)
│   ├── export/                 # Export engines (Code, Tokens, Canvas, SVG)
│   │   ├── export.test.ts      # Unit tests for text serializers & SVG generators
│   │   ├── formats.ts          # Hex, OKLCH, CSS Vars, Tailwind, SCSS, JSON token formats
│   │   └── image.ts            # Pixel-grid Canvas PNG generator & Figma-compatible SVG generator
│   ├── state/                  # Multi-palette state, history, URL, and persistence
│   │   ├── document.test.ts    # Tests for document actions, selection, and URL codecs
│   │   ├── document.ts         # Document reducer (add, remove, reorder, rename, select)
│   │   ├── history.test.ts     # Tests for undo/redo and time-windowed coalescing
│   │   ├── history.ts          # Generic snapshot-based undo/redo engine with coalescing
│   │   ├── paletteReducer.ts   # Reducer for an individual palette
│   │   ├── storage.ts          # localStorage sync ('colors.pantoine.com/v1') with merge logic
│   │   ├── url.ts              # Compact URL hash encoder/decoder (multi-palette separated by '~')
│   │   └── useDocument.ts      # React hook coordinating state, history, and WeakMap ramp caching
│   ├── ui/                     # Brutalist React UI components
│   │   ├── BaseColorInput.tsx  # Text input + native color picker for base color
│   │   ├── CurveEditor.tsx     # Interactive SVG curve editor (tangent handles, keyboard controls)
│   │   ├── CurvePanel.tsx      # Channel box with numeric endpoints, shapes, and curve editor
│   │   ├── ExportPanel.tsx     # Copy/download buttons for text, PNG, SVG, and share link
│   │   ├── NumberField.tsx     # Controlled numeric input with draft state to avoid caret fighting
│   │   ├── PaletteRow.tsx      # Row in the document stack (title, move/delete, ramp strip)
│   │   ├── RampStrip.tsx       # Horizontal swatch strip with metadata and clip indicators
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

### 3.2 State Management & Persistence (`src/state/`)

- **Document Model (`document.ts`)**:
  - A Document is a list of `PaletteEntry` items (`{ id, name, state }`) with a `selectedId` and a `gamut`.
  - **Global Steps**: The step count is unified document-wide across all palettes. Modifying steps updates every palette in the document stack simultaneously, and new palettes inherit the current document step count.
  - **Global Gamut**: The target gamut is document state, not a view preference, because it decides how much chroma every derived curve may ask for. `setGamut` rebuilds each palette's chroma curve only where it was still derived (`regamut`), leaving hand-edited curves alone — the same rule `setBaseIndex` follows. `paletteReducer` takes the gamut as its third argument so every derivation sees the one in force.
  - Adding a palette (`new`) offsets the base hue by $72^\circ$ around the color wheel to help build harmonious color schemes.
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

---

## 4. UI Features & Interactions

- **Global Step Count**: One control in the top header bar — where the document-level controls live — adjusting the number of steps (5–21) across all palettes simultaneously. Not duplicated in the toolbox: two fields driving one value read as though the palette under the toolbox had a count of its own.
- **Per-Channel & Document-Wide Curve Sync**: "Apply all" button in each channel panel (Lightness, Chroma, Hue shift) to sync individual curves across all palettes, plus a "Match all curves" button in the toolbox to sync all three curves at once. Applying a curve a palette already has returns the same state, so it does not become an undo entry.
- **Color Gamut Selector**: Dropdown switching the whole document between **sRGB**, **Display P3**, **Adobe RGB**, and **Rec. 2020**. It steers derivation as well as preview: chroma ceilings, corner clipping triangles, and tooltips all follow it, and it travels in the share link and the autosave.
- **Numeric Fields (`NumberField`)**: `type="text"` with `inputMode="decimal"`, not `type="number"`. A number input's value sanitiser discards anything that is not a valid float, so a comma decimal ("0,85") arrived as an empty string and the digits were lost on blur; its spinner also clipped visible digits. Arrow-key stepping (shift for a coarser nudge) is implemented here as a result. Blur commits, but only a change the field can actually display — an unguarded commit would mark the channel hand-edited and push an undo entry merely for tabbing past it.
- **Ramp Dividers**: Toggleable "Hide dividers / Show dividers" to evaluate color steps meeting edge-to-edge without boundary illusion interference.
- **Canvas Contrast**: Light / Dark ground toggle (`data-canvas="dark"` on `document.documentElement`).
- **Bare Mode**: "Hide tools" button to review swatches cleanly across multiple palettes without editor clutter.
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
| `npm test` | Run Vitest test suite (runs 124+ tests across 8 suites) |
| `npm run build` | TypeScript compile check (`tsc -b`) and Vite production build (`dist/`) |
| `npm run preview` | Preview production build locally |

### Invariant & Test Notes

- **Vitest Config (`vite.config.ts`)**:
  - `test.css: true` is required because `App.test.tsx` tests the raw stylesheet (`styles.css?raw`) to verify swatch borders and reset styles.
- **Color Invariant Tests (`base.test.ts`, `color.test.ts`, `gamut.test.ts`)**:
  - Asserts that for realistic positions across diverse hues (yellow, violet, cyan, red, green, navy, slate), lightness strictly descends and the base color appears exactly at its assigned step.
  - Verifies that wide-gamut colors are accurately classified and mapped across sRGB, P3, Adobe RGB, and Rec. 2020.
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
- Seamless ramp view & bare display modes.
- **Wide Gamut Selection (Display P3, Adobe RGB, Rec. 2020)**: Real-time clipping re-evaluation, CSS Color 4 preview, gamut-aware chroma ceilings driving derivation, `color()` copy and CSS export, and the gamut carried in the share link and autosave.
- **Global Step Count**: Unified step count across all palettes in the document.
- **Per-Channel & All-in-One Curve Sync**: "Apply all" buttons on Lightness, Chroma, and Hue shift curve panels, alongside "Match all curves" in the toolbox.

### Potential Future Enhancements
- **APCA Contrast**: Advanced Perceptual Contrast Algorithm calculations alongside existing WCAG 2.1 ratios.
- **Automated Neutral / Gray Scale Derivation**: Generating tinted grays derived from a palette's base hue with suppressed chroma.
