import { CHANNELS, clamp, sampleCurve, type Curve } from './curve'
import {
  contrastRatio,
  mapToGamut,
  normalizeHue,
  parseToOklch,
  relativeLuminance,
  type Gamut,
  type Oklch,
} from './oklch'
import { chromaCeilingAt, FALLBACK_BASE, type PaletteConfig } from './presets'

export type Swatch = {
  index: number
  /** Design-token name for the step: 50, 100, … 950. */
  label: string
  /** Horizontal position on the curves, 0 → 1. */
  x: number
  /** What the curves asked for. */
  oklch: Oklch
  hex: string
  /** CSS string suitable for element background (hex or color(display-p3 ...)). */
  displayColor: string
  /** True when the requested chroma did not fit in the target gamut and was visibly
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
 * Convert an OKLCH lightness (0 → 1) to a step label (0 → 100),
 * rounded to the closest increment of 5.
 *
 * Examples:
 * - Lightness 1.0 (pure white) -> '0'
 * - Lightness 0.9 -> '10'
 * - Lightness 0.5 -> '50'
 * - Lightness 0.0 (pure black) -> '100'
 */
export function lightnessToLabel(lightness: number): string {
  const raw = (1 - clamp(lightness, 0, 1)) * 100
  return String(Math.round(raw / 5) * 5)
}

const NON_FIVE_PENALTY = 2.6

/**
 * Assign unique integer labels (0 → 100) to swatches based on their lightness,
 * preferring multiples of 5, and resolving collisions with nearest available increments.
 */
export function calculateRampLabels(lightnesses: number[]): string[] {
  const n = lightnesses.length
  if (n === 0) return []
  if (n === 1) return [lightnessToLabel(lightnesses[0])]

  // Compute raw values: (1 - L) * 100
  const raws = lightnesses.map((l) => (1 - clamp(l, 0, 1)) * 100)

  // Track original indices and sort by raw lightness
  const indices = Array.from({ length: n }, (_, i) => i)
  indices.sort((a, b) => raws[a] - raws[b] || a - b)

  const sortedRaws = indices.map((i) => raws[i])

  // DP to find strictly increasing integers y_0 < y_1 < ... < y_{n-1}
  // Range of possible labels: 0 to 100
  const MAX_VAL = 100
  const dp: number[][] = Array.from({ length: n }, () => new Array(MAX_VAL + 1).fill(Infinity))
  const parent: number[][] = Array.from({ length: n }, () => new Array(MAX_VAL + 1).fill(-1))

  const cost = (r: number, v: number) => {
    const dist = Math.abs(v - r)
    const penalty = v % 5 === 0 ? 0 : NON_FIVE_PENALTY
    return dist + penalty
  }

  // Base case: i = 0
  for (let v = 0; v <= MAX_VAL; v++) {
    dp[0][v] = cost(sortedRaws[0], v)
  }

  // DP transitions: i from 1 to n - 1
  for (let i = 1; i < n; i++) {
    const r = sortedRaws[i]
    let minPrevCost = Infinity
    let bestPrevV = -1

    for (let v = 0; v <= MAX_VAL; v++) {
      const prevV = v - 1
      if (prevV >= 0 && dp[i - 1][prevV] < minPrevCost) {
        minPrevCost = dp[i - 1][prevV]
        bestPrevV = prevV
      }

      if (minPrevCost < Infinity) {
        dp[i][v] = minPrevCost + cost(r, v)
        parent[i][v] = bestPrevV
      }
    }
  }

  // Find best ending value for swatch n - 1
  let bestEndV = -1
  let minTotalCost = Infinity
  for (let v = 0; v <= MAX_VAL; v++) {
    if (dp[n - 1][v] < minTotalCost) {
      minTotalCost = dp[n - 1][v]
      bestEndV = v
    }
  }

  if (bestEndV === -1) {
    return lightnesses.map(lightnessToLabel)
  }

  // Backtrack to recover assigned values
  const sortedLabels: number[] = new Array(n)
  let currV = bestEndV
  for (let i = n - 1; i >= 0; i--) {
    sortedLabels[i] = currV
    currV = parent[i][currV]
  }

  // Map back to original order
  const result: string[] = new Array(n)
  for (let k = 0; k < n; k++) {
    result[indices[k]] = String(sortedLabels[k])
  }

  return result
}

/**
 * Token names representing the color position along the lightness ramp,
 * following lightness, rounded to the closest increment of 5, and resolving collisions.
 */
export function stepLabels(steps: number, lightnessCurve?: Curve): string[] {
  if (steps <= 0) return []
  const last = Math.max(steps - 1, 1)
  const lightnesses = Array.from({ length: steps }, (_, i) => {
    const x = i / last
    return lightnessCurve ? sampleCurve(lightnessCurve, x) : 1 - x
  })
  return calculateRampLabels(lightnesses)
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

/**
 * The gamut's chroma ceiling sampled evenly across the ramp, for drawing.
 *
 * Denser than the steps on purpose. The ceiling has a knee in it — it climbs
 * to a peak and drops away — and a polyline through eleven points rounds that
 * knee off, which would draw the boundary somewhere the colours are not.
 */
export function chromaCeilingProfile(
  config: PaletteConfig,
  gamut: Gamut = 'srgb',
  samples = 65,
): number[] {
  const base = resolveBase(config)
  const last = Math.max(samples - 1, 1)
  return Array.from({ length: samples }, (_, i) => chromaCeilingAt(config, base, i / last, gamut))
}

export function generateRamp(config: PaletteConfig, gamut: Gamut = 'srgb'): Swatch[] {
  const base = resolveBase(config)
  const last = Math.max(config.steps - 1, 1)

  const colors: Oklch[] = Array.from({ length: config.steps }, (_, index) => {
    const x = index / last
    return {
      l: clamp(sampleCurve(config.lightness, x), CHANNELS.lightness.min, CHANNELS.lightness.max),
      c: clamp(sampleCurve(config.chroma, x), CHANNELS.chroma.min, CHANNELS.chroma.max),
      h: normalizeHue(base.h + sampleCurve(config.hue, x)),
    }
  })

  const labels = calculateRampLabels(colors.map((c) => c.l))

  return colors.map((color, index) => {
    const x = index / last
    const mapped = mapToGamut(color, gamut)
    const luminance = relativeLuminance(color)

    return {
      index,
      label: labels[index] ?? lightnessToLabel(color.l),
      x,
      oklch: color,
      hex: mapped.hex,
      displayColor: mapped.displayColor,
      clipped: mapped.clipped,
      chromaLost: mapped.chromaLost,
      isBase: index === config.baseIndex,
      contrastOnWhite: contrastRatio(luminance, WHITE_LUMINANCE),
      contrastOnBlack: contrastRatio(luminance, BLACK_LUMINANCE),
    }
  })
}
