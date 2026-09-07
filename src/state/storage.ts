import type { Gamut } from '../color/oklch'
import { AUTO_RULE, type ProfileId, type RuleId, type Slot } from '../color/scheme'
import {
  decodeDocument,
  decodeGamut,
  decodeScheme,
  decodeStepsLocked,
  encodeDocument,
  encodePalette,
  encodeScheme,
  type DecodedPalette,
  type DecodedScheme,
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
  /**
   * The palettes to open with, or `null` for a session that has never saved
   * one. The two are not the same any more: a document can be emptied on
   * purpose, and coming back to find the default palette reinstated would
   * quietly undo that. `null` is a first run, `[]` is a deliberate blank.
   */
  seeds: DecodedPalette[] | null
  selected: number
  gamut: Gamut
  stepsLocked?: boolean
}

const segmentOf = (seed: DecodedPalette) =>
  encodePalette(seed.config, seed.name, seed.nameCustom)

/** Every access is guarded: storage throws outright when a browser blocks it. */
function readStored(): Restored | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Stored>
    if (parsed?.v !== 1 || typeof parsed.hash !== 'string') return null
    // An empty list is a real answer here — a document that was emptied —
    // so only a missing or unreadable record counts as nothing saved.
    const seeds = decodeDocument(parsed.hash)
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
  if (typeof window === 'undefined') return { seeds: null, selected: 0, gamut: 'srgb' }

  const stored = readStored()
  const shared = decodeDocument(hash)
  const sharedGamut = decodeGamut(hash)

  const sharedStepsLocked = decodeStepsLocked(hash)

  if (!shared.length)
    return stored ?? { seeds: null, selected: 0, gamut: 'srgb', stepsLocked: true }
  if (!stored)
    return {
      seeds: shared,
      selected: shared.length - 1,
      gamut: sharedGamut,
      stepsLocked: sharedStepsLocked,
    }

  const have = new Set((stored.seeds ?? []).map(segmentOf))
  const added = shared.filter((seed) => !have.has(segmentOf(seed)))
  if (!added.length) return stored

  // Land on the first palette the link brought, which is the one the person
  // who sent it meant you to look at — and in the gamut they made it in, or
  // the palettes they sent would not be the colours they saw.
  return {
    seeds: [...(stored.seeds ?? []), ...added],
    selected: (stored.seeds ?? []).length,
    gamut: sharedGamut,
    stepsLocked: sharedStepsLocked,
  }
}

/* --- the scheme ---------------------------------------------------------
 *
 * Its own key, the way the review board's layout has its own. The two modes
 * keep separate state on purpose, and merging them into one record would put
 * a scheme at risk from a document migration it has nothing to do with.
 *
 * Same trick as above: what is stored is the hash string a share link
 * carries, so there is one deserialiser to trust rather than two.
 */

const SCHEME_KEY = 'colors.pantoine.com/scheme/v1'

type StoredScheme = { v: 1; hash: string }

export function saveScheme(slots: Slot[], rule: RuleId, profile: ProfileId): void {
  try {
    const value: StoredScheme = { v: 1, hash: encodeScheme(slots, rule, profile) }
    window.localStorage.setItem(SCHEME_KEY, JSON.stringify(value))
  } catch {
    // Full, disabled, or a private window. The board opens on a fresh roll,
    // which is a fine board — this mode makes a new one on a keypress.
  }
}

/**
 * The scheme to open with: the one in the link, else the one last saved.
 *
 * A link wins outright here rather than merging the way the palette document
 * does. A document is a stack you add to, so someone else's palettes can join
 * yours; a scheme is one set of five colours chosen together, and there is no
 * sense in which two of them combine.
 */
export function restoreScheme(hash: string): DecodedScheme | null {
  if (typeof window === 'undefined') return null

  const shared = decodeScheme(hash)
  if (shared) return shared

  try {
    const raw = window.localStorage.getItem(SCHEME_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredScheme>
    if (parsed?.v !== 1 || typeof parsed.hash !== 'string') return null
    return decodeScheme(parsed.hash)
  } catch {
    return null
  }
}

/** What a session with neither a link nor a saved scheme starts from. */
export const BLANK_SCHEME: DecodedScheme = {
  colors: [],
  locks: [],
  rule: AUTO_RULE,
  profile: 'even',
}
