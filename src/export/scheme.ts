import { contrastRatio, mapToGamut, relativeLuminance, type Gamut } from '../color/oklch'
import type { Swatch } from '../color/ramp'
import type { Slot } from '../color/scheme'
import type { NamedRamp } from './formats'

/**
 * A scheme as the exporters already understand it.
 *
 * A scheme is a document of one-step ramps, so rather than a second path
 * through every text format and both image writers, each slot is dressed as
 * the `Swatch` it effectively is. Everything downstream — hex lists, CSS
 * variables, Tailwind, SCSS, JSON, PNG, SVG — then works unchanged.
 *
 * The one field that needs a decision is `label`, which a ramp derives from
 * lightness so its tokens come out as 50, 100 … 950. That is meaningless for
 * a scheme: five colours chosen to sit beside one another are not five tints
 * of anything, and naming them by weight would suggest they were. They are
 * numbered in scheme order instead, so a five-colour scheme exports as
 * `--brand-1` through `--brand-5`.
 */
export function schemeRamp(
  slots: Slot[],
  gamut: Gamut = 'srgb',
  name = 'scheme',
): NamedRamp {
  return {
    name,
    ramp: slots.map((slot, index) => {
      const mapped = mapToGamut(slot.color, gamut)
      const luminance = relativeLuminance(slot.color)
      return {
        index,
        label: String(index + 1),
        // Where the slot sits along the run, on the same 0 → 1 scale a ramp
        // uses for its curves. Nothing reads it here, but a Swatch that lied
        // about it would be a trap for whatever reads it next.
        x: slots.length < 2 ? 0 : index / (slots.length - 1),
        oklch: slot.color,
        hex: mapped.hex,
        displayColor: mapped.displayColor,
        clipped: mapped.clipped,
        chromaLost: mapped.chromaLost,
        // A scheme has no base: every colour in it is one of the answers,
        // which is the whole difference from a ramp.
        isBase: false,
        contrastOnWhite: contrastRatio(luminance, 1),
        contrastOnBlack: contrastRatio(luminance, 0),
      } satisfies Swatch
    }),
  }
}
