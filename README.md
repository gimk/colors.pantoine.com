# colors.pantoine.com

A tint and shade palette builder, driven by curves in OKLCH.

**[colors.pantoine.com](https://colors.pantoine.com)**

## Why

Every tint and shade tool I found online runs the same formula: take the colour,
lighten it by a fixed step, darken it by a fixed step, done. None of them let me
correct saturation along the ramp, or shift the hue a little as it goes light and
dark. So the palettes all come out flat, and the dark end goes to mud.

So I built my own, on OKLCH colour science instead of HSL. Better, more colourful,
more subtle palettes — and I hope it helps other designers on their next
rebranding.

## Features

- **Three curves per palette** — lightness, chroma and hue, each a cubic Bézier
  you drag. This is the saturation correction and the hue shift the other tools
  don't give you.
- **The base colour stays exact.** The ramp contains the colour you typed. Lock
  it and the curves hold it while you edit around it.
- **Chroma defaults to the gamut.** Yellow holds chroma only while it is light,
  blue only while it is dark. The default curve follows that per hue, instead of
  sending both into mud.
- **Many palettes in one document** — 5 to 21 steps, locked across the document
  or set per palette, plus a review board to see the whole thing at once.
- **Wide gamut** — sRGB, Display P3, Adobe RGB, Rec. 2020, OKLab. Swatches mark
  the colours that can't be shown.
- **Export** — hex, OKLCH, CSS variables, Tailwind, SCSS, JSON, PNG, SVG.
- **No backend.** The whole document lives in the URL hash, so a link is the
  palette. It also autosaves locally.

## Tech

React 19 and TypeScript, built with Vite, tested with Vitest. Two runtime
dependencies:

| Dependency | Used for |
| --- | --- |
| [`culori`](https://culorijs.org) | colour conversion, gamut mapping, contrast |
| [`color-name-list`](https://github.com/meodai/color-names) | naming palettes from 30k curated colour names |

## Development

```bash
npm install
npm run dev
```

`npm run build` produces a static `dist/`. `npm test` runs the suite.

## Notes on the colour maths

**OKLCH, not HSL.** HSL lightness is not perceptual — yellow at `L=50%` reads far
brighter than blue at the same value, so evenly spaced HSL steps look uneven.
OKLCH is perceptually uniform, so a straight lightness ramp looks straight.

**Curves, not easings.** Two anchors and two free tangent handles per channel.
Handle heights are unconstrained, which is what lets one segment produce a hump:
chroma peaking mid-ramp, hue arcing away from the base and back. A monotonic
easing curve cannot. Hue is stored as a delta from the base, so re-basing a
palette keeps the torsion.

**The base is a fit constraint.** Solved inside the least-squares fit with a
Lagrange multiplier, not by bending the finished curve through the point.
Bending inflated a yellow ramp's middle by a third and cost 0.07 of chroma to
gamut mapping.

**Gamut mapping holds hue.** Not the CSS Color 4 default, which accepts a
roughly-in-gamut candidate and lets the 8-bit clip finish the job — that cost up
to 9° of hue drift to save about 0.001 of chroma. In a tool for steering hue
that is the wrong trade, so the search runs strict and holds hue within half a
degree.

## Layout

```
src/
  color/     bezier, curves and the least-squares fit, gamut ceilings,
             culori wrappers, default curves, ramp generation, harmonies,
             hue-slice geometry, colour naming
  state/     document reducer, per-palette reducer, undo history,
             URL hash and localStorage
  export/    text formats, PNG and SVG
  ui/        curve editor, ramp strips, toolbox, review board, pickers
```
