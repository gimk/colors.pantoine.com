import { describe, expect, it } from 'vitest'
import { maxChromaFor } from './gamut'
import { formatColor, isInGamut, mapToGamut, toColorCss, toHex, type Oklch } from './oklch'
import { chromaCurveFor, createPalette } from './presets'
import { countDuplicateSteps, generateRamp } from './ramp'
import { sampleCurve } from './curve'

describe('gamut detection and mapping', () => {
  // At L=0.8, C=0.28, H=140 (a vivid green), the color is noticeably outside sRGB
  // (chroma loss > CHROMA_JND of 0.004) but comfortably inside Display P3 and Adobe RGB.
  const vividGreen: Oklch = { l: 0.8, c: 0.28, h: 140 }

  it('correctly detects in-gamut and out-of-gamut colours across spaces', () => {
    expect(isInGamut(vividGreen, 'srgb')).toBe(false)
    expect(isInGamut(vividGreen, 'p3')).toBe(true)
    expect(isInGamut(vividGreen, 'a98')).toBe(true)
    expect(isInGamut(vividGreen, 'rec2020')).toBe(true)
    expect(isInGamut(vividGreen, 'oklab')).toBe(true)
  })

  it('clips colours in sRGB that fit cleanly in Display P3', () => {
    const srgbMapped = mapToGamut(vividGreen, 'srgb')
    const p3Mapped = mapToGamut(vividGreen, 'p3')
    const a98Mapped = mapToGamut(vividGreen, 'a98')
    const oklabMapped = mapToGamut(vividGreen, 'oklab')

    expect(srgbMapped.clipped).toBe(true)
    expect(srgbMapped.chromaLost).toBeGreaterThan(0.004)

    expect(p3Mapped.clipped).toBe(false)
    expect(p3Mapped.chromaLost).toBeCloseTo(0, 4)

    expect(a98Mapped.clipped).toBe(false)
    expect(a98Mapped.chromaLost).toBeCloseTo(0, 4)

    expect(oklabMapped.clipped).toBe(false)
    expect(oklabMapped.chromaLost).toBe(0)
  })

  it('formats displayColor appropriately for wide gamuts', () => {
    const srgbMapped = mapToGamut(vividGreen, 'srgb')
    const p3Mapped = mapToGamut(vividGreen, 'p3')
    const a98Mapped = mapToGamut(vividGreen, 'a98')
    const oklabMapped = mapToGamut(vividGreen, 'oklab')

    // sRGB uses plain hex
    expect(srgbMapped.displayColor).toMatch(/^#[0-9a-f]{6}$/i)

    // Wide gamuts use CSS Color 4 color() notation or oklab()
    expect(p3Mapped.displayColor).toContain('color(display-p3')
    expect(a98Mapped.displayColor).toContain('color(a98-rgb')
    expect(oklabMapped.displayColor).toContain('oklab(')
  })

  it('reflects gamut choice in generated swatches clipping flags', () => {
    // Create a high-chroma palette where steps reach into wide gamut
    const config = createPalette('#00ff66')

    const srgbRamp = generateRamp(config, 'srgb')
    const p3Ramp = generateRamp(config, 'p3')

    const srgbClippedCount = srgbRamp.filter((s) => s.clipped).length
    const p3ClippedCount = p3Ramp.filter((s) => s.clipped).length

    // Fewer swatches should be clipped in P3 than in sRGB
    expect(p3ClippedCount).toBeLessThan(srgbClippedCount)
  })

  it('finds higher max chroma in P3 and Adobe RGB than sRGB for saturated green', () => {
    const srgbCeiling = maxChromaFor(0.8, 140, 'srgb')
    const p3Ceiling = maxChromaFor(0.8, 140, 'p3')
    const a98Ceiling = maxChromaFor(0.8, 140, 'a98')

    expect(p3Ceiling).toBeGreaterThan(srgbCeiling)
    expect(a98Ceiling).toBeGreaterThan(srgbCeiling)
  })
})

/**
 * A wide-gamut colour has no hex. `hex` is therefore the sRGB rendition, and
 * it has to be reached by the same strict map as everything else — clipping
 * the channels of a P3 value instead drifts the hue, and `hex` is what every
 * text and image export writes.
 */
describe('hex under a wide gamut', () => {
  const config = {
    ...createPalette('#0066ff'),
    chroma: { start: 0.3, end: 0.3, h1: { x: 1 / 3, y: 0.3 }, h2: { x: 2 / 3, y: 0.3 } },
  }

  it('is the sRGB map of the request, whatever the target gamut', () => {
    const srgb = generateRamp(config, 'srgb')
    for (const gamut of ['p3', 'a98', 'rec2020'] as const) {
      expect(generateRamp(config, gamut).map((s) => s.hex)).toEqual(srgb.map((s) => s.hex))
    }
  })

  it('agrees with the value a click copies', () => {
    for (const swatch of generateRamp(config, 'rec2020')) {
      expect(swatch.hex).toBe(formatColor(swatch.oklch, 'hex'))
      expect(swatch.hex).toBe(toHex(swatch.oklch))
    }
  })

  /** Clipping collapses distinct steps, so a clipped hex over-reports them. */
  it('does not invent squeezed steps for the warning to report', () => {
    const srgb = countDuplicateSteps(generateRamp(config, 'srgb'))
    expect(countDuplicateSteps(generateRamp(config, 'rec2020'))).toBe(srgb)
  })

  it('still shows the wide-gamut colour on screen', () => {
    const ramp = generateRamp(config, 'p3')
    expect(ramp.some((s) => s.displayColor.startsWith('color(display-p3'))).toBe(true)
    expect(generateRamp(config, 'srgb').every((s) => s.displayColor === s.hex)).toBe(true)
  })
})

describe('color() output', () => {
  it('is the one format that can carry a wide-gamut colour', () => {
    const green: Oklch = { l: 0.8, c: 0.28, h: 140 }
    expect(formatColor(green, 'color()', 'p3')).toBe(toColorCss(green, 'p3'))
    expect(formatColor(green, 'color()', 'p3')).toMatch(/^color\(display-p3 /)
    expect(formatColor(green, 'color()', 'rec2020')).toMatch(/^color\(rec2020 /)
    expect(formatColor(green, 'color()')).toMatch(/^color\(srgb /)
  })

  /** Copied by hand, so the boundary's float dust must not be printed. */
  it('rounds the channels it prints', () => {
    for (const gamut of ['srgb', 'p3', 'a98', 'rec2020', 'oklab'] as const) {
      for (const channel of toColorCss({ l: 0.7, c: 0.42, h: 150 }, gamut).match(/[\d.]+/g) ?? []) {
        expect(channel.replace(/^\d+\.?/, '').length).toBeLessThanOrEqual(4)
      }
    }
  })
})

/**
 * The ceiling is the whole point of the gamut choice: chroma curves hold a
 * fraction of what the display can give, so a wider gamut has to reach the
 * derivation, not just the rendering.
 */
describe('chroma derivation follows the gamut', () => {
  const base = { l: 0.8, c: 0.2, h: 140 }
  const lightnessOf = (gamut: 'srgb' | 'rec2020') =>
    createPalette('#00ff66', 11, gamut).lightness

  it('asks for more chroma in Rec. 2020 than in sRGB', () => {
    const lightness = lightnessOf('srgb')
    const srgb = chromaCurveFor(base, 11, 5, lightness, 'srgb')
    const wide = chromaCurveFor(base, 11, 5, lightness, 'rec2020')

    const peak = (curve: typeof srgb) =>
      Math.max(...Array.from({ length: 11 }, (_, i) => sampleCurve(curve, i / 10)))
    expect(peak(wide)).toBeGreaterThan(peak(srgb))
  })

  it('reaches createPalette, so a new palette is built for the right display', () => {
    expect(createPalette('#00ff66', 11, 'rec2020').chroma).not.toEqual(
      createPalette('#00ff66', 11, 'srgb').chroma,
    )
  })
})

describe('OKLab gamut', () => {
  it('treats wide chroma colors as unclipped and formats with oklab()', () => {
    const color: Oklch = { l: 0.7, c: 0.35, h: 200 }
    const mapped = mapToGamut(color, 'oklab')
    expect(mapped.clipped).toBe(false)
    expect(mapped.chromaLost).toBe(0)
    expect(mapped.displayColor).toMatch(/^oklab\(/)
    expect(toColorCss(color, 'oklab')).toMatch(/^oklab\(/)
  })

  it('allows palettes to generate unclipped swatches in oklab gamut', () => {
    const config = createPalette('#00ff66', 11, 'oklab')
    const ramp = generateRamp(config, 'oklab')
    expect(ramp.every((s) => !s.clipped)).toBe(true)
  })
})
