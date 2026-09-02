import { maxChromaFor } from './gamut'
import { mapToGamut, normalizeHue, type Gamut, type Oklch } from './oklch'

/**
 * The geometry of a constant-hue slice through OKLCH.
 *
 * A hue leaf is the one view that makes OKLCH legible: lightness up, chroma
 * across, and the gamut drawn as the curved wedge it actually is. It is what
 * the system picker cannot show — HSV's square implies every combination of
 * saturation and brightness exists, when in truth chroma collapses to nothing
 * at both ends of the lightness range and peaks at a cusp somewhere in
 * between, at a different height for every hue.
 *
 * Everything here is pure and unit-scaled: x and y run 0..1 with lightness 1
 * at the top, so the component owns the pixels and this owns the colour.
 */

export type BoundaryPoint = { l: number; c: number }

/** A patch of the slice, in unit space, already resolved to a CSS colour. */
export type SliceCell = { x: number; y: number; w: number; h: number; color: string }

/**
 * Widest chroma each gamut can reach anywhere, and so the width of the
 * chroma axis.
 *
 * Measured by sweeping `maxChromaFor` across all hues and lightnesses, then
 * rounded up to leave the peak just inside the axis rather than exactly on
 * it. Fixed per gamut rather than per hue: the axis has to mean the same
 * thing as you turn the hue ring, or the wedge would breathe and the marker
 * would slide sideways while the colour held still. The cost is honest dead
 * space — cyan reaches about half the chroma magenta does, and the empty
 * right-hand side of a cyan slice is the point.
 */
export const AXIS_MAX: Record<Gamut, number> = {
  srgb: 0.33,
  p3: 0.37,
  a98: 0.39,
  rec2020: 0.46,
}

export function axisMaxChroma(gamut: Gamut): number {
  return AXIS_MAX[gamut]
}

/** How finely the wedge outline is traced. Cheap: the whole sweep is sub-millisecond. */
const BOUNDARY_SAMPLES = 96

/** Cells across the widest row, and rows up the slice. */
const COLS = 28
const ROWS = 22

/**
 * Boundary and cell work is repeated for every render at one hue, so the
 * whole slice is computed once and reused — which costs a measured 1.8ms in
 * sRGB and 6.2ms in Rec. 2020 to build, far too much to repeat per frame.
 *
 * A drag on the lightness/chroma plot holds the hue still throughout, so it
 * runs entirely out of this. A drag on the hue strip does not, which is why
 * the key is quantised: the wedge changes shape far more slowly than a
 * degree, so rounding to one caps a full sweep at 360 builds per gamut and
 * lets a pass back over the same hues come out of the cache. The marker and
 * the readout use the exact hue regardless — only the painted body is
 * shared between neighbours.
 */
const cache = new Map<string, { boundary: BoundaryPoint[]; cells: SliceCell[]; cusp: BoundaryPoint }>()

/**
 * Each entry holds a few hundred cells, so this is a memory ceiling as much
 * as anything. Enough to cover the span of hues one session pushes back and
 * forth over; a sweep across the whole circle discards the far side.
 */
const CACHE_LIMIT = 90

const keyFor = (h: number, gamut: Gamut) => `${gamut}:${Math.round(normalizeHue(h))}`

function computeBoundary(h: number, gamut: Gamut): BoundaryPoint[] {
  const points: BoundaryPoint[] = []
  for (let i = 0; i <= BOUNDARY_SAMPLES; i++) {
    const l = i / BOUNDARY_SAMPLES
    points.push({ l, c: maxChromaFor(l, h, gamut) })
  }
  return points
}

/**
 * The most saturated colour this hue has, and the lightness it sits at.
 *
 * Found by refining around the widest sample rather than trusting it: the
 * cusp is a corner where two gamut faces meet, so it falls between samples
 * and the coarse peak understates it by a visible amount.
 */
function computeCusp(boundary: BoundaryPoint[], h: number, gamut: Gamut): BoundaryPoint {
  let peak = boundary[0]
  for (const point of boundary) {
    if (point.c > peak.c) peak = point
  }

  const span = 1 / BOUNDARY_SAMPLES
  let lo = Math.max(0, peak.l - span)
  let hi = Math.min(1, peak.l + span)
  let best = peak

  // Ternary search: the boundary rises to the cusp and falls away after it,
  // so discarding the worse third each time closes on the corner.
  for (let i = 0; i < 24 && hi - lo > 1e-4; i++) {
    const a = lo + (hi - lo) / 3
    const b = hi - (hi - lo) / 3
    const ca = maxChromaFor(a, h, gamut)
    const cb = maxChromaFor(b, h, gamut)
    if (ca > best.c) best = { l: a, c: ca }
    if (cb > best.c) best = { l: b, c: cb }
    if (ca < cb) lo = a
    else hi = b
  }

  return best
}

/**
 * The slice as a stack of rows, each one exactly as wide as the gamut is at
 * that lightness.
 *
 * Fitting the cells to the wedge rather than clipping a uniform grid to it
 * means every cell is inside the gamut, so its colour is the colour and not
 * something the mapper had to talk down — and there is no half-cell fringe
 * along the edge where a clip cut through.
 */
function computeCells(h: number, gamut: Gamut): SliceCell[] {
  const axis = axisMaxChroma(gamut)
  const cells: SliceCell[] = []
  const rowH = 1 / ROWS

  for (let row = 0; row < ROWS; row++) {
    // Sampled at the row's middle, so the staircase straddles the true edge
    // instead of always falling short of it.
    const l = 1 - (row + 0.5) * rowH
    const cMax = maxChromaFor(l, h, gamut)
    if (cMax <= 0) continue

    const cellW = cMax / axis / COLS
    for (let col = 0; col < COLS; col++) {
      const c = ((col + 0.5) / COLS) * cMax
      cells.push({
        x: col * cellW,
        y: row * rowH,
        w: cellW,
        h: rowH,
        color: mapToGamut({ l, c, h }, gamut).displayColor,
      })
    }
  }

  return cells
}

function sliceFor(h: number, gamut: Gamut) {
  const key = keyFor(h, gamut)
  const hit = cache.get(key)
  if (hit) return hit

  // Built at the key's own hue, not the one asked for, so an entry always
  // matches its key and two hues that share one cannot disagree about the
  // slice depending on which of them arrived first.
  const hue = Math.round(normalizeHue(h))
  const boundary = computeBoundary(hue, gamut)
  const entry = {
    boundary,
    cusp: computeCusp(boundary, hue, gamut),
    cells: computeCells(hue, gamut),
  }

  // Turning the hue ring end to end fills this; nothing here is worth
  // holding onto once it has, so the cache starts over rather than growing.
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, entry)
  return entry
}

/** The wedge outline at one hue, from black at the bottom to white at the top. */
export function gamutBoundary(h: number, gamut: Gamut): BoundaryPoint[] {
  return sliceFor(h, gamut).boundary
}

/**
 * The exact chroma ceiling at one lightness and hue — the unrounded answer
 * the quantised wedge only approximates.
 *
 * Used where a degree of error would show: marking where an out-of-gamut
 * request will actually land, which sits right on the edge by definition.
 */
export function boundaryChromaAt(l: number, h: number, gamut: Gamut): number {
  return maxChromaFor(l, normalizeHue(h), gamut)
}

/** The most chroma this hue can hold, and where. */
export function cuspFor(h: number, gamut: Gamut): BoundaryPoint {
  return sliceFor(h, gamut).cusp
}

/** The painted body of the slice. */
export function sliceCells(h: number, gamut: Gamut): SliceCell[] {
  return sliceFor(h, gamut).cells
}

/** Unit position of a colour on the slice: chroma across, lightness up. */
export function toSlicePoint(color: Oklch, gamut: Gamut): { x: number; y: number } {
  return { x: color.c / axisMaxChroma(gamut), y: 1 - color.l }
}

/** And back again, for a pointer landing somewhere in the plot. */
export function fromSlicePoint(x: number, y: number, gamut: Gamut): { l: number; c: number } {
  return { l: 1 - y, c: x * axisMaxChroma(gamut) }
}

export type HueStop = { h: number; color: string }

/** How many patches the hue strip is built from. */
const HUE_STEPS = 72

/**
 * The hue strip at one lightness and chroma.
 *
 * Painted with the mapped colour, not the requested one, so the strip goes
 * visibly flat across the hues that cannot hold the chroma being asked for.
 * That is the honest answer: those are the colours you would actually get.
 */
export function hueStops(l: number, c: number, gamut: Gamut): HueStop[] {
  const stops: HueStop[] = []
  for (let i = 0; i < HUE_STEPS; i++) {
    const h = (i / HUE_STEPS) * 360
    stops.push({ h, color: mapToGamut({ l, c, h }, gamut).displayColor })
  }
  return stops
}
