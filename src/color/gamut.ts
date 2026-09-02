import { isInGamut, type Gamut } from './oklch'

/** No displayable colour in target gamuts exceeds this chroma, so it is a safe search ceiling. */
const CHROMA_CEILING = 0.5
const PRECISION = 1e-4

/**
 * The most chroma the specified gamut can hold at a given lightness and hue.
 *
 * Defaults to sRGB. Knowing the ceiling is what lets the default ramp hold a
 * *constant fraction* of the available chroma at every step instead of a constant
 * absolute chroma.
 */
export function maxChromaFor(l: number, h: number, gamut: Gamut = 'srgb'): number {
  if (l <= 0 || l >= 1) return 0
  if (isInGamut({ l, c: CHROMA_CEILING, h }, gamut)) return CHROMA_CEILING

  let lo = 0
  let hi = CHROMA_CEILING
  while (hi - lo > PRECISION) {
    const mid = (lo + hi) / 2
    if (isInGamut({ l, c: mid, h }, gamut)) lo = mid
    else hi = mid
  }
  return lo
}
