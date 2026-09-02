import { isInSrgb } from './oklch'

/** No sRGB colour exceeds this chroma, so it is a safe search ceiling. */
const CHROMA_CEILING = 0.5
const PRECISION = 1e-4

/**
 * The most chroma sRGB can hold at a given lightness and hue.
 *
 * This is the shape of the gamut, and it is wildly uneven: yellow keeps a
 * lot of chroma only while it is very light, blue only while it is dark.
 * Knowing the ceiling is what lets the default ramp hold a *constant
 * fraction* of the available chroma at every step instead of a constant
 * absolute chroma, which is the difference between a ramp that stays vivid
 * end to end and one that clips at one end and goes chalky at the other.
 */
export function maxChromaFor(l: number, h: number): number {
  if (l <= 0 || l >= 1) return 0
  if (isInSrgb({ l, c: CHROMA_CEILING, h })) return CHROMA_CEILING

  let lo = 0
  let hi = CHROMA_CEILING
  while (hi - lo > PRECISION) {
    const mid = (lo + hi) / 2
    if (isInSrgb({ l, c: mid, h })) lo = mid
    else hi = mid
  }
  return lo
}
