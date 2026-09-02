import { describe, expect, it } from 'vitest'
import { maxChromaFor } from './gamut'
import { isInGamut, parseToOklch, GAMUTS, type Gamut } from './oklch'
import {
  AXIS_MAX,
  axisMaxChroma,
  cuspFor,
  fromSlicePoint,
  gamutBoundary,
  hueStops,
  sliceCells,
  toSlicePoint,
} from './slice'

const HUES = [0, 45, 90, 140, 200, 250, 300, 340]

describe('the chroma axis', () => {
  /**
   * The axis has to contain the gamut: a hardcoded ceiling that any real
   * colour could exceed would push the marker off the plot, and the wedge
   * would be drawn wider than the box.
   */
  it('is a true ceiling for every gamut', () => {
    for (const { id } of GAMUTS) {
      for (let h = 0; h < 360; h += 5) {
        for (let l = 0.05; l < 1; l += 0.05) {
          expect(maxChromaFor(l, h, id)).toBeLessThanOrEqual(AXIS_MAX[id])
        }
      }
    }
  })

  /** And it has to be tight, or every slice would sit in a sea of dead space. */
  it('is reached to within a few percent, so the plot is not mostly empty', () => {
    for (const { id } of GAMUTS) {
      let peak = 0
      for (let h = 0; h < 360; h += 5) {
        for (let l = 0.05; l < 1; l += 0.05) {
          peak = Math.max(peak, maxChromaFor(l, h, id))
        }
      }
      expect(peak).toBeGreaterThan(AXIS_MAX[id] * 0.9)
    }
  })

  it('widens with the gamut, so switching one visibly buys chroma', () => {
    expect(axisMaxChroma('srgb')).toBeLessThan(axisMaxChroma('p3'))
    expect(axisMaxChroma('p3')).toBeLessThan(axisMaxChroma('a98'))
    expect(axisMaxChroma('a98')).toBeLessThan(axisMaxChroma('rec2020'))
  })
})

describe('the gamut boundary', () => {
  it('closes to nothing at black and at white', () => {
    for (const h of HUES) {
      const boundary = gamutBoundary(h, 'srgb')
      expect(boundary[0]).toEqual({ l: 0, c: 0 })
      expect(boundary[boundary.length - 1].c).toBe(0)
    }
  })

  it('traces lightness from bottom to top, in order', () => {
    const boundary = gamutBoundary(250, 'srgb')
    for (let i = 1; i < boundary.length; i++) {
      expect(boundary[i].l).toBeGreaterThan(boundary[i - 1].l)
    }
  })

  it('stays inside the gamut it describes', () => {
    for (const h of HUES) {
      for (const { id } of GAMUTS) {
        for (const point of gamutBoundary(h, id)) {
          expect(isInGamut({ l: point.l, c: point.c, h }, id)).toBe(true)
        }
      }
    }
  })

  it('is the edge, so a hair more chroma falls out of the gamut', () => {
    for (const h of HUES) {
      for (const point of gamutBoundary(h, 'srgb')) {
        if (point.c === 0) continue
        expect(isInGamut({ l: point.l, c: point.c + 0.02, h }, 'srgb')).toBe(false)
      }
    }
  })

  it('encloses more at every hue as the gamut widens', () => {
    for (const h of HUES) {
      const srgb = gamutBoundary(h, 'srgb')
      const rec2020 = gamutBoundary(h, 'rec2020')
      const wider = srgb.filter((point, i) => rec2020[i].c > point.c)
      expect(wider.length).toBeGreaterThan(srgb.length / 2)
    }
  })

  it('reads a hue in any turn of the circle', () => {
    expect(gamutBoundary(30, 'srgb')).toEqual(gamutBoundary(390, 'srgb'))
    expect(gamutBoundary(30, 'srgb')).toEqual(gamutBoundary(-330, 'srgb'))
  })
})

describe('the cusp', () => {
  it('is the widest point on the boundary', () => {
    for (const h of HUES) {
      const cusp = cuspFor(h, 'srgb')
      for (const point of gamutBoundary(h, 'srgb')) {
        expect(cusp.c).toBeGreaterThanOrEqual(point.c - 1e-9)
      }
    }
  })

  /**
   * The corner falls between samples, so a coarse scan understates it. If
   * refining never beat the samples the search would be doing nothing.
   */
  it('is refined past the sampled peak', () => {
    const improved = HUES.filter((h) => {
      const sampled = Math.max(...gamutBoundary(h, 'srgb').map((point) => point.c))
      return cuspFor(h, 'srgb').c > sampled
    })
    expect(improved.length).toBeGreaterThan(0)
  })

  it('sits inside the gamut, away from both ends of the lightness range', () => {
    for (const h of HUES) {
      const cusp = cuspFor(h, 'srgb')
      expect(isInGamut({ l: cusp.l, c: cusp.c, h }, 'srgb')).toBe(true)
      expect(cusp.l).toBeGreaterThan(0.2)
      expect(cusp.l).toBeLessThan(1)
    }
  })

  /**
   * The whole reason the axis is fixed rather than normalised: hues differ
   * enormously in how much chroma they hold, and that difference is
   * information.
   */
  it('is far higher on some hues than others', () => {
    const cyan = cuspFor(195, 'srgb').c
    const magenta = cuspFor(328, 'srgb').c
    expect(magenta).toBeGreaterThan(cyan * 1.5)
  })
})

describe('the slice body', () => {
  it('paints every cell with a colour the gamut can actually show', () => {
    for (const gamut of ['srgb', 'p3'] as Gamut[]) {
      for (const cell of sliceCells(250, gamut)) {
        expect(cell.color).not.toBe('')
        if (gamut === 'srgb') expect(cell.color).toMatch(/^#[0-9a-f]{6}$/)
        else expect(cell.color).toContain('color(')
      }
    }
  })

  it('keeps every cell inside the unit box', () => {
    for (const h of HUES) {
      for (const cell of sliceCells(h, 'srgb')) {
        expect(cell.x).toBeGreaterThanOrEqual(0)
        expect(cell.y).toBeGreaterThanOrEqual(0)
        expect(cell.x + cell.w).toBeLessThanOrEqual(1 + 1e-9)
        expect(cell.y + cell.h).toBeLessThanOrEqual(1 + 1e-9)
      }
    }
  })

  /**
   * Rows are fitted to the wedge rather than clipped to it, so the row at
   * the cusp is the widest one and the rows near white are slivers. That is
   * what gives the slice its shape.
   */
  it('fits each row to the gamut, so the rows differ in width', () => {
    const cells = sliceCells(250, 'srgb')
    const widths = [...new Set(cells.map((cell) => cell.w.toFixed(6)))]
    expect(widths.length).toBeGreaterThan(5)
  })

  it('reaches close to the full width of the axis at the cusp', () => {
    const cells = sliceCells(328, 'srgb')
    const reach = Math.max(...cells.map((cell) => cell.x + cell.w))
    expect(reach).toBeGreaterThan(0.8)
  })

  it('hands back the same cells for the same hue, rather than rebuilding them', () => {
    expect(sliceCells(250, 'srgb')).toBe(sliceCells(250, 'srgb'))
    expect(sliceCells(250, 'srgb')).not.toBe(sliceCells(250, 'p3'))
  })
})

describe('slice coordinates', () => {
  it('puts light colours at the top and chroma to the right', () => {
    const light = toSlicePoint({ l: 0.9, c: 0.05, h: 250 }, 'srgb')
    const dark = toSlicePoint({ l: 0.2, c: 0.05, h: 250 }, 'srgb')
    const vivid = toSlicePoint({ l: 0.5, c: 0.25, h: 250 }, 'srgb')
    const grey = toSlicePoint({ l: 0.5, c: 0, h: 250 }, 'srgb')

    expect(light.y).toBeLessThan(dark.y)
    expect(vivid.x).toBeGreaterThan(grey.x)
    expect(grey.x).toBe(0)
  })

  it('round-trips a point back to the colour it stands for', () => {
    const color = { l: 0.62, c: 0.14, h: 250 }
    const point = toSlicePoint(color, 'srgb')
    const back = fromSlicePoint(point.x, point.y, 'srgb')
    expect(back.l).toBeCloseTo(color.l, 6)
    expect(back.c).toBeCloseTo(color.c, 6)
  })
})

describe('the hue strip', () => {
  it('covers the circle once, in order, without repeating an end', () => {
    const stops = hueStops(0.6, 0.12, 'srgb')
    expect(stops[0].h).toBe(0)
    expect(stops[stops.length - 1].h).toBeLessThan(360)
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].h).toBeGreaterThan(stops[i - 1].h)
    }
  })

  /**
   * Painted with what the display would give, not what was asked for. At a
   * chroma most hues cannot hold, each stop comes back reduced to its own
   * boundary — so the strip is a preview of the colours you would actually
   * get rather than a promise the gamut cannot keep.
   */
  it('never shows more chroma than the gamut can give at that hue', () => {
    for (const gamut of ['srgb', 'p3'] as Gamut[]) {
      for (const stop of hueStops(0.75, 0.3, gamut)) {
        const shown = parseToOklch(stop.color)
        expect(shown).not.toBeNull()
        expect(shown!.c).toBeLessThanOrEqual(maxChromaFor(0.75, stop.h, gamut) + 0.005)
      }
    }
  })

  it('holds the requested chroma on the hues that can carry it', () => {
    const asked = 0.05
    for (const stop of hueStops(0.6, asked, 'srgb')) {
      expect(parseToOklch(stop.color)!.c).toBeCloseTo(asked, 2)
    }
  })

  it('has a colour for every stop at a chroma every hue can hold', () => {
    for (const stop of hueStops(0.6, 0.02, 'srgb')) {
      expect(stop.color).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
