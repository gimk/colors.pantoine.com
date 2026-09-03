import type { Gamut } from '../color/oklch'
import {
  decodeDocument,
  decodeGamut,
  decodeStepsLocked,
  encodeDocument,
  encodePalette,
  type DecodedPalette,
} from './url'

/**
 * The document survives a reload in localStorage.
 *
 * What is stored is the same hash string a share link carries, so there is one
 * deserialiser to trust rather than two: anything that can open a mangled link
 * can open mangled storage. Only the selection is stored alongside it, as an
 * index, because palette ids are per-session handles and mean nothing later —
 * the gamut travels inside the hash, since a link has to carry it too.
 */

const KEY = 'colors.pantoine.com/v1'

type Stored = { v: number; hash: string; selected: number }

export type Restored = {
  seeds: DecodedPalette[]
  selected: number
  gamut: Gamut
  stepsLocked?: boolean
}

const segmentOf = (seed: DecodedPalette) => encodePalette(seed.config, seed.name)

/** Every access is guarded: storage throws outright when a browser blocks it. */
function readStored(): Restored | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Stored>
    if (parsed?.v !== 1 || typeof parsed.hash !== 'string') return null
    const seeds = decodeDocument(parsed.hash)
    if (!seeds.length) return null
    const selected = Number(parsed.selected)
    return {
      seeds,
      gamut: decodeGamut(parsed.hash),
      stepsLocked: decodeStepsLocked(parsed.hash),
      selected: Number.isInteger(selected) && selected >= 0 && selected < seeds.length
        ? selected
        : seeds.length - 1,
    }
  } catch {
    return null
  }
}

export function saveDocument(
  palettes: DecodedPalette[],
  selected: number,
  gamut: Gamut = 'srgb',
  stepsLocked = true,
): void {
  try {
    const value: Stored = { v: 1, hash: encodeDocument(palettes, gamut, stepsLocked), selected }
    window.localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    // Full, disabled, or a private window. Autosave is a convenience, and the
    // palette is still in the address bar either way.
  }
}

/**
 * What to open with, given the address bar.
 *
 * A link is merged into the saved document rather than replacing it: following
 * someone's link must not cost you the palettes you already had. Opening the
 * same link twice adds nothing, since segments are compared as encoded text,
 * and that is also what makes a plain reload — where the address bar already
 * holds the whole document — keep the palette you were editing.
 */
export function restoreDocument(hash: string): Restored {
  if (typeof window === 'undefined') return { seeds: [], selected: 0, gamut: 'srgb' }

  const stored = readStored()
  const shared = decodeDocument(hash)
  const sharedGamut = decodeGamut(hash)

  const sharedStepsLocked = decodeStepsLocked(hash)

  if (!shared.length) return stored ?? { seeds: [], selected: 0, gamut: 'srgb', stepsLocked: true }
  if (!stored)
    return {
      seeds: shared,
      selected: shared.length - 1,
      gamut: sharedGamut,
      stepsLocked: sharedStepsLocked,
    }

  const have = new Set(stored.seeds.map(segmentOf))
  const added = shared.filter((seed) => !have.has(segmentOf(seed)))
  if (!added.length) return stored

  // Land on the first palette the link brought, which is the one the person
  // who sent it meant you to look at — and in the gamut they made it in, or
  // the palettes they sent would not be the colours they saw.
  return {
    seeds: [...stored.seeds, ...added],
    selected: stored.seeds.length,
    gamut: sharedGamut,
    stepsLocked: sharedStepsLocked,
  }
}
