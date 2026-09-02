import { basisAtX, bezierYAtX, type Point } from './bezier'

/**
 * One editable channel curve: two anchors (whose y the Start/End number
 * inputs own) and two freely draggable tangent handles.
 *
 * Handle y is unconstrained within the channel box, which is what lets a
 * single cubic segment produce a hump — chroma peaking mid-ramp, hue arcing
 * away from the base and back. A monotonic easing curve could not.
 */
export type Curve = {
  start: number
  end: number
  h1: Point
  h2: Point
}

export type ChannelKey = 'lightness' | 'chroma' | 'hue'

export type Channel = {
  key: ChannelKey
  label: string
  /** Axis caption — names the OKLCH channel and its unit, so the designer
   *  always knows which space they are steering. */
  axis: string
  min: number
  max: number
  decimals: number
  /** Arrow-key increment. */
  nudge: number
  unit: string
}

export const CHANNELS: Record<ChannelKey, Channel> = {
  lightness: {
    key: 'lightness',
    label: 'Lightness',
    axis: 'OKLCH L · 0 → 1',
    min: 0,
    max: 1,
    decimals: 3,
    nudge: 0.005,
    unit: '',
  },
  chroma: {
    key: 'chroma',
    label: 'Chroma',
    axis: 'OKLCH C · 0 → 0.4',
    min: 0,
    max: 0.4,
    decimals: 3,
    nudge: 0.002,
    unit: '',
  },
  hue: {
    key: 'hue',
    // Stored as a delta from the base hue, so re-basing the palette keeps
    // the designer's torsion intact instead of throwing it away.
    label: 'Hue shift',
    axis: 'OKLCH ΔH · −90° → +90°',
    min: -90,
    max: 90,
    decimals: 1,
    nudge: 0.5,
    unit: '°',
  },
}

export const CHANNEL_ORDER: ChannelKey[] = ['lightness', 'chroma', 'hue']

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/** Value of the curve at horizontal position `x` (0 = first step, 1 = last). */
export function sampleCurve(curve: Curve, x: number): number {
  return bezierYAtX(curve.start, curve.h1, curve.h2, curve.end, x)
}

/** Keep every anchor and handle inside the channel's box. */
export function clampCurve(curve: Curve, channel: Channel): Curve {
  const { min, max } = channel
  return {
    start: clamp(curve.start, min, max),
    end: clamp(curve.end, min, max),
    h1: { x: clamp(curve.h1.x, 0, 1), y: clamp(curve.h1.y, min, max) },
    h2: { x: clamp(curve.h2.x, 0, 1), y: clamp(curve.h2.y, min, max) },
  }
}

/** Flat line at `v`. */
export function flat(v: number): Curve {
  return { start: v, end: v, h1: { x: 1 / 3, y: v }, h2: { x: 2 / 3, y: v } }
}

/** Straight ramp from `start` to `end`. */
export function linear(start: number, end: number): Curve {
  return {
    start,
    end,
    h1: { x: 1 / 3, y: start + (end - start) / 3 },
    h2: { x: 2 / 3, y: start + ((end - start) * 2) / 3 },
  }
}

/**
 * A symmetric arc from `start` to `end` passing exactly through `mid` at
 * x = 0.5. Solved rather than eyeballed: at t = 0.5 the Bezier reduces to
 * (y0 + 3·h1y + 3·h2y + y3) / 8, so with both handles at the same height
 * hy = (8·mid − start − end) / 6.
 */
export function arc(start: number, end: number, mid: number): Curve {
  const hy = (8 * mid - start - end) / 6
  return { start, end, h1: { x: 1 / 3, y: hy }, h2: { x: 2 / 3, y: hy } }
}

/** Candidate handle positions for the fit. Spread rather than centred, so
 *  the search can express a peak that sits near either end. */
const FIT_H1_X = [0.04, 0.08, 0.12, 0.18, 0.26, 1 / 3, 0.42]
const FIT_H2_X = [0.5, 0.58, 2 / 3, 0.75, 0.82, 0.88, 0.94]

/** A point the fitted curve must pass through exactly. */
export type FitConstraint = { x: number; y: number }

/** Gauss-Jordan solve of a small dense system. Returns null if singular. */
function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length
  const a = matrix.map((row, i) => [...row, rhs[i]])

  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null
    ;[a[col], a[pivot]] = [a[pivot], a[col]]

    const diagonal = a[col][col]
    for (let k = col; k <= n; k++) a[col][k] /= diagonal
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = a[row][col]
      if (factor === 0) continue
      for (let k = col; k <= n; k++) a[row][k] -= factor * a[col][k]
    }
  }

  return a.map((row) => row[n])
}

/**
 * Best four control heights for a fixed pair of handle x positions, subject
 * to passing exactly through every given constraint.
 *
 * All four heights are unknowns of the same least-squares problem; the
 * constraints then remove degrees of freedom from it. Returns null when no
 * solution exists inside [min, max], so the caller can try a different
 * handle placement rather than accept a clamped curve that quietly misses
 * the points it was told to hit.
 */
function fitControlHeights(
  targets: number[],
  weights: number[],
  h1x: number,
  h2x: number,
  min: number,
  max: number,
  constraints: FitConstraint[],
): Curve | null {
  const n = targets.length
  const size = 4 + constraints.length
  const normal = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  const rhs = new Array<number>(size).fill(0)

  for (let i = 0; i < n; i++) {
    const basis = basisAtX(h1x, h2x, i / (n - 1))
    const w = weights[i]
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) normal[r][c] += w * basis[r] * basis[c]
      rhs[r] += w * basis[r] * targets[i]
    }
  }

  // Constraints enter as Lagrange multipliers rather than as corrections
  // applied afterwards. Bending a finished curve to hit a point is a blunt
  // instrument: it moves whichever handles have leverage there and wrecks
  // the shape everywhere else. Solving with the constraints in place gives
  // the best curve *among those that pass through all of them*.
  constraints.forEach((constraint, j) => {
    const basis = basisAtX(h1x, h2x, constraint.x)
    const row = 4 + j
    for (let k = 0; k < 4; k++) {
      normal[row][k] = basis[k]
      normal[k][row] = basis[k]
    }
    rhs[row] = constraint.y
  })

  const solution = solveLinearSystem(normal, rhs)
  if (!solution) return null

  const heights = solution.slice(0, 4)
  if (heights.some((y) => !Number.isFinite(y) || y < min - 1e-9 || y > max + 1e-9)) {
    // A solution that only satisfies the constraints by leaving the channel
    // box is no solution: clamping it would silently break them.
    return null
  }

  return {
    start: clamp(heights[0], min, max),
    h1: { x: h1x, y: clamp(heights[1], min, max) },
    h2: { x: h2x, y: clamp(heights[2], min, max) },
    end: clamp(heights[3], min, max),
  }
}

/** Weighted sum of squared error of a curve against per-step targets. */
function fitError(curve: Curve, targets: number[], weights: number[]): number {
  const last = Math.max(targets.length - 1, 1)
  let total = 0
  for (let i = 0; i < targets.length; i++) {
    const delta = sampleCurve(curve, i / last) - targets[i]
    total += weights[i] * delta * delta
  }
  return total
}

/** How many iterations of overshoot reweighting to run. */
const FIT_PASSES = 5
/** How hard each pass punishes a step the curve is sitting above. */
const OVERSHOOT_PENALTY = 6

/**
 * Least-squares fit a single cubic through a set of per-step targets.
 *
 * The anchors are pinned to the first and last target, so for any fixed pair
 * of handle x positions only the two handle heights are free — and y(x) is
 * affine in those, which makes that part a 2x2 normal equation rather than an
 * optimisation. The handle x positions themselves come from a small grid
 * search, because they decide *where along the ramp* the curve can bend, and
 * leaving them at 1/3 and 2/3 makes a peak near either end inexpressible: a
 * yellow's chroma ceiling peaks around x = 0.1, and a curve that cannot reach
 * up there gets forced into a broad hump over the middle instead, which is
 * exactly the mud this tool exists to avoid.
 *
 * Used to trace shapes with no closed form, such as the sRGB chroma ceiling
 * as it rises and falls across the lightness range.
 */
export function fitCurve(
  targets: number[],
  min: number,
  max: number,
  extraConstraints: FitConstraint[] = [],
): Curve {
  const n = targets.length
  const last = n - 1
  if (n < 3) return linear(targets[0], targets[last])

  // Both ends are pinned to their targets, not merely weighted toward them.
  // Left free, least squares happily trades an endpoint away to fit the
  // middle a little better, and the result is a ramp whose darkest shade has
  // lost all its chroma — a purple scale ending in flat grey. The endpoints
  // are also the two values the Start and End inputs report, so they are the
  // designer's declared intent rather than a suggestion.
  const constraints: FitConstraint[] = [
    { x: 0, y: targets[0] },
    { x: 1, y: targets[last] },
  ]
  for (const extra of extraConstraints) {
    if (constraints.every((existing) => Math.abs(existing.x - extra.x) > 1e-6)) {
      constraints.push(extra)
    }
  }

  let weights = new Array<number>(n).fill(1)
  let best: Curve | null = null

  // Iteratively reweighted least squares. A plain fit treats overshoot and
  // undershoot alike, but they are not alike here: sitting above the target
  // means asking for a colour the display cannot make, while sitting below
  // just means slightly calmer. Each pass leans harder on the steps the
  // curve is currently above, pulling it under the ceiling.
  for (let pass = 0; pass < FIT_PASSES; pass++) {
    let passBest: Curve | null = null
    let passError = Infinity

    for (const h1x of FIT_H1_X) {
      for (const h2x of FIT_H2_X) {
        const candidate = fitControlHeights(targets, weights, h1x, h2x, min, max, constraints)
        if (!candidate) continue
        const error = fitError(candidate, targets, weights)
        if (error < passError) {
          passBest = candidate
          passError = error
        }
      }
    }

    if (!passBest) break
    best = passBest
    weights = targets.map((target, i) =>
      sampleCurve(passBest, i / last) > target ? weights[i] * OVERSHOOT_PENALTY : 1,
    )
  }

  if (best) return best

  // No constrained cubic fits inside the channel box. Honour the points that
  // matter most — the two ends, then the base — with the exact bend instead.
  let fallback = linear(targets[0], targets[last])
  for (const extra of extraConstraints) {
    fallback = bendThrough(fallback, extra.x, extra.y, min, max)
  }
  return fallback
}

/**
 * Push as much of `residual` as the given control points can absorb without
 * leaving [min, max], distributed in proportion to each one's influence on
 * y(x). Mutates `ys` and returns whatever residual is left over.
 */
function distribute(
  ys: number[],
  weights: number[],
  indices: number[],
  residual: number,
  min: number,
  max: number,
): number {
  const up = residual > 0
  const room = indices.map((i) => (up ? max - ys[i] : ys[i] - min))
  const capacity = indices.reduce((sum, i, k) => sum + weights[i] * room[k], 0)
  if (capacity <= 1e-15) return residual

  const needed = Math.abs(residual)
  if (capacity >= needed) {
    const fraction = needed / capacity
    indices.forEach((i, k) => {
      ys[i] += (up ? 1 : -1) * fraction * room[k]
    })
    return 0
  }

  // Not enough headroom: saturate this group and hand the rest upstream.
  indices.forEach((i, k) => {
    ys[i] += (up ? 1 : -1) * room[k]
  })
  return residual - (up ? capacity : -capacity)
}

/**
 * Bend a curve so it passes exactly through (x, targetY) while every control
 * point stays inside [min, max].
 *
 * y(x) is affine in the four control y values with Bernstein weights that
 * sum to one, so any target inside the channel range is reachable and the
 * correction has a closed form. The handles are asked first, because moving
 * them preserves the ramp's declared endpoints; only if they run out of
 * headroom do the anchors absorb the remainder.
 *
 * Distributing this way rather than shifting both handles by one flat amount
 * matters at the edges: near x = 0 the handles have little leverage, and a
 * flat shift would fly out of range and get clipped, silently missing the
 * target.
 */
export function bendThrough(
  curve: Curve,
  x: number,
  targetY: number,
  min: number,
  max: number,
): Curve {
  const target = clamp(targetY, min, max)
  if (x <= 0) return { ...curve, start: target }
  if (x >= 1) return { ...curve, end: target }

  const weights = basisAtX(curve.h1.x, curve.h2.x, x)
  const ys = [curve.start, curve.h1.y, curve.h2.y, curve.end].map((y) => clamp(y, min, max))
  const current = weights.reduce((sum, w, i) => sum + w * ys[i], 0)

  let residual = target - current
  residual = distribute(ys, weights, [1, 2], residual, min, max)
  if (Math.abs(residual) > 1e-12) {
    residual = distribute(ys, weights, [0, 3], residual, min, max)
  }

  return {
    start: ys[0],
    h1: { x: curve.h1.x, y: ys[1] },
    h2: { x: curve.h2.x, y: ys[2] },
    end: ys[3],
  }
}
