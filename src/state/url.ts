import { CHANNELS, clampCurve, type Curve } from '../color/curve'
import { createPalette, MAX_STEPS, MIN_STEPS, type PaletteConfig } from '../color/presets'

/**
 * The whole palette lives in the URL hash.
 *
 * Kept as readable key/value pairs rather than an opaque blob: a shared link
 * stays legible, diffable and hand-editable, and there is still no backend to
 * store anything in.
 */

const KEYS = { base: 'c', name: 'n', steps: 's', baseIndex: 'b', locked: 'x' } as const
const CURVE_KEYS: Record<'lightness' | 'chroma' | 'hue', string> = {
  lightness: 'l',
  chroma: 'k',
  hue: 'h',
}

const round = (n: number, places = 4) => Number(n.toFixed(places))

function encodeCurve(curve: Curve): string {
  return [curve.start, curve.end, curve.h1.x, curve.h1.y, curve.h2.x, curve.h2.y]
    .map((n) => round(n))
    .join(',')
}

function decodeCurve(raw: string | null): Curve | null {
  if (!raw) return null
  const parts = raw.split(',').map(Number)
  if (parts.length !== 6 || parts.some((n) => !Number.isFinite(n))) return null
  const [start, end, h1x, h1y, h2x, h2y] = parts
  return { start, end, h1: { x: h1x, y: h1y }, h2: { x: h2x, y: h2y } }
}

export function encodePalette(config: PaletteConfig, name: string): string {
  const params = new URLSearchParams()
  params.set(KEYS.base, config.base.replace(/^#/, ''))
  params.set(KEYS.name, name)
  params.set(KEYS.steps, String(config.steps))
  params.set(KEYS.baseIndex, String(config.baseIndex))
  if (config.baseLocked) params.set(KEYS.locked, '1')
  params.set(CURVE_KEYS.lightness, encodeCurve(config.lightness))
  params.set(CURVE_KEYS.chroma, encodeCurve(config.chroma))
  params.set(CURVE_KEYS.hue, encodeCurve(config.hue))
  return params.toString()
}

export type DecodedPalette = { config: PaletteConfig; name: string }

/**
 * Restores the saved base color string.
 *
 * When palettes are encoded into URL query parameters, hex colours have their
 * leading '#' stripped. When reloading, only re-attach '#' if the value is
 * actually a bare hex string (3, 4, 6, or 8 hex digits). Formats like
 * oklch(...), rgb(...), hsl(...), color(...), or named colours must not have '#' added.
 */
export function restoreBaseColor(base: string): string {
  const trimmed = base.trim()
  if (trimmed.startsWith('#')) return trimmed
  if (/^(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    return `#${trimmed}`
  }
  return trimmed
}

/**
 * Rebuild a palette from a hash. Anything missing or malformed falls back to
 * the default for that field, so a truncated or hand-mangled link still
 * opens something usable instead of an error.
 */
export function decodePalette(hash: string): DecodedPalette | null {
  const raw = hash.replace(/^#/, '')
  if (!raw) return null

  const params = new URLSearchParams(raw)
  const base = params.get(KEYS.base)
  if (!base) return null

  const steps = Number(params.get(KEYS.steps))
  const parsedSteps =
    Number.isFinite(steps) && steps >= MIN_STEPS && steps <= MAX_STEPS ? steps : undefined

  const config = createPalette(restoreBaseColor(base), parsedSteps)

  const baseIndex = Number(params.get(KEYS.baseIndex))
  if (Number.isInteger(baseIndex) && baseIndex >= 0 && baseIndex < config.steps) {
    config.baseIndex = baseIndex
  }

  config.baseLocked = params.get(KEYS.locked) === '1'

  for (const key of ['lightness', 'chroma', 'hue'] as const) {
    const curve = decodeCurve(params.get(CURVE_KEYS[key]))
    if (curve) config[key] = clampCurve(curve, CHANNELS[key])
  }

  return { config, name: params.get(KEYS.name) || 'brand' }
}

/**
 * A document is its palettes joined by `~`, which is unreserved in a URI so it
 * survives every share path untouched. Each segment is exactly the
 * single-palette encoding above, which means links made before there was more
 * than one palette still open — as a document of one.
 */
const SEPARATOR = '~'

export function encodeDocument(palettes: DecodedPalette[]): string {
  return palettes.map((entry) => encodePalette(entry.config, entry.name)).join(SEPARATOR)
}

/** Segments that do not decode are dropped rather than failing the whole link. */
export function decodeDocument(hash: string): DecodedPalette[] {
  const raw = hash.replace(/^#/, '')
  if (!raw) return []
  return raw
    .split(SEPARATOR)
    .map((segment) => decodePalette(segment))
    .filter((entry): entry is DecodedPalette => entry !== null)
}

export function documentUrl(palettes: DecodedPalette[]): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#${encodeDocument(palettes)}`
}
