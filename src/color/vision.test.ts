import { describe, expect, it } from 'vitest'
import { inkOn, simulate, VISIONS, type Vision } from './vision'
import { parseToOklch, relativeLuminance, toHex, type Oklch } from './oklch'

/**
 * What a swatch actually carries, and so what the board actually hands to a
 * simulation: the hex the strict gamut map produced, not the string that was
 * typed. The two are not always the same — `#0000ff` sits far enough outside
 * what that map will certify that it comes back `#0031e5` — and testing
 * against the typed string would be testing a colour the tool never shows.
 */
const swatch = (input: string): { oklch: Oklch; hex: string } => {
  const oklch = parseToOklch(input)!
  return { oklch, hex: toHex(oklch) }
}

const RED = swatch('#ff0000')
const GREEN = swatch('#00cc00')
const BLUE = swatch('#0000ff')
const YELLOW = swatch('#ffee00')

const channels = (hex: string) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

/** Plain sRGB distance: enough to say two chips are, or are not, one chip. */
function distance(a: string, b: string): number {
  const [ar, ag, ab] = channels(a)
  const [br, bg, bb] = channels(b)
  return Math.hypot(ar - br, ag - bg, ab - bb)
}

/** The shorter way round the hue wheel, in degrees. */
function hueGap(a: string, b: string): number {
  const ha = parseToOklch(a)!.h
  const hb = parseToOklch(b)!.h
  const raw = (((ha - hb) % 360) + 360) % 360
  return Math.min(raw, 360 - raw)
}

const simulations = VISIONS.map((option) => option.id).filter(
  (id): id is Exclude<Vision, 'normal'> => id !== 'normal',
)

describe('simulate', () => {
  it('leaves the colour alone in normal vision', () => {
    expect(simulate(RED.hex, 'normal')).toBe(RED.hex)
  })

  /**
   * The confusion matrices have rows summing to one precisely so the grey
   * axis survives them. A simulation that tinted the neutrals would be
   * visibly wrong at a glance — and on a board of tints and shades, where the
   * top of every ramp is nearly white, it would be wrong nearly everywhere.
   */
  it('holds the greys, whoever is looking', () => {
    for (const vision of simulations) {
      for (const grey of ['#000000', '#404040', '#808080', '#e5e5e5', '#ffffff']) {
        const [r, g, b] = channels(simulate(grey, vision))
        expect(Math.abs(r - g)).toBeLessThanOrEqual(1)
        expect(Math.abs(g - b)).toBeLessThanOrEqual(1)
        expect(Math.abs(r - channels(grey)[0])).toBeLessThanOrEqual(1)
      }
    }
  })

  it('always answers with a colour, whatever it is handed', () => {
    for (const vision of simulations) {
      expect(simulate(RED.hex, vision)).toMatch(/^#[0-9a-f]{6}$/)
      // Unparseable comes back untouched. A chip painted black because the
      // simulation gave up would be read as a colour somebody chose.
      expect(simulate('nonsense', vision)).toBe('nonsense')
      expect(simulate('color(display-p3 1 0 0)', vision)).toBe('color(display-p3 1 0 0)')
    }
    expect(simulate('#f00', 'grayscale')).toBe(simulate('#ff0000', 'grayscale'))
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
    for (const { hex } of [RED, GREEN, BLUE, YELLOW, swatch('#7c3aed')]) {
      const [r, g, b] = channels(simulate(hex, 'grayscale'))
      expect(r).toBe(g)
      expect(g).toBe(b)
    }
  })

  it('keeps the luminance the contrast figures are read from', () => {
    for (const { oklch, hex } of [RED, GREEN, BLUE, YELLOW, swatch('#7c3aed'), swatch('#0ea5e9')]) {
      const grey = parseToOklch(simulate(hex, 'grayscale'))!
      expect(relativeLuminance(grey)).toBeCloseTo(relativeLuminance(oklch), 2)
    }
  })

  it('merges the colours a same-lightness palette is built from', () => {
    // Two hues at nearly the same luminance: unmistakable in colour, one chip
    // in tone. The pair a designer discovers the hard way, in a chart.
    const a = swatch('#d94f4f').hex
    const b = swatch('#b06a1f').hex
    expect(distance(a, b)).toBeGreaterThan(60)
    expect(distance(simulate(a, 'grayscale'), simulate(b, 'grayscale'))).toBeLessThan(12)
  })
})

/**
 * Each dichromacy collapses one axis of colour, and these are the confusions
 * the board exists to surface — so they are asserted as confusions. Hue is
 * the thing to assert on, not distance: red and green come out of a
 * protanope's eye as the *same* yellow at two lightnesses, so they stay far
 * apart in RGB while having nothing left to tell them apart but light and
 * dark.
 */
describe('the dichromacies', () => {
  it('runs red and green together for a protanope and a deuteranope', () => {
    expect(hueGap(RED.hex, GREEN.hex)).toBeGreaterThan(90)
    for (const vision of ['protanopia', 'deuteranopia'] as const) {
      expect(hueGap(simulate(RED.hex, vision), simulate(GREEN.hex, vision))).toBeLessThan(5)
    }
  })

  it('leaves blue and yellow standing apart for them', () => {
    for (const vision of ['protanopia', 'deuteranopia'] as const) {
      expect(hueGap(simulate(BLUE.hex, vision), simulate(YELLOW.hex, vision))).toBeGreaterThan(90)
      expect(distance(simulate(BLUE.hex, vision), simulate(YELLOW.hex, vision))).toBeGreaterThan(200)
    }
  })

  it('runs blue into green for a tritanope, and leaves red alone', () => {
    expect(
      hueGap(simulate(BLUE.hex, 'tritanopia'), simulate(GREEN.hex, 'tritanopia')),
    ).toBeLessThan(hueGap(BLUE.hex, GREEN.hex) / 2)
    expect(hueGap(RED.hex, simulate(RED.hex, 'tritanopia'))).toBeLessThan(10)
  })

  /**
   * A protanope has lost the cone carrying most of the luminance, so a red
   * that reads as a mid tone to most eyes is a dark one to them. It is why
   * the type on a chip takes its colour from the simulation rather than from
   * the contrast figures the swatch was born with.
   */
  it('darkens red for a protanope', () => {
    const before = relativeLuminance(RED.oklch)
    const after = relativeLuminance(parseToOklch(simulate(RED.hex, 'protanopia'))!)
    // Nearly half the light in it, gone.
    expect(after).toBeLessThan(before * 0.6)
  })
})

describe('inkOn', () => {
  it('picks the readable one', () => {
    expect(inkOn('#ffffff')).toBe('#000000')
    expect(inkOn('#000000')).toBe('#ffffff')
    expect(inkOn('#f5f5f5')).toBe('#000000')
    expect(inkOn('#1a1a2e')).toBe('#ffffff')
  })

  /**
   * Every swatch already carries its own W/B contrast figures, computed from
   * the OKLCH request. This reads the same decision off the hex instead, so
   * the two have to agree — otherwise switching a simulation on and straight
   * back off would flip the type on chips that never changed colour.
   */
  it('agrees with the contrast figures a swatch already carries', () => {
    const inputs = [
      '#ff0000',
      '#00cc00',
      '#0000ff',
      '#ffee00',
      '#7c3aed',
      '#767676',
      '#0ea5e9',
      '#f59e0b',
    ]
    for (const input of inputs) {
      const { oklch, hex } = swatch(input)
      const luminance = relativeLuminance(oklch)
      const onWhite = 1.05 / (luminance + 0.05)
      const onBlack = (luminance + 0.05) / 0.05
      expect(inkOn(hex)).toBe(onBlack >= onWhite ? '#000000' : '#ffffff')
    }
  })
})
