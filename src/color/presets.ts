import {
  bendThrough,
  clamp,
  clampCurve,
  CHANNELS,
  fitCurve,
  flat,
  linear,
  sampleCurve,
  type Curve,
} from './curve'
import { maxChromaFor } from './gamut'
import { parseToOklch, type Oklch } from './oklch'

export type PaletteConfig = {
  /** Base colour exactly as the designer typed it. */
  base: string
  /** Which step the base colour occupies. Stored, not re-derived, so the
   *  BASE badge does not hop around while curves are being dragged. */
  baseIndex: number
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

/**
 * Where the base colour's own lightness falls on the default L ramp,
 * snapped to the nearest step.
 */
export function baseIndexFor(base: Oklch, steps: number): number {
  const x = (base.l - L_LIGHT) / (L_DARK - L_LIGHT)
  return clamp(Math.round(x * (steps - 1)), 0, steps - 1)
}

/**
 * Starting curves for a base colour.
 *
 * Lightness is a straight perceptual ramp, bent to pass exactly through the
 * base colour's own lightness at its own step.
 *
 * Chroma holds a *constant fraction of the chroma sRGB can actually
 * provide* at each end, rather than a constant absolute chroma or a fixed
 * hand-tuned arc. Take the base colour's saturation as a share of its own
 * gamut ceiling and keep that share at the light and dark ends; because the
 * ceiling collapses toward white and black, this produces the falloff that
 * a good ramp needs, for free and correctly per hue — a yellow ramp sheds
 * chroma on the way down, a blue ramp on the way up. The curve is then bent
 * through the base chroma so the typed colour survives intact.
 *
 * Hue starts flat, so the untouched ramp is a single honest hue and any
 * torsion is the designer's decision rather than ours.
 */
export function defaultCurves(
  base: Oklch,
  steps: number,
  baseIndex: number,
): Pick<PaletteConfig, 'lightness' | 'chroma' | 'hue'> {
  const x = steps > 1 ? baseIndex / (steps - 1) : 0
  const { lightness: lChannel, chroma: cChannel } = CHANNELS

  const lightness = bendThrough(
    linear(L_LIGHT, L_DARK),
    x,
    base.l,
    lChannel.min,
    lChannel.max,
  )

  // The chroma ceiling has to be sampled at every step, not interpolated
  // between the ends: it is strongly curved in L, rising to a peak and
  // falling away, so a straight line between the two endpoint ceilings sails
  // clean over the top of it and the whole middle of the ramp clips.
  const last = Math.max(steps - 1, 1)
  const ceilings = Array.from({ length: steps }, (_, i) =>
    maxChromaFor(sampleCurve(lightness, i / last), base.h),
  )
  const ceilingAtBase = maxChromaFor(base.l, base.h)
  const share = ceilingAtBase > 0 ? clamp(base.c / ceilingAtBase, 0, 1) : 0
  const targets = ceilings.map((ceiling) => clamp(share * ceiling, cChannel.min, cChannel.max))

  // The fit takes the base colour as a hard constraint rather than bending
  // the finished curve through it. Bending afterwards was measurably
  // destructive: on a yellow, whose ceiling spikes near the light end, it
  // inflated the whole middle of the ramp by a third and cost 0.07 of chroma
  // to gamut mapping.
  const chroma = fitCurve(targets, cChannel.min, cChannel.max, [{ x, y: base.c }])

  return {
    lightness: clampCurve(lightness, lChannel),
    chroma: clampCurve(chroma, cChannel),
    hue: flat(0),
  }
}

export const FALLBACK_BASE = '#7c3aed'

export function createPalette(input: string, steps = DEFAULT_STEPS): PaletteConfig {
  const base = parseToOklch(input) ?? parseToOklch(FALLBACK_BASE)!
  const baseIndex = baseIndexFor(base, steps)
  return { base: input, baseIndex, steps, ...defaultCurves(base, steps, baseIndex) }
}
