import { describe, expect, it } from 'vitest'
import { sampleCurve } from '../color/curve'
import { createPalette } from '../color/presets'
import { generateRamp } from '../color/ramp'
import { decodePalette, encodePalette } from '../state/url'
import { slugify, TEXT_FORMATS } from './formats'
import { toSvg } from './image'

const config = createPalette('#7c3aed')
const ramp = generateRamp(config)
const format = (id: string) => TEXT_FORMATS.find((f) => f.id === id)!

describe('slugify', () => {
  it('makes names safe for CSS and SCSS identifiers', () => {
    expect(slugify('Brand Purple')).toBe('brand-purple')
    expect(slugify('  Accent / Primary  ')).toBe('accent-primary')
    expect(slugify('!!!')).toBe('color')
    expect(slugify('')).toBe('color')
  })
})

describe('text formats', () => {
  it('lists one hex per step', () => {
    const lines = format('hex').build(ramp, 'brand').split('\n')
    expect(lines).toHaveLength(ramp.length)
    for (const line of lines) expect(line).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('emits CSS custom properties that name every step', () => {
    const css = format('css-hex').build(ramp, 'Brand Purple')
    expect(css.startsWith(':root {')).toBe(true)
    for (const swatch of ramp) {
      expect(css).toContain(`--brand-purple-${swatch.label}: ${swatch.hex};`)
    }
  })

  it('emits CSS custom properties in OKLCH when asked', () => {
    const css = format('css-oklch').build(ramp, 'brand')
    expect(css).toContain('oklch(')
    expect(css).not.toMatch(/: #[0-9a-f]{6};/)
  })

  it('emits a Tailwind scale that parses as an object literal', () => {
    const snippet = format('tailwind').build(ramp, 'brand')
    const parsed = new Function(`return {${snippet.replace(/,$/, '')}}`)() as {
      brand: Record<string, string>
    }
    expect(Object.keys(parsed.brand)).toHaveLength(ramp.length)
    expect(parsed.brand[ramp[0].label]).toBe(ramp[0].hex)
  })

  it('emits an SCSS map with quoted keys', () => {
    const scss = format('scss').build(ramp, 'brand')
    expect(scss.startsWith('$brand: (')).toBe(true)
    expect(scss.trimEnd().endsWith(');')).toBe(true)
    expect(scss).toContain(`'${ramp[0].label}': ${ramp[0].hex},`)
  })

  it('emits JSON carrying the OKLCH values, not just hex', () => {
    const parsed = JSON.parse(format('json').build(ramp, 'brand'))
    expect(parsed.space).toBe('oklch')
    expect(parsed.steps).toHaveLength(ramp.length)
    expect(parsed.steps[5].c).toBeCloseTo(ramp[5].oklch.c, 3)
    expect(parsed.steps[5].hex).toBe(ramp[5].hex)
  })
})

/**
 * Every hex output is sRGB, whatever the palette is being viewed in, so a
 * wide-gamut document needs one text format that can carry what is on
 * screen — and the JSON has to name the gamut, because `clipped` is
 * relative to it while `hex` is not.
 */
describe('text formats under a wide gamut', () => {
  const wide = generateRamp(config, 'rec2020')

  it('writes the same hex as an sRGB export', () => {
    expect(format('hex').build(wide, 'brand', 'rec2020')).toBe(
      format('hex').build(ramp, 'brand'),
    )
  })

  it('offers CSS custom properties in color() notation', () => {
    const css = format('css-display').build(wide, 'brand', 'rec2020')
    for (const swatch of wide) {
      expect(css).toContain(`--brand-${swatch.label}: ${swatch.displayColor};`)
    }
    expect(css).toContain('color(rec2020')
  })

  it('falls back to hex in that format when the palette is sRGB', () => {
    expect(format('css-display').build(ramp, 'brand')).toBe(
      format('css-hex').build(ramp, 'brand'),
    )
  })

  it('names the gamut in the JSON, so clipped can be read', () => {
    const parsed = JSON.parse(format('json').build(wide, 'brand', 'rec2020'))
    expect(parsed.gamut).toBe('rec2020')
    expect(parsed.steps[5].hex).toBe(wide[5].hex)
    expect(parsed.steps[5].display).toBe(wide[5].displayColor)
    expect(JSON.parse(format('json').build(ramp, 'brand')).gamut).toBe('srgb')
  })
})

describe('svg export', () => {
  const svg = toSvg(ramp, { size: 64, labels: false }, 'Brand Purple')

  it('is one named rect per step, so Figma gets editable layers', () => {
    const rects = svg.match(/<rect /g) ?? []
    expect(rects).toHaveLength(ramp.length)
    for (const swatch of ramp) {
      expect(svg).toContain(`id="brand-purple-${swatch.label}"`)
      expect(svg).toContain(`fill="${swatch.hex}"`)
    }
  })

  it('tiles the swatches edge to edge with no gaps', () => {
    const xs = [...svg.matchAll(/x="(\d+)"/g)].map((m) => Number(m[1]))
    expect(xs).toEqual(ramp.map((_, i) => i * 64))
    expect(svg).toContain(`width="${64 * ramp.length}"`)
  })
})

describe('share links', () => {
  it('round-trips a palette through the hash', () => {
    const edited = {
      ...config,
      hue: { start: -12, end: 30.5, h1: { x: 0.2, y: -20 }, h2: { x: 0.7, y: 45 } },
    }
    const decoded = decodePalette(`#${encodePalette(edited, 'Brand Purple')}`)!

    expect(decoded.name).toBe('Brand Purple')
    expect(decoded.config.steps).toBe(edited.steps)
    expect(decoded.config.baseIndex).toBe(edited.baseIndex)
    expect(decoded.config.base).toBe(edited.base)
    for (const key of ['lightness', 'chroma', 'hue'] as const) {
      for (const x of [0, 0.25, 0.5, 0.75, 1]) {
        expect(sampleCurve(decoded.config[key], x)).toBeCloseTo(
          sampleCurve(edited[key], x),
          3,
        )
      }
    }
  })

  it('reproduces the identical ramp from a link', () => {
    const decoded = decodePalette(`#${encodePalette(config, 'brand')}`)!
    expect(generateRamp(decoded.config).map((s) => s.hex)).toEqual(ramp.map((s) => s.hex))
  })

  it('falls back gracefully on a mangled link', () => {
    expect(decodePalette('')).toBeNull()
    expect(decodePalette('#')).toBeNull()
    expect(decodePalette('#n=oops')).toBeNull()

    // A good base with junk curves still opens: the curves fall back to the
    // defaults rather than the whole link failing.
    const salvaged = decodePalette('#c=7c3aed&l=not,a,curve&s=999')!
    expect(salvaged.config.base).toBe('#7c3aed')
    expect(salvaged.config.steps).toBe(config.steps)
    expect(generateRamp(salvaged.config)).toHaveLength(config.steps)
  })
})
