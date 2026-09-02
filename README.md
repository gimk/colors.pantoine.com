# colors.pantoine.com

A palette tool for building tint and shade ramps from one base colour, where the
designer controls lightness, chroma and hue with curves instead of accepting
whatever a fixed lighten/darken step produces.

```bash
npm install
npm run dev
```

`npm run build` produces a static `dist/`. There is no backend — a palette is
encoded in the URL hash, so a shared link is the whole palette.

## Why it is built this way

**OKLCH, not HSL.** HSL lightness is not perceptual: yellow at `L=50%` reads far
brighter than blue at the same value, so evenly spaced HSL steps look uneven.
OKLCH is perceptually uniform, so a straight lightness ramp actually looks like
one. The UI names the space in the header and on every axis, because the numbers
mean nothing without it.

**Three curves, one cubic Bézier each.** Two anchors (the Start and End inputs)
and two draggable tangent handles. Handle heights are free within the channel
box, which is what lets one segment produce a hump — chroma peaking mid-ramp,
hue arcing away from the base and back. A monotonic easing curve could not.
Hue is stored as a *delta* from the base hue, so re-basing a palette keeps the
designer's torsion intact.

**The default chroma curve tracks the sRGB gamut.** The most chroma sRGB can
hold depends wildly on both lightness and hue: yellow keeps chroma only while
it is light, blue only while it is dark. So the default takes the base colour's
saturation as a share of its own gamut ceiling and holds that share across the
ramp, fitting a cubic to the ceiling sampled at every step. A yellow ramp sheds
chroma on the way down and a blue ramp on the way up, for free and correctly per
hue, instead of both following the same hand-tuned arc into mud.

**The base colour is a fit constraint, not an afterthought.** The ramp contains
the colour you typed, exactly. That is solved inside the least-squares fit with
a Lagrange multiplier rather than by bending the finished curve through the
point — bending was measurably destructive, inflating a yellow ramp's middle by
a third and costing 0.07 of chroma to gamut mapping.

**Gamut mapping holds hue.** Not the CSS Color 4 default, which accepts a
candidate that is only roughly in gamut and lets the final 8-bit clip finish the
job. Measured against strict chroma reduction, that cost up to 9° of hue drift
to save about 0.001 of chroma. In a tool for steering hue that is the wrong
trade, so the search runs strict (`jnd = 0`) and holds hue within half a degree.
When a colour cannot be shown, the swatch says so with a corner notch — and only
when the loss is perceptible, so the mark stays worth believing.

## Layout

```
src/
  color/
    bezier.ts    cubic evaluated as a function of x; Newton + bisection inversion
    curve.ts     the Curve type, channel definitions, constrained least-squares fit
    gamut.ts     most chroma sRGB can hold at a given lightness and hue
    oklch.ts     culori wrappers, formatting, gamut mapping, contrast
    presets.ts   PaletteConfig and the gamut-aware default curves
    ramp.ts      config -> swatches
    shapes.ts    one-click curve shapes (flat / linear / arc / ease)
  state/
    usePalette.ts  reducer over PaletteConfig
    url.ts         palette <-> URL hash
  export/
    formats.ts   hex / OKLCH / CSS vars / Tailwind / SCSS / JSON
    image.ts     PNG for eyedropping, SVG as editable layers
  ui/            brutalist shell, curve editor, ramp, export panel
```

`npm test` covers `color/`, `export/` and a render smoke test — the places where
a bug is invisible to the eye.

## Not built yet

- A "pin base" toggle that re-solves the curves to hold the base exactly after
  they have been dragged. Today the base is exact in the default and drifts once
  you edit; the `BASE` badge shows where it sits so the drift is visible.
- Multiple ramps in one document, and neutral/grey scale derivation.
- APCA contrast alongside the WCAG 2.1 ratios.
