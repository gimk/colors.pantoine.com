/**
 * Cubic Bezier evaluated as a function of x.
 *
 * Both end anchors are pinned to x = 0 and x = 1; only the two tangent
 * handles move freely, and their x is clamped to [0, 1] by the editor so
 * that x(t) stays monotonic and y is a genuine function of x.
 *
 * y is in channel units (not normalised), so the same code drives the
 * lightness, chroma and hue graphs.
 */

export type Point = { x: number; y: number }

/** B(t) = p0 + c·t + b·t² + a·t³ — the expanded Bernstein form. */
type Poly = { p0: number; c: number; b: number; a: number }

function poly(p0: number, p1: number, p2: number, p3: number): Poly {
  return {
    p0,
    c: 3 * (p1 - p0),
    b: 3 * (p0 - 2 * p1 + p2),
    a: -p0 + 3 * p1 - 3 * p2 + p3,
  }
}

function evalPoly(k: Poly, t: number): number {
  return k.p0 + t * (k.c + t * (k.b + t * k.a))
}

function slopePoly(k: Poly, t: number): number {
  return k.c + t * (2 * k.b + 3 * t * k.a)
}

const NEWTON_ITERATIONS = 8
const NEWTON_MIN_SLOPE = 1e-6
const BISECTION_ITERATIONS = 32
const SUBDIVISION_EPSILON = 1e-7

/**
 * Invert x(t) for a given x. Newton-Raphson first (fast, converges in a
 * couple of steps for well-behaved curves), bisection as the fallback when
 * the slope goes flat — the standard `cubic-bezier` easing technique.
 */
export function solveTForX(h1x: number, h2x: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1

  const kx = poly(0, h1x, h2x, 1)

  let t = x
  for (let i = 0; i < NEWTON_ITERATIONS; i++) {
    const slope = slopePoly(kx, t)
    if (Math.abs(slope) < NEWTON_MIN_SLOPE) break
    const next = t - (evalPoly(kx, t) - x) / slope
    if (next < 0 || next > 1) break
    if (Math.abs(next - t) < SUBDIVISION_EPSILON) return next
    t = next
  }

  let lo = 0
  let hi = 1
  t = x
  for (let i = 0; i < BISECTION_ITERATIONS; i++) {
    const err = evalPoly(kx, t) - x
    if (Math.abs(err) < SUBDIVISION_EPSILON) break
    if (err > 0) hi = t
    else lo = t
    t = (lo + hi) / 2
  }
  return t
}

/** Value of the curve at horizontal position `x`. */
export function bezierYAtX(
  y0: number,
  h1: Point,
  h2: Point,
  y3: number,
  x: number,
): number {
  const t = solveTForX(h1.x, h2.x, x)
  return evalPoly(poly(y0, h1.y, h2.y, y3), t)
}

/**
 * The Bernstein basis at the `t` that corresponds to `x`.
 *
 * y(x) is affine in the four control-point y values, which is what lets us
 * bend a curve exactly through a point (see `bendThrough` in curve.ts)
 * instead of hunting for handle positions numerically.
 */
export function basisAtX(h1x: number, h2x: number, x: number): [number, number, number, number] {
  const t = solveTForX(h1x, h2x, x)
  const u = 1 - t
  return [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
}

/**
 * The curve as a single exact SVG cubic. The tangent handles *are* the
 * Bezier control points in (x, y), so no flattening is needed.
 */
export function toSvgPath(
  y0: number,
  h1: Point,
  h2: Point,
  y3: number,
  toPx: (x: number, y: number) => Point,
): string {
  const a = toPx(0, y0)
  const c1 = toPx(h1.x, h1.y)
  const c2 = toPx(h2.x, h2.y)
  const b = toPx(1, y3)
  const f = (n: number) => n.toFixed(2)
  return `M${f(a.x)} ${f(a.y)} C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`
}
