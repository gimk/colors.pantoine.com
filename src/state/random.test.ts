import { describe, expect, it } from 'vitest'
import { mulberry32, rollSeed } from './random'

describe('mulberry32', () => {
  it('is reproducible from a seed', () => {
    const a = mulberry32(1)
    const b = mulberry32(1)
    for (let n = 0; n < 20; n += 1) expect(a()).toBe(b())
  })

  it('stays inside [0, 1)', () => {
    const rng = mulberry32(12345)
    for (let n = 0; n < 500; n += 1) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('does not immediately repeat itself', () => {
    const rng = mulberry32(7)
    const rolls = Array.from({ length: 50 }, () => rng())
    expect(new Set(rolls).size).toBe(rolls.length)
  })
})

describe('rollSeed', () => {
  it('rolls a 32-bit unsigned integer', () => {
    for (let n = 0; n < 200; n += 1) {
      const seed = rollSeed()
      expect(Number.isInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThan(2 ** 32)
    }
  })

  it('rolls something the PRNG can actually use', () => {
    // A seed that arrived as a float, or negative, would be silently coerced
    // and two different seeds could land on the same stream.
    const seeds = Array.from({ length: 200 }, () => rollSeed())
    expect(new Set(seeds).size).toBeGreaterThan(190)
  })
})
