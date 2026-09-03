import { describe, expect, it } from 'vitest'
import { splitPair, stepWeightsFor } from './useReview'
import { tracks } from '../export/image'

/**
 * The board promises to fit the window however it is arranged, and the whole
 * of that promise rests on one property: a resize only ever *redistributes*
 * weight between two neighbours. Nothing here can add any. So these are the
 * tests that the promise holds, not decoration around a slider.
 */
describe('splitPair', () => {
  it('leaves the pair alone when nothing has moved', () => {
    expect(splitPair(1, 1, 100, 100, 0)).toEqual([1, 1])
  })

  it('keeps the pair total exactly, whatever the drag', () => {
    for (const delta of [-500, -73, -1, 0, 1, 12, 480]) {
      const [a, b] = splitPair(1, 3, 60, 180, delta)
      expect(a + b).toBeCloseTo(4, 12)
      expect(a).toBeGreaterThan(0)
      expect(b).toBeGreaterThan(0)
    }
  })

  it('moves the boundary with the pointer, in proportion', () => {
    // Two even bands over 200px: dragging the boundary 50px gives the first
    // three quarters of the pair and the second one quarter.
    const [a, b] = splitPair(1, 1, 100, 100, 50)
    expect(a).toBeCloseTo(1.5, 12)
    expect(b).toBeCloseTo(0.5, 12)
  })

  /**
   * A band dragged to nothing cannot be dragged back — there is no longer
   * anything of it to grab. So the floor is not a nicety, it is what keeps
   * the arrangement reversible.
   */
  it('will not squeeze a band out of existence', () => {
    const [a, b] = splitPair(1, 1, 100, 100, -1000)
    expect(a).toBeGreaterThan(0)
    expect(a / (a + b)).toBeCloseTo(10 / 200, 6)
  })

  it('meets in the middle when the pair is smaller than two floors', () => {
    const [a, b] = splitPair(1, 1, 6, 6, -1000)
    expect(a).toBeCloseTo(b, 12)
  })

  it('declines to divide nothing', () => {
    expect(splitPair(1, 1, 0, 0, 40)).toEqual([1, 1])
    expect(splitPair(0, 0, 100, 100, 40)).toEqual([0, 0])
  })
})

/**
 * Step count is global, so changing it makes any stored set of shares
 * meaningless: nine shares say nothing about a ramp of fifteen. Reconciled on
 * read rather than kept in step with the document — nothing to subscribe to
 * is nothing to get out of sync.
 */
describe('stepWeightsFor', () => {
  it('hands back a stored set of the right length', () => {
    expect(stepWeightsFor([1, 2, 1], 3)).toEqual([1, 2, 1])
  })

  it('falls back to an even split when the step count has moved', () => {
    expect(stepWeightsFor([1, 2, 1], 5)).toEqual([1, 1, 1, 1, 1])
    expect(stepWeightsFor([], 2)).toEqual([1, 1])
  })
})

/**
 * The same arithmetic as the grid, in pixels. `fr` tracks are fractional and
 * a canvas rectangle is not, so the rounding is the whole problem: a track
 * rounded on its own leaves a 1px seam of background between two steps, and
 * a pipette landing on a seam picks the seam.
 */
describe('tracks', () => {
  it('fills the total exactly, with no seam and no overlap', () => {
    const laid = tracks([1, 1, 1, 1, 1, 1, 1], 1000, 0)
    expect(laid[0].start).toBe(0)
    laid.forEach((track, index) => {
      if (index === 0) return
      expect(track.start).toBe(laid[index - 1].start + laid[index - 1].size)
    })
    const last = laid[laid.length - 1]
    expect(last.start + last.size).toBe(1000)
  })

  it('holds to integers even on weights that do not divide', () => {
    const laid = tracks([1, 1, 1], 1000, 0)
    for (const track of laid) expect(Number.isInteger(track.size)).toBe(true)
    expect(laid.reduce((sum, track) => sum + track.size, 0)).toBe(1000)
  })

  it('takes the gaps off the top and leaves them between the tracks', () => {
    const laid = tracks([1, 1, 1], 320, 10)
    expect(laid.reduce((sum, track) => sum + track.size, 0)).toBe(300)
    expect(laid[1].start - (laid[0].start + laid[0].size)).toBe(10)
    expect(laid[2].start + laid[2].size).toBe(320)
  })

  it('gives a heavier weight proportionally more room', () => {
    const laid = tracks([3, 1], 400, 0)
    expect(laid[0].size).toBe(300)
    expect(laid[1].size).toBe(100)
  })

  it('lays out nothing for weights that sum to nothing', () => {
    expect(tracks([], 100, 0)).toEqual([])
    expect(tracks([0, 0], 100, 0)).toEqual([])
  })
})
