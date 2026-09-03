import { describe, expect, it } from 'vitest'
import { maxChromaFor } from './gamut'
import { harmonyCandidates, hasUsableHue, HARMONIES } from './harmony'
import { isInGamut, normalizeHue, parseToOklch, toHex, type Gamut } from './oklch'

const seedOf = (input: string) => parseToOklch(input)!
const byId = (id: string) => HARMONIES.find((harmony) => harmony.id === id)!

describe('harmony rules', () => {
  it('never offers the seed back as a candidate', () => {
    for (const harmony of HARMONIES) {
      expect(harmony.offsets).not.toContain(0)
      expect(harmony.offsets.length).toBeGreaterThan(0)
    }
  })

  it('has no repeated hue inside a rule', () => {
    for (const harmony of HARMONIES) {
      const hues = harmony.offsets.map((offset) => normalizeHue(offset))
      expect(new Set(hues).size).toBe(hues.length)
    }
  })

  it('names every rule once', () => {
    expect(new Set(HARMONIES.map((harmony) => harmony.id)).size).toBe(HARMONIES.length)
    expect(new Set(HARMONIES.map((harmony) => harmony.label)).size).toBe(HARMONIES.length)
  })

  it('puts each candidate at its rule’s offset from the seed', () => {
    const seed = seedOf('#7c3aed')
    for (const harmony of HARMONIES) {
      const candidates = harmonyCandidates(seed, harmony)
      expect(candidates).toHaveLength(harmony.offsets.length)
      candidates.forEach((candidate, index) => {
        expect(candidate.h).toBeCloseTo(normalizeHue(seed.h + harmony.offsets[index]), 6)
      })
    }
  })

  it('complements land opposite, whatever the seed', () => {
    for (const input of ['#7c3aed', '#e11d48', '#ffcc00', '#0044ff', '#00ff66']) {
      const seed = seedOf(input)
      const [complement] = harmonyCandidates(seed, byId('complementary'))
      const apart = Math.abs(normalizeHue(complement.h - seed.h))
      expect(apart).toBeCloseTo(180, 6)
    }
  })
})

describe('harmony candidates', () => {
  const gamuts: Gamut[] = ['srgb', 'p3', 'rec2020']

  it('holds the seed’s lightness exactly, in every rule', () => {
    const seed = seedOf('#0044ff')
    for (const harmony of HARMONIES) {
      for (const candidate of harmonyCandidates(seed, harmony, 'p3')) {
        expect(candidate.l).toBe(seed.l)
      }
    }
  })

  it('is inside the target gamut by construction', () => {
    // Rotating hue at constant chroma leaves the gamut at almost every angle,
    // so this is the invariant the whole capping rule exists to hold.
    for (const gamut of gamuts) {
      for (const input of ['#7c3aed', '#ffcc00', '#00ff66', '#e11d48']) {
        const seed = seedOf(input)
        for (const harmony of HARMONIES) {
          for (const candidate of harmonyCandidates(seed, harmony, gamut)) {
            expect(isInGamut(candidate, gamut)).toBe(true)
          }
        }
      }
    }
  })

  it('never asks for more chroma than the seed had', () => {
    const seed = seedOf('#7c3aed')
    for (const harmony of HARMONIES) {
      for (const candidate of harmonyCandidates(seed, harmony, 'rec2020')) {
        expect(candidate.c).toBeLessThanOrEqual(seed.c + 1e-9)
      }
    }
  })

  it('gives a vivid seed the most chroma each hue can hold', () => {
    // A vivid seed sits at its own ceiling, so capping is not a loss: every
    // candidate comes back as saturated as its hue permits.
    const seed = seedOf('#0044ff')
    for (const candidate of harmonyCandidates(seed, byId('square'))) {
      expect(candidate.c).toBeCloseTo(
        Math.min(seed.c, maxChromaFor(seed.l, candidate.h, 'srgb')),
        6,
      )
    }
  })

  it('keeps a pastel seed pastel', () => {
    // The regression that decided the capping rule. Holding chroma as a
    // *share* of the ceiling — the trick the default chroma curve uses — turns
    // this powder pink's analogous green into #45ef2c, a screaming lime.
    const seed = seedOf('#f0abfc')
    for (const candidate of harmonyCandidates(seed, byId('analogous'))) {
      expect(candidate.c).toBeLessThanOrEqual(seed.c + 1e-9)
    }
    const greens = harmonyCandidates(seed, byId('analogous')).map((c) => toHex(c))
    expect(greens.every((hex) => hex !== '#45ef2c')).toBe(true)
  })

  it('opens up when the gamut widens', () => {
    const seed = seedOf('#00ff66')
    const [srgb] = harmonyCandidates(seed, byId('complementary'), 'srgb')
    const [wide] = harmonyCandidates(seed, byId('complementary'), 'rec2020')
    expect(wide.c).toBeGreaterThan(srgb.c)
    expect(wide.h).toBeCloseTo(srgb.h, 6)
  })

  it('wraps hue into 0–360', () => {
    const seed = seedOf('#e11d48')
    for (const harmony of HARMONIES) {
      for (const candidate of harmonyCandidates(seed, harmony)) {
        expect(candidate.h).toBeGreaterThanOrEqual(0)
        expect(candidate.h).toBeLessThan(360)
      }
    }
  })
})

describe('seeds with no hue', () => {
  it('reports a grey as unusable', () => {
    expect(hasUsableHue(seedOf('#808080'))).toBe(false)
    expect(hasUsableHue(seedOf('#ffffff'))).toBe(false)
    expect(hasUsableHue(seedOf('#000000'))).toBe(false)
  })

  it('accepts anything with visible chroma', () => {
    expect(hasUsableHue(seedOf('#7c3aed'))).toBe(true)
    expect(hasUsableHue(seedOf('#64748b'))).toBe(true)
  })

  it('is why a grey is refused: every rule returns the same colour', () => {
    const grey = seedOf('#808080')
    const hexes = HARMONIES.flatMap((harmony) => harmonyCandidates(grey, harmony)).map(toHex)
    expect(new Set(hexes).size).toBe(1)
  })
})

describe('rule names', () => {
  it('gives every rule a slug fit for a palette name', () => {
    for (const harmony of HARMONIES) {
      // Lands beside hand-typed names like "brand", so no camelCase.
      expect(harmony.slug).toMatch(/^[a-z]+( [a-z]+)*$/)
    }
    expect(new Set(HARMONIES.map((harmony) => harmony.slug)).size).toBe(HARMONIES.length)
  })
})
