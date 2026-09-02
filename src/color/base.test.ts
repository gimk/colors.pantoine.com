import { describe, expect, it } from 'vitest'
import { CHANNELS, flat, linear, sampleCurve } from './curve'
import { parseToOklch } from './oklch'
import {
  baseIndexFor,
  baseX,
  chromaCurveFor,
  createPalette,
  holdBase,
  lightnessCurveFor,
} from './presets'
import { countDuplicateSteps, generateRamp } from './ramp'

const HUES = ['#facc15', '#7c3aed', '#06b6d4', '#dc2626', '#059669', '#1e1b4b', '#64748b']

/** Positions a designer would plausibly ask for: near the measured one. */
function realisticPositions(baseHex: string, steps: number): number[] {
  const measured = baseIndexFor(parseToOklch(baseHex)!, steps)
  const positions: number[] = []
  for (let i = Math.max(0, measured - 2); i <= Math.min(steps - 1, measured + 2); i++) {
    positions.push(i)
  }
  return positions
}

describe('base at step', () => {
  it('puts the base colour exactly on the step it was asked for', () => {
    for (const hex of HUES) {
      const base = parseToOklch(hex)!
      for (const steps of [5, 11, 21]) {
        for (let index = 0; index < steps; index++) {
          const lightness = lightnessCurveFor(base, steps, index)
          const chroma = chromaCurveFor(base, steps, index, lightness)
          const x = baseX(steps, index)
          expect(sampleCurve(lightness, x)).toBeCloseTo(base.l, 6)
          expect(sampleCurve(chroma, x)).toBeCloseTo(base.c, 6)
        }
      }
    }
  })

  it('reproduces the base colour as a hex at its chosen step', () => {
    for (const hex of HUES) {
      for (const index of realisticPositions(hex, 11)) {
        const base = parseToOklch(hex)!
        const lightness = lightnessCurveFor(base, 11, index)
        const chroma = chromaCurveFor(base, 11, index, lightness)
        const config = { ...createPalette(hex), baseIndex: index, lightness, chroma }
        expect(generateRamp(config).find((s) => s.isBase)!.hex).toBe(hex)
      }
    }
  })

  it('keeps lightness descending, which is the whole point of a ramp', () => {
    // Regression: solving the shape with a power law and clamping its exponent
    // left the curve asking for a value no monotonic cubic could deliver, and
    // the fit answered with step 600 lighter than step 500.
    for (const hex of HUES) {
      for (const steps of [5, 11, 21]) {
        for (const index of realisticPositions(hex, steps)) {
          const curve = lightnessCurveFor(parseToOklch(hex)!, steps, index)
          const last = steps - 1
          for (let i = 1; i <= last; i++) {
            const previous = sampleCurve(curve, (i - 1) / last)
            const value = sampleCurve(curve, i / last)
            expect(value).toBeLessThan(previous + 0.011)
          }
        }
      }
    }
  })

  it('redistributes lightness rather than nudging one step', () => {
    // Moving a light colour later in the ramp has to compress the tints; that
    // is what makes the request possible at all.
    const base = parseToOklch('#facc15')!
    const early = lightnessCurveFor(base, 11, 1)
    const late = lightnessCurveFor(base, 11, 5)
    // At the second step the late-placed ramp must still be far lighter.
    expect(sampleCurve(late, 0.2)).toBeGreaterThan(sampleCurve(early, 0.2) + 0.1)
    // Both still start light and end dark.
    for (const curve of [early, late]) {
      expect(sampleCurve(curve, 0)).toBeGreaterThan(0.9)
      expect(sampleCurve(curve, 1)).toBeLessThan(0.2)
    }
  })

  it('reports squeezed ramps instead of hiding them', () => {
    // A near-white base pinned late leaves no room; the tool must say so.
    const base = parseToOklch('#fff5d6')!
    const lightness = lightnessCurveFor(base, 11, 9)
    const chroma = chromaCurveFor(base, 11, 9, lightness)
    const ramp = generateRamp({
      ...createPalette('#fff5d6'),
      baseIndex: 9,
      lightness,
      chroma,
    })
    expect(countDuplicateSteps(ramp)).toBeGreaterThan(0)

    // And a sane placement must not trip the warning.
    expect(countDuplicateSteps(generateRamp(createPalette('#7c3aed')))).toBe(0)
  })
})

describe('holdBase', () => {
  const base = parseToOklch('#7c3aed')!

  it('pins lightness back to the base after an edit that moved it', () => {
    const wrecked = linear(0.5, 0.5)
    const held = holdBase(wrecked, 'lightness', base, 11, 5)
    expect(sampleCurve(held, 0.5)).toBeCloseTo(base.l, 9)
  })

  it('pins chroma back to the base after an edit that moved it', () => {
    const held = holdBase(flat(0), 'chroma', base, 11, 5)
    expect(sampleCurve(held, 0.5)).toBeCloseTo(base.c, 9)
  })

  it('pins hue shift to zero at the base step, whatever torsion is applied', () => {
    // Hue is a delta, so the base's own step must not be shifted at all —
    // otherwise dragging the hue curve silently recolours the base.
    const torsion = { start: -40, end: 60, h1: { x: 0.3, y: -70 }, h2: { x: 0.7, y: 80 } }
    const held = holdBase(torsion, 'hue', base, 11, 5)
    expect(sampleCurve(held, 0.5)).toBeCloseTo(0, 9)
    // The torsion elsewhere survives — a lock is not a reset.
    expect(Math.abs(sampleCurve(held, 0)) + Math.abs(sampleCurve(held, 1))).toBeGreaterThan(5)
  })

  it('holds the base at every step position', () => {
    for (const steps of [5, 11, 21]) {
      for (let index = 0; index < steps; index++) {
        const held = holdBase(linear(0.8, 0.8), 'lightness', base, steps, index)
        expect(sampleCurve(held, baseX(steps, index))).toBeCloseTo(base.l, 9)
      }
    }
  })

  it('leaves the control being dragged where the designer put it', () => {
    // Otherwise the correction pushes the very handle under the pointer and
    // the drag feels like it is fighting back.
    const dragged = { start: 0.97, end: 0.16, h1: { x: 0.4, y: 0.35 }, h2: { x: 0.7, y: 0.3 } }
    const held = holdBase(dragged, 'lightness', base, 11, 5, 'h1')
    expect(held.h1.y).toBeCloseTo(dragged.h1.y, 9)
    expect(held.h1.x).toBeCloseTo(dragged.h1.x, 9)
    expect(sampleCurve(held, 0.5)).toBeCloseTo(base.l, 9)
  })

  it('never leaves the channel range', () => {
    for (const key of ['lightness', 'chroma', 'hue'] as const) {
      const channel = CHANNELS[key]
      for (const index of [0, 3, 5, 10]) {
        const held = holdBase(linear(channel.max, channel.min), key, base, 11, index)
        for (const y of [held.start, held.h1.y, held.h2.y, held.end]) {
          expect(y).toBeGreaterThanOrEqual(channel.min - 1e-9)
          expect(y).toBeLessThanOrEqual(channel.max + 1e-9)
        }
      }
    }
  })
})
