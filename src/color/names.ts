import { colornames } from 'color-name-list'
import { parseToOklch, toHex } from './oklch'

type ParsedColor = {
  name: string
  r: number
  g: number
  b: number
}

let parsedEntries: ParsedColor[] | null = null

function getEntries(): ParsedColor[] {
  if (!parsedEntries) {
    parsedEntries = colornames.map((item) => {
      const num = parseInt(item.hex.slice(1), 16)
      return {
        name: item.name,
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255,
      }
    })
  }
  return parsedEntries
}

const nameCache = new Map<string, string>()

/**
 * Deterministically returns a human-readable color name for any color string
 * using the full meodai/color-names dataset (30,000+ curated colors).
 *
 * Uses perceptually weighted Euclidean distance (redmean) and caches results.
 */
export function nameForColor(color: string): string {
  const parsed = parseToOklch(color)
  const hex = parsed
    ? toHex(parsed).toLowerCase()
    : color.startsWith('#')
      ? color.toLowerCase()
      : `#${color.toLowerCase()}`

  const cached = nameCache.get(hex)
  if (cached) return cached

  try {
    const raw = hex.replace(/^#/, '')
    if (!/^[0-9a-f]{6}$/i.test(raw)) return 'palette'
    const num = parseInt(raw, 16)

    const r1 = (num >> 16) & 255
    const g1 = (num >> 8) & 255
    const b1 = num & 255

    const entries = getEntries()
    let bestName = entries[0].name
    let bestDist = Infinity

    for (let i = 0; i < entries.length; i++) {
      const c = entries[i]
      const dr = r1 - c.r
      const dg = g1 - c.g
      const db = b1 - c.b
      if (dr === 0 && dg === 0 && db === 0) {
        bestName = c.name
        break
      }
      const rmean = (r1 + c.r) >> 1
      const dist =
        (((512 + rmean) * dr * dr) >> 8) + 4 * dg * dg + (((767 - rmean) * db * db) >> 8)
      if (dist < bestDist) {
        bestDist = dist
        bestName = c.name
      }
    }

    nameCache.set(hex, bestName)
    return bestName
  } catch {
    return 'palette'
  }
}
