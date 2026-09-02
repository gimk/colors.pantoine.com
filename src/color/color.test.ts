import { describe, expect, it } from 'vitest'
import { basisAtX, bezierYAtX, solveTForX } from './bezier'
import { arc, bendThrough, linear, sampleCurve, CHANNELS } from './curve'
import { isInSrgb, parseToOklch, toHex } from './oklch'
import { createPalette } from './presets'
import { generateRamp, stepLabels } from './ramp'

describe('bezier', () => {
  it('inverts x(t) for a curve whose handles are evenly spaced', () => {
    // Handles at 1/3 and 2/3 make x(t) = t exactly.
    for (const x of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(solveTForX(1 / 3, 2 / 3, x)).toBeCloseTo(x, 6)
    }
  })

  it('inverts x(t) for skewed handles', () => {
    // Round-trip: whatever t we solve for must reproduce the x we asked for.
    const h1x = 0.05
    const h2x = 0.95
    const xOf = (t: number) =>
      3 * (1 - t) ** 2 * t * h1x + 3 * (1 - t) * t ** 2 * h2x + t ** 3
    for (const x of [0.05, 0.2, 0.5, 0.8, 0.95]) {
      expect(xOf(solveTForX(h1x, h2x, x))).toBeCloseTo(x, 5)
    }
  })

  it('reproduces a straight line', () => {
    const curve = linear(0.9, 0.1)
    for (const x of [0, 0.25, 0.5, 0.75, 1]) {
      expect(sampleCurve(curve, x)).toBeCloseTo(0.9 - 0.8 * x, 6)
    }
  })

  it('honours both anchors exactly', () => {
    const curve = { start: 0.2, end: 0.8, h1: { x: 0.1, y: 0.7 }, h2: { x: 0.4, y: -0.3 } }
    expect(bezierYAtX(curve.start, curve.h1, curve.h2, curve.end, 0)).toBeCloseTo(0.2, 9)
    expect(bezierYAtX(curve.start, curve.h1, curve.h2, curve.end, 1)).toBeCloseTo(0.8, 9)
  })

  it('has a Bernstein basis that sums to one', () => {
    for (const x of [0, 0.3, 0.5, 0.99]) {
      const sum = basisAtX(0.2, 0.8, x).reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1, 9)
    }
  })
})

describe('curve shaping', () => {
  it('builds an arc that peaks at the requested midpoint', () => {
    const curve = arc(0.05, 0.12, 0.3)
    expect(sampleCurve(curve, 0.5)).toBeCloseTo(0.3, 9)
    expect(sampleCurve(curve, 0)).toBeCloseTo(0.05, 9)
    expect(sampleCurve(curve, 1)).toBeCloseTo(0.12, 9)
  })

  it('bends through a nearby point using the handles alone', () => {
    const base = linear(0.97, 0.16)
    for (const x of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      // A modest correction, which is all the presets ever ask for: the base
      // step is picked as the one already closest to the base lightness.
      const target = sampleCurve(base, x) + 0.03
      const bent = bendThrough(base, x, target, 0, 1)
      expect(sampleCurve(bent, x)).toBeCloseTo(target, 9)
      expect(bent.start).toBeCloseTo(0.97, 9)
      expect(bent.end).toBeCloseTo(0.16, 9)
    }
  })

  it('still hits the target when the handles run out of headroom', () => {
    // 0.42 at x = 0.1 on a 0.97 → 0.16 ramp is a near-vertical drop. The
    // handles cannot do it without leaving [0, 1], so they saturate and the
    // anchors take up the slack — the target is still met exactly.
    const bent = bendThrough(linear(0.97, 0.16), 0.1, 0.42, 0, 1)
    expect(sampleCurve(bent, 0.1)).toBeCloseTo(0.42, 9)
    expect(bent.h1.y).toBeCloseTo(0, 9)
    expect(bent.start).toBeLessThan(0.97)
  })

  it('never leaves the channel range, however hard it is pushed', () => {
    for (const target of [-5, 0, 0.5, 1, 5]) {
      for (const x of [0.02, 0.5, 0.98]) {
        const bent = bendThrough(linear(0.6, 0.4), x, target, 0, 1)
        for (const y of [bent.start, bent.h1.y, bent.h2.y, bent.end]) {
          expect(y).toBeGreaterThanOrEqual(-1e-9)
          expect(y).toBeLessThanOrEqual(1 + 1e-9)
        }
      }
    }
  })

  it('moves the anchor when the bend target sits on an endpoint', () => {
    expect(bendThrough(linear(0.9, 0.1), 0, 0.5, 0, 1).start).toBe(0.5)
    expect(bendThrough(linear(0.9, 0.1), 1, 0.5, 0, 1).end).toBe(0.5)
  })
})

describe('gamut mapping', () => {
  it('produces displayable colours from out-of-gamut requests', () => {
    const requested = { l: 0.6, c: 0.37, h: 150 }
    expect(isInSrgb(requested)).toBe(false)
    const back = parseToOklch(toHex(requested))!
    expect(isInSrgb(back)).toBe(true)
  })

  it('holds hue while reducing chroma', () => {
    for (const h of [20, 150, 265, 330]) {
      const back = parseToOklch(toHex({ l: 0.55, c: 0.37, h }))!
      expect(Math.abs(back.h - h)).toBeLessThan(0.5)
      expect(back.c).toBeLessThan(0.37)
    }
  })

  it('leaves in-gamut colours alone', () => {
    expect(toHex(parseToOklch('#7c3aed')!)).toBe('#7c3aed')
  })
})

describe('ramp', () => {
  it('returns the requested number of steps', () => {
    for (const steps of [5, 9, 11, 21]) {
      expect(generateRamp(createPalette('#7c3aed', steps))).toHaveLength(steps)
      expect(stepLabels(steps)).toHaveLength(steps)
    }
  })

  it('descends monotonically in lightness by default', () => {
    const ramp = generateRamp(createPalette('#7c3aed'))
    for (let i = 1; i < ramp.length; i++) {
      expect(ramp[i].oklch.l).toBeLessThan(ramp[i - 1].oklch.l)
    }
  })

  it('contains the base colour exactly at its own step', () => {
    for (const input of ['#7c3aed', '#1d4ed8', '#facc15', '#0f766e']) {
      const config = createPalette(input)
      const base = parseToOklch(input)!
      const swatch = generateRamp(config).find((s) => s.isBase)!
      expect(swatch.oklch.l).toBeCloseTo(base.l, 6)
      expect(swatch.oklch.c).toBeCloseTo(base.c, 6)
      expect(swatch.hex).toBe(input)
    }
  })

  it('keeps every sample inside its channel range', () => {
    const ramp = generateRamp(createPalette('#facc15'))
    for (const swatch of ramp) {
      expect(swatch.oklch.l).toBeGreaterThanOrEqual(CHANNELS.lightness.min)
      expect(swatch.oklch.l).toBeLessThanOrEqual(CHANNELS.lightness.max)
      expect(swatch.oklch.c).toBeGreaterThanOrEqual(0)
      expect(swatch.oklch.c).toBeLessThanOrEqual(CHANNELS.chroma.max)
      expect(swatch.oklch.h).toBeGreaterThanOrEqual(0)
      expect(swatch.oklch.h).toBeLessThan(360)
    }
  })

  // A spread of hues that reach different parts of the sRGB gamut: yellow and
  // green bulge, blue and purple are cramped at the light end.
  const HUES = ['#7c3aed', '#facc15', '#1d4ed8', '#dc2626', '#0f766e', '#059669',
    '#ec4899', '#f97316', '#64748b', '#84cc16', '#06b6d4', '#a855f7']

  it('never lets the dark end of a default ramp drift to grey', () => {
    // Regression: with the chroma curve's endpoints left free, least squares
    // would trade the darkest step's chroma away to fit the middle better,
    // ending a purple scale in flat #0d0d0d. The lightest step is exempt —
    // near white, sRGB genuinely has almost no chroma to give.
    for (const input of HUES) {
      const base = parseToOklch(input)!
      if (base.c < 0.1) continue
      const ramp = generateRamp(createPalette(input))
      // An absolute floor rather than a share of the base: a dark yellow sits
      // at 0.034 because that is every drop of chroma sRGB has at that
      // lightness, and a test that demanded a fifth of the base's 0.173 would
      // be asserting against the gamut rather than against the code.
      expect(ramp[ramp.length - 1].oklch.c).toBeGreaterThan(0.02)
      for (const swatch of ramp.slice(1)) {
        expect(swatch.oklch.c).toBeGreaterThan(0.01)
      }
    }
  })

  it('holds the requested hue across every step of every default ramp', () => {
    for (const input of HUES) {
      const base = parseToOklch(input)!
      for (const swatch of generateRamp(createPalette(input))) {
        expect(swatch.oklch.h).toBeCloseTo(base.h, 6)
        const rendered = parseToOklch(swatch.hex)!
        // Gamut mapping reduces chroma; it must not rotate hue. Checked only
        // where there is enough chroma to carry a hue: at c below ~0.08 a
        // single 8-bit quantisation step is worth several degrees, so the
        // measurement says more about the hex format than about the mapping.
        if (rendered.c > 0.08) {
          expect(Math.abs(rendered.h - base.h)).toBeLessThan(1)
        }
      }
    }
  })

  it('keeps default ramps close enough to sRGB to stay out of the mud', () => {
    // Regression: bending the fitted chroma curve through the base inflated
    // yellow's mid-ramp by a third and cost 0.07 chroma to gamut mapping,
    // turning the ramp olive. The base is a fit constraint now, not a bend.
    for (const input of HUES) {
      for (const swatch of generateRamp(createPalette(input))) {
        expect(swatch.chromaLost).toBeLessThan(0.04)
      }
    }
  })

  it('does not clip the two ends of a default ramp', () => {
    // The endpoints are pinned to a share of the gamut ceiling, so they are
    // in gamut by construction.
    for (const input of HUES) {
      const ramp = generateRamp(createPalette(input))
      for (const swatch of [ramp[0], ramp[ramp.length - 1]]) {
        expect(swatch.clipped).toBe(false)
      }
    }
  })

  it('collapses to a neutral grey scale when chroma is flattened', () => {
    const config = createPalette('#7c3aed')
    const ramp = generateRamp({ ...config, chroma: linear(0, 0) })
    for (const swatch of ramp) {
      expect(swatch.oklch.c).toBe(0)
      // A zero-chroma OKLCH colour must render as an equal-channel grey.
      expect(swatch.hex).toMatch(/^#([0-9a-f]{2})\1\1$/)
    }
  })
})
