import { useCallback, useEffect, useState } from 'react'
import { clamp } from '../color/curve'

/**
 * How the review board is laid out.
 *
 * A view preference, not part of the document: it says how you are looking at
 * the palettes, not what you made. So it lives in its own storage key and
 * never travels in a share link — someone opening your link gets your
 * colours, and looks at them however they were already looking.
 *
 * Sizes are held as *weights*, never pixels. A weight is a share of whatever
 * room there is, which is what lets the board promise to fit the window: the
 * grid tracks are `fr` units, and `fr` cannot overflow its container. Resizing
 * moves share between two neighbours rather than adding size, so the total is
 * invariant and the fit holds without a single clamp against the viewport.
 */
export type ReviewAxis = 'rows' | 'columns'

export type ReviewLayout = {
  /** `rows`: each palette a horizontal band, bands stacked down the window. */
  axis: ReviewAxis
  /** Space between palettes, in pixels. Never between steps of one ramp. */
  gap: number
  /** Share of the stacking axis per palette, by id. Missing means 1. */
  paletteWeights: Record<string, number>
  /** Share of the ramp axis per step, shared by every palette so they align. */
  stepWeights: number[]
  /**
   * Print the palette names, and each step's value on its chip.
   *
   * One switch for both, because they answer the same question — *which
   * colour is this* — and a board that named its palettes but not its steps
   * would be halfway to the editor's label grid without being useful. What
   * the value reads as follows the document's format, so the chip shows
   * exactly what clicking it copies.
   *
   * On by default: the names are also the visible grip for reordering, so a
   * board that opened bare would open with its arranging hidden.
   */
  labels: boolean
}

export type ReviewApi = {
  layout: ReviewLayout
  /** The step weights, as an array of exactly `steps` entries. */
  steps: number[]
  setAxis: (axis: ReviewAxis) => void
  setGap: (gap: number) => void
  setLabels: (labels: boolean) => void
  /** Weight of one palette, defaulted — every read goes through here. */
  weightOf: (id: string) => number
  /**
   * Move share between two adjacent palettes. `sizeA`/`sizeB` are their pixel
   * sizes measured when the drag began and `delta` the distance travelled
   * since, so every move event recomputes from the same snapshot instead of
   * accumulating rounding error.
   */
  resizePalettes: (idA: string, idB: string, sizeA: number, sizeB: number, delta: number) => void
  /** The same, between two adjacent steps — applied to every palette at once. */
  resizeSteps: (indexA: number, indexB: number, sizeA: number, sizeB: number, delta: number) => void
  reset: () => void
}

const KEY = 'colors.pantoine.com/review/v1'

export const DEFAULT_GAP = 12
export const MAX_GAP = 64

/**
 * A band can be squeezed to this many pixels and no further.
 *
 * Without a floor the splitter hands a neighbour every last pixel and the
 * band it came from becomes unclickable — there is then nothing left to grab
 * to give it its share back.
 */
const MIN_BAND = 10

const DEFAULTS: ReviewLayout = {
  axis: 'rows',
  gap: DEFAULT_GAP,
  paletteWeights: {},
  stepWeights: [],
  labels: true,
}

/**
 * Weights for a pair of neighbours after a drag of `delta` pixels.
 *
 * Pure, and the whole of the resize behaviour. The pair's total weight comes
 * out unchanged, which is why the board cannot be dragged out of the window:
 * the only thing a drag can do is redistribute a fixed total.
 */
export function splitPair(
  weightA: number,
  weightB: number,
  sizeA: number,
  sizeB: number,
  delta: number,
): [number, number] {
  const totalWeight = weightA + weightB
  const totalSize = sizeA + sizeB
  if (!(totalSize > 0) || !(totalWeight > 0)) return [weightA, weightB]

  // On a board too small to hold two minimum bands, meet in the middle
  // rather than letting the floor exceed the room and invert the clamp.
  const floor = Math.min(MIN_BAND, totalSize / 2)
  const nextA = clamp(sizeA + delta, floor, totalSize - floor)
  const shareA = (totalWeight * nextA) / totalSize
  return [shareA, totalWeight - shareA]
}

/** All ones: the state the board opens in, and what Reset layout restores. */
const evenWeights = (count: number) => Array.from({ length: count }, () => 1)

/**
 * The step weights as the grid needs them.
 *
 * Length is reconciled here rather than kept in step with the document,
 * because the step count is global and changing it makes any stored array
 * meaningless — a nine-entry set of shares says nothing about a ramp of
 * fifteen. Nothing to subscribe to, so nothing to get out of sync.
 */
export function stepWeightsFor(stored: number[], steps: number): number[] {
  return stored.length === steps ? stored : evenWeights(steps)
}

/**
 * What is written to storage.
 *
 * Palette weights go out as an array in document order, not as the record the
 * board holds. Palette ids are per-session handles — `document.ts` regenerates
 * them from scratch on every load — so an id is the right key in memory, where
 * dragging a palette up the stack should carry its thickness with it, and a
 * meaningless one on disk. Order is what actually persists, so order is what
 * the weights are pinned to.
 */
type Stored = {
  v: 1
  axis: ReviewAxis
  gap: number
  labels: boolean
  palettes: number[]
  steps: number[]
}

const isWeight = (n: unknown): n is number => typeof n === 'number' && n > 0 && n < 1e4

function readStored(ids: string[]): ReviewLayout {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<Stored>
    if (parsed?.v !== 1) return DEFAULTS

    const palettes = Array.isArray(parsed.palettes) ? parsed.palettes : []
    const paletteWeights: Record<string, number> = {}
    ids.forEach((id, index) => {
      const weight = palettes[index]
      if (isWeight(weight)) paletteWeights[id] = weight
    })

    const steps = Array.isArray(parsed.steps) ? parsed.steps.filter(isWeight) : []

    return {
      axis: parsed.axis === 'columns' ? 'columns' : 'rows',
      gap: isWeight(parsed.gap) || parsed.gap === 0 ? clamp(Number(parsed.gap), 0, MAX_GAP) : DEFAULT_GAP,
      labels: parsed.labels !== false,
      paletteWeights,
      stepWeights: steps.length === parsed.steps?.length ? steps : [],
    }
  } catch {
    // Blocked, full, or a private window. The board opens on its defaults,
    // which is a fine board — this is a convenience, not the work.
    return DEFAULTS
  }
}

export function useReview(ids: string[], steps: number): ReviewApi {
  const [layout, setLayout] = useState<ReviewLayout>(() =>
    typeof window === 'undefined' ? DEFAULTS : readStored(ids),
  )

  // Joined rather than the array itself: `palettes.map` hands us a new array
  // every render, so the array's identity would save on every keystroke.
  const order = ids.join(',')

  useEffect(() => {
    try {
      const value: Stored = {
        v: 1,
        axis: layout.axis,
        gap: layout.gap,
        labels: layout.labels,
        palettes: order ? order.split(',').map((id) => layout.paletteWeights[id] ?? 1) : [],
        steps: layout.stepWeights,
      }
      window.localStorage.setItem(KEY, JSON.stringify(value))
    } catch {
      // As above.
    }
  }, [layout, order])

  const weightOf = useCallback(
    (id: string) => layout.paletteWeights[id] ?? 1,
    [layout.paletteWeights],
  )

  const resizePalettes = useCallback(
    (idA: string, idB: string, sizeA: number, sizeB: number, delta: number) => {
      setLayout((current) => {
        const [a, b] = splitPair(
          current.paletteWeights[idA] ?? 1,
          current.paletteWeights[idB] ?? 1,
          sizeA,
          sizeB,
          delta,
        )
        return { ...current, paletteWeights: { ...current.paletteWeights, [idA]: a, [idB]: b } }
      })
    },
    [],
  )

  const resizeSteps = useCallback(
    (indexA: number, indexB: number, sizeA: number, sizeB: number, delta: number) => {
      setLayout((current) => {
        const weights = stepWeightsFor(current.stepWeights, steps).slice()
        if (indexA < 0 || indexB >= weights.length) return current
        const [a, b] = splitPair(weights[indexA], weights[indexB], sizeA, sizeB, delta)
        weights[indexA] = a
        weights[indexB] = b
        return { ...current, stepWeights: weights }
      })
    },
    [steps],
  )

  return {
    layout,
    steps: stepWeightsFor(layout.stepWeights, steps),
    setAxis: useCallback((axis: ReviewAxis) => setLayout((c) => ({ ...c, axis })), []),
    setGap: useCallback(
      (gap: number) => setLayout((c) => ({ ...c, gap: clamp(Math.round(gap), 0, MAX_GAP) })),
      [],
    ),
    setLabels: useCallback((labels: boolean) => setLayout((c) => ({ ...c, labels })), []),
    weightOf,
    resizePalettes,
    resizeSteps,
    // Sizes only. The axis, the spacing and the labels are settings you chose
    // deliberately; the weights are the ones a stray drag can wreck, and the
    // ones there is no other way back from.
    reset: useCallback(
      () => setLayout((c) => ({ ...c, paletteWeights: {}, stepWeights: [] })),
      [],
    ),
  }
}
