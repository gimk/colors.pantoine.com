import { describe, expect, it } from 'vitest'
import { HARMONIES } from './harmony'
import { GAMUTS, isInGamut, normalizeHue, parseToOklch, type Gamut } from './oklch'
import {
  AUTO_RULE,
  DEFAULT_SLOTS,
  generateScheme,
  hueSequence,
  MAX_SLOTS,
  MIN_SLOTS,
  PROFILES,
  profileFor,
  RANDOM,
  type ProfileId,
  type ProfileSetting,
  type RuleId,
  type Slot,
} from './scheme'
import { mulberry32 } from '../state/random'

const slotsOf = (count: number, locked: number[] = []): Slot[] =>
  Array.from({ length: count }, (_unused, index) => ({
    id: `s${index}`,
    color: { l: 0.6, c: 0.1, h: 30 * index },
    locked: locked.includes(index),
  }))

const gamuts = GAMUTS.map((option) => option.id)
const profileIds = PROFILES.map((profile) => profile.id)

describe('hue sequence', () => {
  const noJitter = () => 0.5

  it('leads with the anchor’s own hue', () => {
    for (const harmony of HARMONIES) {
      const [first] = hueSequence(200, harmony.offsets, 5, noJitter)
      expect(first).toBeCloseTo(200, 6)
    }
  })

  it('follows the rule’s offsets while it has them', () => {
    const harmony = HARMONIES.find((entry) => entry.id === 'triad')!
    const hues = hueSequence(10, harmony.offsets, 3, noJitter)
    expect(hues[1]).toBeCloseTo(normalizeHue(10 + 120), 6)
    expect(hues[2]).toBeCloseTo(normalizeHue(10 + 240), 6)
  })

  it('returns exactly the count asked for, at every size', () => {
    for (const harmony of HARMONIES) {
      for (let count = MIN_SLOTS; count <= MAX_SLOTS; count += 1) {
        expect(hueSequence(0, harmony.offsets, count, noJitter)).toHaveLength(count)
      }
    }
  })

  it('never repeats a hue, however far past the rule it has to run', () => {
    // Complementary is the hard case: two hues in the list and up to eight
    // slots to fill, so it laps four times.
    for (const harmony of HARMONIES) {
      for (let count = MIN_SLOTS; count <= MAX_SLOTS; count += 1) {
        const hues = hueSequence(137, harmony.offsets, count, noJitter)
        for (let a = 0; a < hues.length; a += 1) {
          for (let b = a + 1; b < hues.length; b += 1) {
            const apart = Math.abs(normalizeHue(hues[a] - hues[b] + 180) - 180)
            expect(apart).toBeGreaterThan(5)
          }
        }
      }
    }
  })

  it('keeps every hue on the circle', () => {
    const rng = mulberry32(3)
    for (const harmony of HARMONIES) {
      for (const hue of hueSequence(350, harmony.offsets, MAX_SLOTS, rng, 12)) {
        expect(hue).toBeGreaterThanOrEqual(0)
        expect(hue).toBeLessThan(360)
      }
    }
  })
})

describe('profiles', () => {
  it('names every profile once', () => {
    expect(new Set(profileIds).size).toBe(PROFILES.length)
    expect(new Set(PROFILES.map((profile) => profile.label)).size).toBe(PROFILES.length)
  })

  it('falls back rather than returning nothing for an unknown id', () => {
    expect(profileFor('nonsense' as ProfileId)).toBe(PROFILES[0])
  })

  it('gives each profile a lightness spread of its own', () => {
    // The whole reason the profile exists: if two of them produced the same
    // weights, one of them would be a lie in the toolbar.
    const spreads = PROFILES.map((profile) => {
      const { slots } = generateScheme(
        slotsOf(DEFAULT_SLOTS),
        'triad',
        profile.id,
        'srgb',
        mulberry32(9),
      )
      return slots.map((slot) => Math.round(slot.color.l * 100)).join(',')
    })
    expect(new Set(spreads).size).toBe(PROFILES.length)
  })

  it('spreads weight in the profiles that promise range, and holds it in the ones that do not', () => {
    const rangeOf = (id: ProfileId) => {
      const { slots } = generateScheme(
        slotsOf(DEFAULT_SLOTS),
        'triad',
        id,
        'srgb',
        mulberry32(4),
      )
      const ls = slots.map((slot) => slot.color.l)
      return Math.max(...ls) - Math.min(...ls)
    }
    expect(rangeOf('even')).toBeGreaterThan(0.5)
    expect(rangeOf('vivid')).toBeLessThan(0.35)
    expect(rangeOf('pastel')).toBeLessThan(0.25)
  })

  it('keeps pastel light and muted well off the gamut edge', () => {
    const pastel = generateScheme(slotsOf(6), 'analogous', 'pastel', 'srgb', mulberry32(11))
    for (const slot of pastel.slots) expect(slot.color.l).toBeGreaterThan(0.78)

    const muted = generateScheme(slotsOf(6), 'analogous', 'muted', 'srgb', mulberry32(11))
    const vivid = generateScheme(slotsOf(6), 'analogous', 'vivid', 'srgb', mulberry32(11))
    const mean = (slots: Slot[]) =>
      slots.reduce((sum, slot) => sum + slot.color.c, 0) / slots.length
    expect(mean(muted.slots)).toBeLessThan(mean(vivid.slots))
  })
})

describe('generateScheme', () => {
  it('is reproducible from a seed', () => {
    const a = generateScheme(slotsOf(5), AUTO_RULE, 'even', 'p3', mulberry32(42))
    const b = generateScheme(slotsOf(5), AUTO_RULE, 'even', 'p3', mulberry32(42))
    expect(a).toEqual(b)
  })

  it('gives different schemes for different seeds', () => {
    const a = generateScheme(slotsOf(5), 'triad', 'even', 'srgb', mulberry32(1))
    const b = generateScheme(slotsOf(5), 'triad', 'even', 'srgb', mulberry32(2))
    expect(a.slots).not.toEqual(b.slots)
  })

  it('hands back one slot per slot it was given, ids and locks intact', () => {
    for (let count = MIN_SLOTS; count <= MAX_SLOTS; count += 1) {
      const before = slotsOf(count, [1])
      const { slots } = generateScheme(before, 'square', 'even', 'srgb', mulberry32(count))
      expect(slots).toHaveLength(count)
      slots.forEach((slot, index) => {
        expect(slot.id).toBe(before[index].id)
        expect(slot.locked).toBe(before[index].locked)
      })
    }
  })

  it('leaves every locked slot byte-identical', () => {
    const before = slotsOf(6, [0, 3, 5])
    const { slots } = generateScheme(before, 'compound', 'vivid', 'rec2020', mulberry32(8))
    for (const index of [0, 3, 5]) expect(slots[index]).toBe(before[index])
  })

  it('changes every unlocked slot', () => {
    const before = slotsOf(6, [2])
    const { slots } = generateScheme(before, 'split', 'even', 'srgb', mulberry32(5))
    for (const index of [0, 1, 3, 4, 5]) {
      expect(slots[index].color).not.toEqual(before[index].color)
    }
  })

  it('produces colours the target gamut can actually show', () => {
    // The cap-at-the-ceiling rule, checked rather than asserted: nothing here
    // should ever need a clipped marker.
    for (const gamut of gamuts as Gamut[]) {
      if (gamut === 'oklab') continue
      for (const profile of profileIds) {
        for (const harmony of HARMONIES) {
          const { slots } = generateScheme(
            slotsOf(MAX_SLOTS),
            harmony.id,
            profile,
            gamut,
            mulberry32(17),
          )
          for (const slot of slots) {
            expect(isInGamut(slot.color, gamut)).toBe(true)
          }
        }
      }
    }
  })

  it('takes its hues from the locked slot rather than rolling a new anchor', () => {
    const seed = parseToOklch('#e11d48')!
    const before: Slot[] = [
      { id: 'a', color: seed, locked: true },
      { id: 'b', color: { l: 0.5, c: 0.1, h: 0 }, locked: false },
    ]
    const { slots } = generateScheme(before, 'complementary', 'vivid', 'srgb', mulberry32(6))
    const apart = Math.abs(normalizeHue(slots[1].color.h - seed.h + 180) - 180)
    // Within the profile's hue jitter of the exact complement.
    expect(Math.abs(apart - 180)).toBeLessThanOrEqual(profileFor('vivid').jitter.h + 1e-6)
  })

  it('ignores a locked grey as an anchor, since it has no hue to rotate', () => {
    const grey: Slot = { id: 'g', color: { l: 0.5, c: 0, h: 0 }, locked: true }
    const before: Slot[] = [grey, ...slotsOf(3).slice(1)]
    const { slots } = generateScheme(before, 'triad', 'even', 'srgb', mulberry32(2))
    expect(slots[0]).toBe(grey)
    // The rolled anchor drives the rest, so they are not all sitting on hue 0.
    const hues = slots.slice(1).map((slot) => Math.round(slot.color.h))
    expect(new Set(hues).size).toBe(hues.length)
  })

  it('resolves auto to a real rule, and says which', () => {
    const rolled = new Set<string>()
    for (let seed = 0; seed < 60; seed += 1) {
      const { rule } = generateScheme(slotsOf(4), AUTO_RULE, 'even', 'srgb', mulberry32(seed))
      expect(HARMONIES.some((harmony) => harmony.id === rule)).toBe(true)
      rolled.add(rule!)
    }
    // Not pinned to every rule — that would be a test of the PRNG — but a roll
    // that only ever landed on one would not be a roll.
    expect(rolled.size).toBeGreaterThan(1)
  })

  it('reports the rule it was given, when it was given one', () => {
    for (const harmony of HARMONIES) {
      const { rule } = generateScheme(slotsOf(3), harmony.id, 'even', 'srgb', mulberry32(1))
      expect(rule).toBe(harmony.id)
    }
  })

  it('holds the anchor’s own lightness only in the profile that promises to', () => {
    const seed = parseToOklch('#7c3aed')!
    const before: Slot[] = [
      { id: 'a', color: seed, locked: true },
      ...slotsOf(4).slice(1),
    ]
    // The anchor is locked, so it is untouched either way; what differs is the
    // slot that would have taken its place in the spread. Anchored puts the
    // dominant weight on the anchor's position, so slot 0's neighbours arrange
    // around it rather than starting from the top of the range.
    const anchored = generateScheme(before, 'triad', 'anchored', 'srgb', mulberry32(3))
    const even = generateScheme(before, 'triad', 'even', 'srgb', mulberry32(3))
    expect(anchored.slots[0].color).toBe(seed)
    expect(even.slots[0].color).toBe(seed)
    expect(anchored.slots.map((s) => s.color.l)).not.toEqual(even.slots.map((s) => s.color.l))
  })

  it('survives being asked for a scheme of one, and of none', () => {
    expect(generateScheme([], 'triad', 'even', 'srgb', mulberry32(1)).slots).toEqual([])
    const one = generateScheme(slotsOf(1), 'triad', 'even', 'srgb', mulberry32(1))
    expect(one.slots).toHaveLength(1)
    expect(one.slots[0].color.l).toBeGreaterThan(0)
  })

  it('never leaves a slot outside the lightness bounds', () => {
    for (const profile of profileIds) {
      const { slots } = generateScheme(
        slotsOf(MAX_SLOTS),
        AUTO_RULE,
        profile,
        'srgb',
        mulberry32(23),
      )
      for (const slot of slots) {
        expect(slot.color.l).toBeGreaterThan(0)
        expect(slot.color.l).toBeLessThan(1)
        expect(slot.color.c).toBeGreaterThanOrEqual(0)
      }
    }
  })
})


/**
 * `auto` rolls a rule and then follows it, so a scheme it makes can still say
 * why its colours go together. `random` is the setting that means there was
 * no reason — the escape hatch from a tool whose whole argument is structure.
 */
describe('rolling instead of ruling', () => {
  it('reports no rule at all, where auto reports the one it rolled', () => {
    for (let seed = 0; seed < 10; seed += 1) {
      expect(generateScheme(slotsOf(5), RANDOM, 'even', 'srgb', mulberry32(seed)).rule).toBeNull()
    }
  })

  it('puts the hues anywhere, where a rule puts them in one place', () => {
    // A rule rotates fixed offsets off the anchor, so the gap between the
    // first two slots is the same every roll bar the jitter. No rule makes
    // that gap a roll of its own, and thirty of them land all round the wheel.
    const gaps = (rule: RuleId) =>
      new Set(
        Array.from({ length: 30 }, (_unused, seed) => {
          const { slots } = generateScheme(slotsOf(5), rule, 'even', 'srgb', mulberry32(seed))
          return Math.round(normalizeHue(slots[1].color.h - slots[0].color.h) / 30)
        }),
      )
    expect(gaps('triad').size).toBeLessThanOrEqual(2)
    expect(gaps(RANDOM).size).toBeGreaterThan(6)
  })

  it('gives every slot its own weight, where a profile gives them a spread', () => {
    // `even` runs light to dark across the row, so its first slot is the
    // lightest every single time. A rolled weight answers to nothing, so the
    // first slot is the lightest about as often as any other is.
    const lightestFirst = (profile: ProfileSetting) =>
      Array.from({ length: 30 }, (_unused, seed) => {
        const { slots } = generateScheme(slotsOf(5), 'triad', profile, 'srgb', mulberry32(seed))
        return slots[0].color.l === Math.max(...slots.map((slot) => slot.color.l))
      }).filter(Boolean).length

    expect(lightestFirst('even')).toBe(30)
    expect(lightestFirst(RANDOM)).toBeLessThan(20)
  })

  it('rolls a weight inside the range the named profiles cover', () => {
    // Free of a spread, not free of the bounds: the roll can land anywhere any
    // profile reaches, and nowhere none of them do.
    for (let seed = 0; seed < 20; seed += 1) {
      const { slots } = generateScheme(slotsOf(6), 'triad', RANDOM, 'srgb', mulberry32(seed))
      for (const slot of slots) {
        expect(slot.color.l).toBeGreaterThanOrEqual(0.22)
        expect(slot.color.l).toBeLessThanOrEqual(0.92)
      }
    }
  })

  it('stays inside the gamut with neither a rule nor a profile', () => {
    // Chroma is a share of the ceiling at the slot's own lightness and hue
    // however the two were arrived at, so the promise holds here too.
    for (const gamut of gamuts) {
      const { slots } = generateScheme(slotsOf(MAX_SLOTS), RANDOM, RANDOM, gamut, mulberry32(4))
      for (const slot of slots) expect(isInGamut(slot.color, gamut)).toBe(true)
    }
  })

  it('still holds a locked colour, and still repeats for a seed', () => {
    const before = slotsOf(4, [1])
    const a = generateScheme(before, RANDOM, RANDOM, 'srgb', mulberry32(9))
    const b = generateScheme(before, RANDOM, RANDOM, 'srgb', mulberry32(9))
    expect(a.slots[1]).toBe(before[1])
    expect(a.slots).toEqual(b.slots)
  })
})
