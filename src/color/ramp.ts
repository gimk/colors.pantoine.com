import { CHANNELS, clamp, sampleCurve } from './curve'
import {
  contrastRatio,
  mapToSrgb,
  normalizeHue,
  parseToOklch,
  relativeLuminance,
  type Oklch,
} from './oklch'
import { FALLBACK_BASE, type PaletteConfig } from './presets'

export type Swatch = {
  index: number
  /** Design-token name for the step: 50, 100, … 950. */
  label: string
  /** Horizontal position on the curves, 0 → 1. */
  x: number
  /** What the curves asked for. */
  oklch: Oklch
  hex: string
  /** True when the requested chroma did not fit in sRGB and was visibly
   *  mapped down — surfaced in the UI rather than silently swallowed. */
  clipped: boolean
  /** How much chroma the mapping had to give up. */
  chromaLost: number
  isBase: boolean
  contrastOnWhite: number
  contrastOnBlack: number
}

const WHITE_LUMINANCE = 1
const BLACK_LUMINANCE = 0

/**
 * Token names designers already expect. The common counts get the familiar
 * Tailwind-ish scale; anything else falls back to plain hundreds.
 */
export function stepLabels(steps: number): string[] {
  const known: Record<number, number[]> = {
    9: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    10: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900],
    11: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950],
    12: [25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950],
  }
  const preset = known[steps]
  if (preset) return preset.map(String)
  return Array.from({ length: steps }, (_, i) => String((i + 1) * 100))
}

/** The base colour resolved to OKLCH, with a fallback for invalid input. */
export function resolveBase(config: PaletteConfig): Oklch {
  return parseToOklch(config.base) ?? parseToOklch(FALLBACK_BASE)!
}

/**
 * How many steps came out identical to the one before them.
 *
 * Worth reporting rather than hiding: pinning the base to a step far from its
 * own lightness squeezes the ramp toward one end, and the squeezed steps stop
 * being distinguishable. The tool should say so instead of quietly handing
 * over a scale with four identical near-whites in it.
 */
export function countDuplicateSteps(ramp: Swatch[]): number {
  let duplicates = 0
  for (let i = 1; i < ramp.length; i++) {
    if (ramp[i].hex === ramp[i - 1].hex) duplicates++
  }
  return duplicates
}

export function generateRamp(config: PaletteConfig): Swatch[] {
  const base = resolveBase(config)
  const labels = stepLabels(config.steps)
  const last = Math.max(config.steps - 1, 1)

  return Array.from({ length: config.steps }, (_, index) => {
    const x = index / last
    const color: Oklch = {
      l: clamp(sampleCurve(config.lightness, x), CHANNELS.lightness.min, CHANNELS.lightness.max),
      c: clamp(sampleCurve(config.chroma, x), CHANNELS.chroma.min, CHANNELS.chroma.max),
      h: normalizeHue(base.h + sampleCurve(config.hue, x)),
    }
    const mapped = mapToSrgb(color)
    const luminance = relativeLuminance(color)

    return {
      index,
      label: labels[index] ?? String(index),
      x,
      oklch: color,
      hex: mapped.hex,
      clipped: mapped.clipped,
      chromaLost: mapped.chromaLost,
      isBase: index === config.baseIndex,
      contrastOnWhite: contrastRatio(luminance, WHITE_LUMINANCE),
      contrastOnBlack: contrastRatio(luminance, BLACK_LUMINANCE),
    }
  })
}
