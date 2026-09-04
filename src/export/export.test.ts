import { describe, expect, it } from 'vitest'
import { sampleCurve } from '../color/curve'
import { createPalette } from '../color/presets'
import { generateRamp } from '../color/ramp'
import { decodePalette, encodePalette } from '../state/url'
import { buildText, slugify, TEXT_FORMATS } from './formats'
import { boardSvg, drawBoard, rampsSvg, toSvg, type BoardOptions } from './image'

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

/**
 * Several palettes at once, which is what the export dialog asks for. One
 * palette must still come out byte for byte as it always did: what someone
 * pastes into a stylesheet cannot change shape because the document beside
 * it grew.
 */
describe('text formats over a set of palettes', () => {
  const sky = generateRamp(createPalette('#0ea5e9'))
  const two = [
    { name: 'brand', ramp },
    { name: 'sky', ramp: sky },
  ]
  const one = [{ name: 'brand', ramp }]

  it('leaves a single palette exactly as build wrote it', () => {
    for (const entry of TEXT_FORMATS) {
      expect(buildText(entry, one)).toBe(entry.build(ramp, 'brand'))
    }
  })

  it('heads each block with its name, since a list has nowhere else to say it', () => {
    const lines = buildText(format('hex'), two).split('\n')
    expect(lines[0]).toBe('brand')
    expect(lines[1]).toBe(ramp[0].hex)
    expect(lines[ramp.length + 2]).toBe('sky')
    expect(lines).toHaveLength(ramp.length + sky.length + 3)
  })

  it('keeps every palette inside one :root, not one block each', () => {
    const css = buildText(format('css-hex'), two)
    expect(css.match(/:root/g)).toHaveLength(1)
    expect(css).toContain('--brand-')
    expect(css).toContain('--sky-')
    expect(css.trimEnd().endsWith('}')).toBe(true)
  })

  it('emits an array of palettes as JSON, so the whole thing parses', () => {
    const parsed = JSON.parse(buildText(format('json'), two))
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.map((entry: { name: string }) => entry.name)).toEqual(['brand', 'sky'])
    expect(parsed[1].steps).toHaveLength(sky.length)
  })

  it('stacks Tailwind keys with no blank line, ready for a theme object', () => {
    const js = buildText(format('tailwind'), two)
    expect(js).toContain("brand: {")
    expect(js).toContain("sky: {")
    expect(js).not.toContain('\n\n')
  })

  it('separates SCSS maps, which are siblings at the top level of a file', () => {
    const scss = buildText(format('scss'), two)
    expect(scss).toContain('$brand: (')
    expect(scss).toContain('$sky: (')
    expect(scss).toContain(');\n\n$sky')
  })
})

describe('a set of palettes as one SVG', () => {
  const sky = generateRamp(createPalette('#0ea5e9'))
  const svg = rampsSvg(
    [
      { name: 'Brand Purple', ramp },
      { name: 'sky', ramp: sky },
    ],
    { size: 40, labels: false },
  )

  it('groups one named rect per step under one named group per palette', () => {
    expect(svg.match(/<g /g)).toHaveLength(2)
    expect(svg).toContain('<g id="brand-purple">')
    expect(svg).toContain('<g id="sky">')
    expect(svg.match(/<rect /g)).toHaveLength(ramp.length + sky.length)
  })

  it('bands the palettes down the image, edge to edge', () => {
    expect(svg).toContain(`height="${40 * 2}"`)
    expect(svg).toContain('y="0"')
    expect(svg).toContain('y="40"')
  })

  it('matches the single-ramp export when there is only one palette', () => {
    const alone = rampsSvg([{ name: 'Brand Purple', ramp }], { size: 64, labels: false })
    const rects = alone.match(/<rect [^>]*>/g) ?? []
    expect(rects).toHaveLength(ramp.length)
    expect(alone).toContain(`width="${64 * ramp.length}" height="${64}"`)
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

/**
 * The board as layers rather than pixels. The labels are carried as *names*
 * here — the group takes the palette's, each rect takes its step's — because
 * that is what a Figma layer panel reads back to you, where a text element
 * baked over the colour would only be in the way.
 */
describe('the board as SVG', () => {
  const sky = generateRamp(createPalette('#0ea5e9'))
  const palettes = [
    { name: 'Brand Purple', ramp },
    // Values are the PNG's business; this one carries some to prove it.
    { name: 'Sky', ramp: sky, values: ramp.map(() => 'ignored') },
  ]
  const options: BoardOptions = {
    axis: 'rows',
    gap: 10,
    paletteWeights: [1, 1],
    stepWeights: ramp.map(() => 1),
    labels: true,
    width: 1000,
    height: 420,
    background: '#ffffff',
  }
  const board = boardSvg(palettes, options)

  it('groups one named rect per step under one named group per palette', () => {
    expect(board.match(/<g /g)).toHaveLength(2)
    expect(board).toContain('<g id="brand-purple">')
    expect(board).toContain('<g id="sky">')
    expect(board.match(/<rect /g)).toHaveLength(ramp.length * 2)
    for (const swatch of ramp) {
      expect(board).toContain(`id="brand-purple-${swatch.label}"`)
    }
  })

  it('carries labels when toggled on, and omits them when toggled off', () => {
    expect(board).toContain('<text')
    expect(board).not.toContain('BRAND PURPLE')
    expect(board).toContain('ignored')
    expect(board).toMatch(/W \d+(\.\d+)? · B \d+(\.\d+)?/)
    for (const swatch of ramp) {
      expect(board).toContain(`>${swatch.label}</text>`)
    }

    const unlabelled = boardSvg(palettes, { ...options, labels: false })
    expect(unlabelled).not.toContain('<text')
    expect(unlabelled).not.toContain('ignored')
  })

  it('tiles the steps edge to edge and gaps only the palettes', () => {
    const band = board.slice(
      board.indexOf('<g id="brand-purple">'),
      board.indexOf('<g id="sky">'),
    )
    const xs = [...band.matchAll(/<rect [^>]*x="(\d+)"/g)].map((m) => Number(m[1]))
    const widths = [...band.matchAll(/<rect [^>]*width="(\d+)"/g)].map((m) => Number(m[1]))
    xs.forEach((x, index) => {
      if (index === 0) return expect(x).toBe(0)
      expect(x).toBe(xs[index - 1] + widths[index - 1])
    })
    expect(xs[xs.length - 1] + widths[widths.length - 1]).toBe(1000)
    // The gap comes off the stacking axis only: two bands over 420px with a
    // 10px gap gives 205 each, so the second starts at 215.
    const rectYs = [...board.matchAll(/<rect [^>]*y="(\d+)"/g)].map((m) => Number(m[1]))
    expect(new Set(rectYs)).toEqual(new Set([0, 215]))
  })

  /**
   * With the steps unlocked, `stepWeights` is sized from the palette that
   * happens to be selected, so a longer ramp runs off the end of it. Every
   * step past the end used to be dropped for want of a width, which took the
   * tail off any palette with more steps than that one.
   */
  it('draws every step of a palette longer than the shared weights', () => {
    const long = generateRamp(createPalette('#0ea5e9', 17))
    const short = generateRamp(createPalette('#7c3aed', 5))
    expect(long).toHaveLength(17)

    const mixed = boardSvg([{ name: 'Short', ramp: short }, { name: 'Long', ramp: long }], {
      ...options,
      // As the board hands them over: five entries, for the selected palette.
      stepWeights: short.map(() => 1),
      labels: false,
    })

    expect(mixed.match(/<rect /g)).toHaveLength(short.length + long.length)
    for (const swatch of long) {
      expect(mixed).toContain(`id="long-${swatch.label}"`)
    }

    // And each ramp still spans the full width, tiled edge to edge.
    const band = mixed.slice(mixed.indexOf('<g id="long">'))
    const xs = [...band.matchAll(/<rect [^>]*x="(\d+)"/g)].map((m) => Number(m[1]))
    const widths = [...band.matchAll(/<rect [^>]*width="(\d+)"/g)].map((m) => Number(m[1]))
    expect(xs[0]).toBe(0)
    xs.forEach((x, index) => {
      if (index === 0) return
      expect(x).toBe(xs[index - 1] + widths[index - 1])
    })
    expect(xs[xs.length - 1] + widths[widths.length - 1]).toBe(1000)
  })

  it('fills every step of a longer palette on canvas too', () => {
    const long = generateRamp(createPalette('#0ea5e9', 17))
    const short = generateRamp(createPalette('#7c3aed', 5))
    const filled: { w: number; h: number }[] = []
    const ctx = {
      fillStyle: '',
      fillRect: (_x: number, _y: number, w: number, h: number) => filled.push({ w, h }),
      fillText: () => {},
      measureText: () => ({ width: 0 }),
      textAlign: '',
      textBaseline: '',
      font: '',
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement

    drawBoard(canvas, [{ name: 'Short', ramp: short }, { name: 'Long', ramp: long }], {
      ...options,
      stepWeights: short.map(() => 1),
      labels: false,
    })

    // One background fill, then every step of both ramps.
    expect(filled).toHaveLength(1 + short.length + long.length)
  })

  it('draws contrast-based labels on canvas when labels are enabled (without palette names)', () => {
    const filledTexts: { text: string; fillStyle: string }[] = []
    const filledRects: { x: number; y: number; w: number; h: number; fillStyle: string }[] = []
    const ctx = {
      fillStyle: '',
      fillRect: (x: number, y: number, w: number, h: number) => {
        filledRects.push({ x, y, w, h, fillStyle: ctx.fillStyle })
      },
      fillText: (text: string) => {
        filledTexts.push({ text, fillStyle: ctx.fillStyle })
      },
      measureText: (text: string) => ({ width: text.length * 6 }),
      font: '',
      textAlign: '',
      textBaseline: '',
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement

    drawBoard(canvas, palettes, options)

    // Palette names are not drawn in exports
    expect(filledTexts.some((t) => t.text === 'BRAND PURPLE')).toBe(false)
    expect(filledTexts.some((t) => t.text === 'SKY')).toBe(false)

    // Color numbers drawn
    for (const swatch of ramp) {
      expect(filledTexts.some((t) => t.text === swatch.label)).toBe(true)
    }

    // W and B contrast ratios drawn
    expect(filledTexts.some((t) => /^W \d+(\.\d+)? · B \d+(\.\d+)?$/.test(t.text))).toBe(true)

    // Text colors are strictly either black or white based on contrast
    for (const t of filledTexts) {
      expect(['#000000', '#ffffff']).toContain(t.fillStyle)
    }
  })

  it('omits all text when labels are disabled on canvas', () => {
    const filledTexts: string[] = []
    const ctx = {
      fillStyle: '',
      fillRect: () => {},
      fillText: (text: string) => {
        filledTexts.push(text)
      },
      measureText: () => ({ width: 10 }),
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement

    drawBoard(canvas, palettes, { ...options, labels: false })
    expect(filledTexts).toHaveLength(0)
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
