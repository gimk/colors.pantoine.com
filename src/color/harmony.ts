import { maxChromaFor } from './gamut'
import { CHROMA_JND, normalizeHue, type Gamut, type Oklch } from './oklch'

/**
 * Classic colour-harmony rules, as hue rotations from a seed colour.
 *
 * Rotated in OKLCH rather than on the artist's HSB wheel, which is not a
 * detail: HSB's complement of #0044ff lands at L0.83 against the seed's L0.51,
 * so the two palettes would carry completely different weight. OKLCH holds
 * lightness, and the hue families come out in the same place anyway — within
 * 5-25 degrees of the HSB answer across the seeds this was checked against.
 */

export type HarmonyId =
  | 'complementary'
  | 'analogous'
  | 'split'
  | 'triad'
  | 'square'
  | 'tetradic'
  | 'compound'
  | 'doubleSplit'

export type Harmony = {
  id: HarmonyId
  label: string
  hint: string
  /** What a palette made from this rule is named. Lower case and spaced, since
   *  it lands in a name field beside hand-typed ones like "brand". */
  slug: string
  /**
   * Degrees from the seed's hue. Never zero: the seed is already a palette in
   * the document, so offering it as a candidate would only duplicate one.
   */
  offsets: number[]
}

export const HARMONIES: Harmony[] = [
  {
    id: 'complementary',
    slug: 'complement',
    label: 'Complementary',
    hint: 'The opposite hue. Maximum contrast, and only one answer.',
    offsets: [180],
  },
  {
    id: 'analogous',
    slug: 'analogous',
    label: 'Analogous',
    hint: 'Neighbours on either side. Quiet, cohesive schemes.',
    offsets: [-60, -30, 30, 60],
  },
  {
    id: 'split',
    slug: 'split',
    label: 'Split complementary',
    hint: 'Either side of the complement. The contrast without the clash.',
    offsets: [150, 210],
  },
  {
    id: 'triad',
    slug: 'triad',
    label: 'Triad',
    hint: 'Three hues evenly spaced. Vivid and balanced.',
    offsets: [120, 240],
  },
  {
    id: 'square',
    slug: 'square',
    label: 'Square',
    hint: 'Four hues at right angles. Two complementary pairs.',
    offsets: [90, 180, 270],
  },
  {
    id: 'tetradic',
    slug: 'tetradic',
    label: 'Tetradic',
    hint: 'A rectangle on the wheel. Like square, but with a dominant pair.',
    offsets: [60, 180, 240],
  },
  {
    id: 'compound',
    slug: 'compound',
    label: 'Compound',
    hint: 'A neighbour plus the complement and its neighbour.',
    offsets: [30, 180, 210],
  },
  {
    id: 'doubleSplit',
    slug: 'double split',
    label: 'Double split',
    hint: 'Both neighbours and both sides of the complement. The widest set.',
    offsets: [-30, 30, 150, 210],
  },
]

/**
 * Whether a seed has a hue worth rotating.
 *
 * Hue is meaningless on a grey, and every rule would hand back the same grey
 * eight times over. Better to say so than to offer a row of identical swatches.
 */
export function hasUsableHue(seed: Oklch): boolean {
  return seed.c > CHROMA_JND
}

/**
 * The colours a rule proposes, given a seed.
 *
 * Lightness is the seed's, untouched. Chroma is the seed's too, capped at what
 * the target gamut can actually show at the new hue — not held as a *share* of
 * that ceiling, which is the trick the default chroma curve uses. The share
 * rule breaks on pastels: #f0abfc sits at 94% of its own modest ceiling, and
 * 94% of green's much higher one is #45ef2c, a screaming lime next to the
 * powder pink that asked for it. Capping gives #96de8c, which is the match.
 *
 * A vivid seed is already at its ceiling, so capping hands it the most
 * saturated colour each hue can hold — and every candidate is inside the gamut
 * by construction, so none of them needs a clipped marker.
 */
export function harmonyCandidates(
  seed: Oklch,
  harmony: Harmony,
  gamut: Gamut = 'srgb',
): Oklch[] {
  return harmony.offsets.map((offset) => {
    const h = normalizeHue(seed.h + offset)
    return { l: seed.l, c: Math.min(seed.c, maxChromaFor(seed.l, h, gamut)), h }
  })
}
