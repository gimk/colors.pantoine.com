import {
  bendThrough,
  clamp,
  clampCurve,
  CHANNELS,
  fitCurve,
  stepsAreMonotonic,
  flat,
  linear,
  sampleCurve,
  type ChannelKey,
  type Curve,
  type CurveControl,
} from './curve'
import { maxChromaFor } from './gamut'
import { normalizeHue, parseToOklch, type Gamut, type Oklch } from './oklch'

/** The three channels a palette shapes. */
export type CurveKey = ChannelKey

export type PaletteConfig = {
  /** Base colour exactly as the designer typed it. */
  base: string
  /** Which step the base colour occupies. Stored, not re-derived, so the
   *  BASE badge does not hop around while curves are being dragged. */
  baseIndex: number
  /** When set, every curve edit is corrected so it cannot move the base. */
  baseLocked: boolean
  steps: number
  lightness: Curve
  chroma: Curve
  /** Delta from the base hue, in degrees. */
  hue: Curve
}

export const DEFAULT_STEPS = 11
export const MIN_STEPS = 5
export const MAX_STEPS = 21

/** Lightest and darkest ends of the default ramp, in OKLCH L. */
export const L_LIGHT = 0.97
export const L_DARK = 0.16


/** How far a lightness ramp may reverse between steps before it counts. Below
 *  this the two steps are indistinguishable anyway, and after 8-bit rounding
 *  usually identical. */
const L_REVERSAL_TOLERANCE = 0.002

/**
 * Where the base colour's own lightness falls on the default L ramp, snapped
 * to the nearest step. This is a measurement, not a preference — the designer
 * can override it, which is what `lightnessCurveFor` is for.
 */
export function baseIndexFor(base: Oklch, steps: number): number {
  const x = (base.l - L_LIGHT) / (L_DARK - L_LIGHT)
  return clamp(Math.round(x * (steps - 1)), 0, steps - 1)
}

export function baseX(steps: number, baseIndex: number): number {
  const last = Math.max(steps - 1, 1)
  return clamp(baseIndex, 0, last) / last
}

/**
 * A lightness curve running `rampStart` to `rampEnd` that puts the base
 * colour's own lightness on the step at `index`.
 *
 * Which step carries the base colour *is* a statement about how lightness is
 * distributed, so moving it re-solves the whole ramp rather than nudging one
 * value. The target is built as two straight runs meeting at the base and
 * then fitted, which keeps it monotonic — a bend would not: bending a
 * straight ramp to lift its middle pushes the first handle above the start
 * anchor, and step 100 comes out *lighter* than step 50.
 *
 * Asking for a light colour at a middle step compresses the tints and
 * stretches the shades. That is not a compromise the tool invented — it is
 * what any ramp must do to hold a light colour in the middle and still reach
 * a dark end, and it is what Tailwind's yellow does.
 */
export function lightnessCurveFor(
  base: Oklch,
  steps: number,
  index: number,
  rampStart = L_LIGHT,
  rampEnd = L_DARK,
): Curve {
  const channel = CHANNELS.lightness
  const x = baseX(steps, index)

  // At an end there is no shape to solve: the base *is* that endpoint.
  if (x <= 0) return clampCurve(linear(base.l, rampEnd), channel)
  if (x >= 1) return clampCurve(linear(rampStart, base.l), channel)

  // The ramp has to bracket the base, and the base wins where they conflict.
  // Clamping these to the *default* ramp ends instead was wrong: a pure black
  // base sits below the default dark end, so the lower end could not get
  // under it and the shade half of the target ran back uphill.
  const start = clamp(Math.max(rampStart, base.l + 0.01), channel.min, channel.max)
  const end = clamp(Math.min(rampEnd, base.l - 0.01), channel.min, channel.max)

  // Two straight runs meeting at the base: start down to the base over the
  // tints, base down to the end over the shades. Monotonic by construction
  // for any base and any position, with no shape parameter to solve, clamp,
  // or fall out of range.
  //
  // A power law was tried first and looked prettier, but at the gamma needed
  // to place a light colour late in the ramp it goes almost perfectly flat
  // near the light end, and a cubic fitted to that flat run always wiggled
  // about 0.007 above it — enough to reverse two steps. Straight runs have no
  // flat stretch to wiggle along, and the cubic fit rounds the corner between
  // them on its own, so the result comes out smooth anyway.
  const last = Math.max(steps - 1, 1)
  const targets = Array.from({ length: steps }, (_, i) => {
    const t = i / last
    const value =
      t <= x ? start + ((base.l - start) * t) / x : base.l + ((end - base.l) * (t - x)) / (1 - x)
    return clamp(value, channel.min, channel.max)
  })

  // Only monotonic candidates are accepted: a tint scale that gets lighter as
  // it goes darker is not a matter of taste. The tolerance is what a reversal
  // would have to exceed to be visible at all — demanding exact monotonicity
  // from a fitted curve rejected every candidate and fell back to a bend,
  // which reversed far more.
  return clampCurve(
    fitCurve(targets, channel.min, channel.max, [{ x, y: base.l }], (candidate) =>
      stepsAreMonotonic(candidate, steps, L_REVERSAL_TOLERANCE),
    ),
    channel,
  )
}

/**
 * A chroma curve for a ramp whose lightness is already decided.
 *
 * Holds a constant fraction of the chroma the target gamut can actually
 * provide at each step, which is why the gamut has to reach this far in: on
 * a P3 or Rec. 2020 palette the ceiling is a different shape, and a curve
 * derived against sRGB's would leave most of the display unused.
 *
 * The ceiling has to be sampled at every step rather than interpolated
 * between the ends: it is strongly curved in L, rising to a peak and falling
 * away, so a straight line between the two endpoint ceilings sails clean over
 * the top of it and the whole middle of the ramp clips.
 *
 * Because the ceiling collapses toward white and black, this produces the
 * falloff a good ramp needs for free and correctly per hue — a yellow ramp
 * sheds chroma on the way down, a blue ramp on the way up.
 */
export function chromaCurveFor(
  base: Oklch,
  steps: number,
  index: number,
  lightness: Curve,
  gamut: Gamut = 'srgb',
): Curve {
  const channel = CHANNELS.chroma
  const last = Math.max(steps - 1, 1)
  const x = baseX(steps, index)

  const ceilings = Array.from({ length: steps }, (_, i) =>
    maxChromaFor(sampleCurve(lightness, i / last), base.h, gamut),
  )
  const ceilingAtBase = maxChromaFor(base.l, base.h, gamut)
  const share = ceilingAtBase > 0 ? clamp(base.c / ceilingAtBase, 0, 1) : 0
  const targets = ceilings.map((ceiling) => clamp(share * ceiling, channel.min, channel.max))

  // The base enters as a hard fit constraint rather than a bend applied
  // afterwards. Bending was measurably destructive: on a yellow, whose
  // ceiling spikes near the light end, it inflated the whole middle of the
  // ramp by a third and cost 0.07 of chroma to gamut mapping.
  return clampCurve(fitCurve(targets, channel.min, channel.max, [{ x, y: base.c }]), channel)
}

/**
 * The most chroma this palette could show at horizontal position `x`.
 *
 * Reads the lightness *and* the hue curve, not just lightness: the ceiling is
 * a surface over both, and a ramp with hue torsion in it walks across that
 * surface as it goes. Sampling at a single hue would put the boundary in the
 * wrong place on exactly the palettes that need it most.
 */
export function chromaCeilingAt(
  config: Pick<PaletteConfig, 'lightness' | 'hue'>,
  base: Oklch,
  x: number,
  gamut: Gamut = 'srgb',
): number {
  const l = clamp(
    sampleCurve(config.lightness, x),
    CHANNELS.lightness.min,
    CHANNELS.lightness.max,
  )
  const h = normalizeHue(base.h + sampleCurve(config.hue, x))
  return Math.min(maxChromaFor(l, h, gamut), CHANNELS.chroma.max)
}

/** The ceiling at every step of the ramp. */
export function chromaCeilings(
  config: Pick<PaletteConfig, 'lightness' | 'hue' | 'steps'>,
  base: Oklch,
  gamut: Gamut = 'srgb',
): number[] {
  const last = Math.max(config.steps - 1, 1)
  return Array.from({ length: config.steps }, (_, i) =>
    chromaCeilingAt(config, base, i / last, gamut),
  )
}

/**
 * Starting curves for a base colour. Hue starts flat, so the untouched ramp
 * is a single honest hue and any torsion is the designer's decision.
 */
export function defaultCurves(
  base: Oklch,
  steps: number,
  baseIndex: number,
  gamut: Gamut = 'srgb',
): Pick<PaletteConfig, 'lightness' | 'chroma' | 'hue'> {
  const lightness = lightnessCurveFor(base, steps, baseIndex)
  return {
    lightness,
    chroma: chromaCurveFor(base, steps, baseIndex, lightness, gamut),
    hue: flat(0),
  }
}

/** What a locked base pins a channel to. Hue is stored as a delta, so the
 *  base's own step is a shift of zero by definition. */
export function baseValueFor(base: Oklch, key: CurveKey): number {
  return key === 'lightness' ? base.l : key === 'chroma' ? base.c : 0
}

/**
 * Correct a curve so it still passes through the base colour.
 *
 * `moved` names the control the designer is currently dragging, which is then
 * left alone — otherwise the correction would push the very handle under the
 * pointer and the drag would feel like it was fighting back.
 */
export function holdBase(
  curve: Curve,
  key: CurveKey,
  base: Oklch,
  steps: number,
  baseIndex: number,
  moved?: CurveControl,
): Curve {
  const channel = CHANNELS[key]
  return bendThrough(
    curve,
    baseX(steps, baseIndex),
    baseValueFor(base, key),
    channel.min,
    channel.max,
    moved,
  )
}

export const FALLBACK_BASE = '#7c3aed'

export function createPalette(
  input: string,
  steps = DEFAULT_STEPS,
  gamut: Gamut = 'srgb',
  /**
   * Which step carries the base colour.
   *
   * Defaults to wherever the base's own lightness falls on the default ramp,
   * which is what a brand new palette wants. Passed in when the position is
   * already a decision worth keeping — as a locked base's is when its curves
   * are re-derived.
   */
  baseIndex?: number,
): PaletteConfig {
  const base = parseToOklch(input) ?? parseToOklch(FALLBACK_BASE)!
  const index =
    baseIndex === undefined
      ? baseIndexFor(base, steps)
      : clamp(Math.round(baseIndex), 0, steps - 1)
  return {
    base: input,
    baseIndex: index,
    baseLocked: false,
    steps,
    ...defaultCurves(base, steps, index, gamut),
  }
}
