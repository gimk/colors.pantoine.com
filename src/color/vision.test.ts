import { describe, expect, it } from 'vitest'
import { inkOn, simulate, VISIONS, type Vision } from './vision'
import {
  isInGamut,
  isInSrgb,
  parseToOklch,
  relativeLuminance,
  toHex,
  type Oklch,
} from './oklch'

const RED = parseToOklch('#ff0000')!
const GREEN = parseToOklch('#00cc00')!
const BLUE = parseToOklch('#0000ff')!
const YELLOW = parseToOklch('#ffee00')!

/** The shorter way round the hue wheel, in degrees. */
function hueGap(a: Oklch, b: Oklch): number {
  const raw = (((a.h - b.h) % 360) + 360) % 360
  return Math.min(raw, 360 - raw)
}

const simulations = VISIONS.map((option) => option.id).filter(
  (id): id is Exclude<Vision, 'normal'> => id !== 'normal',
)

describe('simulate', () => {
  it('leaves the colour alone in normal vision', () => {
    expect(simulate(RED, 'normal')).toBe(RED)
  })

  /**
   * The confusion matrices have rows summing to one precisely so the grey
   * axis survives them. A simulation that tinted the neutrals would be
   * visibly wrong at a glance — and on a board of tints and shades, where the
   * top of every ramp is nearly white, it would be wrong nearly everywhere.
   */
  it('holds the greys, whoever is looking', () => {
    for (const vision of simulations) {
      for (const l of [0, 0.25, 0.5, 0.9, 1]) {
        const grey = simulate({ l, c: 0, h: 0 }, vision)
        expect(grey.c).toBeLessThan(0.001)
        expect(grey.l).toBeCloseTo(l, 4)
      }
    }
  })

  it('always answers with a colour', () => {
    for (const vision of simulations) {
      const seen = simulate(RED, vision)
      expect(Number.isFinite(seen.l)).toBe(true)
      expect(Number.isFinite(seen.c)).toBe(true)
      expect(Number.isFinite(seen.h)).toBe(true)
      expect(seen.l).toBeGreaterThanOrEqual(0)
      expect(seen.c).toBeGreaterThanOrEqual(0)
    }
  })
})

/**
 * The reason this works in colour rather than in hex.
 *
 * A dichromacy is a linear map in linear light, and linear sRGB is a complete
 * set of coordinates for colour rather than a box — the unit cube is the
 * *gamut*, and the space runs past it in every direction. So a P3 colour is
 * simulated as itself, as a triple with a coordinate past one, and the answer
 * is whatever colour that is. Simulating the sRGB rendition instead answers a
 * different question, and on saturated colours it answers it differently.
 */
describe('outside sRGB', () => {
  /** A saturated green a phone can show and a laptop cannot. */
  const wideGreen: Oklch = { l: 0.55, c: 0.22, h: 145 }

  it('is a colour the tool can hold', () => {
    expect(isInSrgb(wideGreen)).toBe(false)
    expect(isInGamut(wideGreen, 'p3')).toBe(true)
  })

  /**
   * Squeezing to sRGB first takes chroma out of the colour, and the
   * simulation then reports a duller confusion than the eye would actually
   * receive — understating, on this green, by a quarter. The hues agree
   * closely; it is the colourfulness the shortcut loses.
   */
  it('simulates the colour, not its sRGB rendition', () => {
    const honest = simulate(wideGreen, 'deuteranopia')
    const throughSrgb = simulate(parseToOklch(toHex(wideGreen))!, 'deuteranopia')
    expect(honest.c).toBeGreaterThan(throughSrgb.c * 1.2)
  })

  /**
   * And the answer is itself a colour sRGB cannot hold, which is the part a
   * hex could not have carried at any point in the pipeline: it takes the
   * document's own gamut to show what the dichromat actually receives.
   */
  it('answers in the gamut the palette is designed for', () => {
    const honest = simulate(wideGreen, 'deuteranopia')
    expect(isInSrgb(honest)).toBe(false)
    expect(isInGamut(honest, 'p3')).toBe(true)
  })
})

/**
 * The point of the grey mode: two steps that merge in it are two steps
 * nothing but hue was telling apart — which is exactly the pair a contrast
 * check cannot separate either. So it has to be luminance rather than an
 * average of the channels, and it has to be the same luminance the W/B
 * figures stamped on the chips are read from, or the board disagrees with its
 * own labels.
 */
describe('grayscale', () => {
  it('paints a neutral', () => {
    for (const color of [RED, GREEN, BLUE, YELLOW, parseToOklch('#7c3aed')!]) {
      expect(simulate(color, 'grayscale').c).toBeLessThan(0.001)
    }
  })

  it('keeps the luminance the contrast figures are read from', () => {
    for (const color of [RED, GREEN, YELLOW, parseToOklch('#7c3aed')!, parseToOklch('#0ea5e9')!]) {
      const grey = simulate(color, 'grayscale')
      expect(relativeLuminance(grey)).toBeCloseTo(relativeLuminance(color), 2)
    }
  })

  it('merges the colours a same-lightness palette is built from', () => {
    // Two hues at the same luminance, sixty degrees apart: unmistakable in
    // colour, and the very same chip in tone. The pair a designer discovers
    // the hard way, in a chart.
    const a = parseToOklch('#d94f4f')!
    const b = parseToOklch('#9f7820')!
    expect(hueGap(a, b)).toBeGreaterThan(45)
    expect(simulate(a, 'grayscale').l).toBeCloseTo(simulate(b, 'grayscale').l, 3)
  })
})

/**
 * Each dichromacy collapses one axis of colour, and these are the confusions
 * the board exists to surface — so they are asserted as confusions. Hue is
 * the thing to assert on: red and green come out of a protanope's eye as the
 * *same* yellow at two lightnesses, with nothing left to tell them apart but
 * light and dark.
 */
describe('the dichromacies', () => {
  it('runs red and green together for a protanope and a deuteranope', () => {
    expect(hueGap(RED, GREEN)).toBeGreaterThan(90)
    for (const vision of ['protanopia', 'deuteranopia'] as const) {
      expect(hueGap(simulate(RED, vision), simulate(GREEN, vision))).toBeLessThan(5)
    }
  })

  it('leaves blue and yellow standing apart for them', () => {
    for (const vision of ['protanopia', 'deuteranopia'] as const) {
      expect(hueGap(simulate(BLUE, vision), simulate(YELLOW, vision))).toBeGreaterThan(90)
    }
  })

  it('runs blue into green for a tritanope, and leaves red alone', () => {
    expect(hueGap(simulate(BLUE, 'tritanopia'), simulate(GREEN, 'tritanopia'))).toBeLessThan(
      hueGap(BLUE, GREEN) / 2,
    )
    expect(hueGap(RED, simulate(RED, 'tritanopia'))).toBeLessThan(10)
  })

  /**
   * A protanope has lost the cone carrying most of the luminance, so a red
   * that reads as a mid tone to most eyes is a dark one to them. It is why
   * the type on a chip takes its colour from the simulation rather than from
   * the contrast figures the swatch was born with.
   */
  it('darkens red for a protanope', () => {
    // Nearly half the light in it, gone.
    expect(relativeLuminance(simulate(RED, 'protanopia'))).toBeLessThan(
      relativeLuminance(RED) * 0.6,
    )
  })
})

describe('inkOn', () => {
  it('picks the readable one', () => {
    expect(inkOn({ l: 1, c: 0, h: 0 })).toBe('#000000')
    expect(inkOn({ l: 0, c: 0, h: 0 })).toBe('#ffffff')
    expect(inkOn(parseToOklch('#f5f5f5')!)).toBe('#000000')
    expect(inkOn(parseToOklch('#1a1a2e')!)).toBe('#ffffff')
  })

  /**
   * Every swatch already carries its own W/B contrast figures. This has to
   * reach the same verdict from the colour alone, or switching a simulation
   * on and straight back off would flip the type on chips that never changed.
   */
  it('agrees with the contrast figures a swatch already carries', () => {
    const inputs = ['#ff0000', '#00cc00', '#0000ff', '#ffee00', '#7c3aed', '#767676', '#f59e0b']
    for (const input of inputs) {
      const color = parseToOklch(input)!
      const luminance = relativeLuminance(color)
      const onWhite = 1.05 / (luminance + 0.05)
      const onBlack = (luminance + 0.05) / 0.05
      expect(inkOn(color)).toBe(onBlack >= onWhite ? '#000000' : '#ffffff')
    }
  })
})
