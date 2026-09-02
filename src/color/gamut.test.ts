import { describe, expect, it } from 'vitest'
import { maxChromaFor } from './gamut'
import { isInGamut, mapToGamut, type Oklch } from './oklch'
import { createPalette } from './presets'
import { generateRamp } from './ramp'

describe('gamut detection and mapping', () => {
  // At L=0.8, C=0.28, H=140 (a vivid green), the color is noticeably outside sRGB
  // (chroma loss > CHROMA_JND of 0.004) but comfortably inside Display P3 and Adobe RGB.
  const vividGreen: Oklch = { l: 0.8, c: 0.28, h: 140 }

  it('correctly detects in-gamut and out-of-gamut colours across spaces', () => {
    expect(isInGamut(vividGreen, 'srgb')).toBe(false)
    expect(isInGamut(vividGreen, 'p3')).toBe(true)
    expect(isInGamut(vividGreen, 'a98')).toBe(true)
    expect(isInGamut(vividGreen, 'rec2020')).toBe(true)
  })

  it('clips colours in sRGB that fit cleanly in Display P3', () => {
    const srgbMapped = mapToGamut(vividGreen, 'srgb')
    const p3Mapped = mapToGamut(vividGreen, 'p3')
    const a98Mapped = mapToGamut(vividGreen, 'a98')

    expect(srgbMapped.clipped).toBe(true)
    expect(srgbMapped.chromaLost).toBeGreaterThan(0.004)

    expect(p3Mapped.clipped).toBe(false)
    expect(p3Mapped.chromaLost).toBeCloseTo(0, 4)

    expect(a98Mapped.clipped).toBe(false)
    expect(a98Mapped.chromaLost).toBeCloseTo(0, 4)
  })

  it('formats displayColor appropriately for wide gamuts', () => {
    const srgbMapped = mapToGamut(vividGreen, 'srgb')
    const p3Mapped = mapToGamut(vividGreen, 'p3')
    const a98Mapped = mapToGamut(vividGreen, 'a98')

    // sRGB uses plain hex
    expect(srgbMapped.displayColor).toMatch(/^#[0-9a-f]{6}$/i)

    // Wide gamuts use CSS Color 4 color() notation
    expect(p3Mapped.displayColor).toContain('color(display-p3')
    expect(a98Mapped.displayColor).toContain('color(a98-rgb')
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
