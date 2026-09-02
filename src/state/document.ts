import { normalizeHue, toHex } from '../color/oklch'
import { FALLBACK_BASE, type PaletteConfig } from '../color/presets'
import { resolveBase } from '../color/ramp'
import {
  initialPaletteState,
  paletteReducer,
  type PaletteAction,
  type PaletteState,
} from './paletteReducer'

/**
 * A document is an ordered stack of palettes plus which one is being edited.
 *
 * Order is top-to-bottom on screen, and a new palette is appended: the one you
 * are working on sits at the bottom, nearest the toolbox, and the ones you
 * finished stack up above it.
 */

export type PaletteEntry = {
  id: string
  name: string
  state: PaletteState
}

export type DocumentState = {
  palettes: PaletteEntry[]
  selectedId: string
}

export type DocumentAction =
  /** Forwarded to whichever palette is selected. */
  | { type: 'palette'; action: PaletteAction }
  | { type: 'new' }
  | { type: 'select'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; by: -1 | 1 }
  | { type: 'rename'; id: string; name: string }

/**
 * A new palette starts a fifth of the way around the hue circle from the one
 * you were editing. Two identical purple ramps would be no use, and a scheme
 * is usually built by stepping around the wheel.
 */
const NEW_PALETTE_HUE_STEP = 72

let nextId = 0

/** Ids are per-session handles for React keys and selection, never persisted. */
const makeId = () => `p${++nextId}`

export type PaletteSeed = { name: string; config: PaletteConfig }

function makeEntry(seed: string | PaletteConfig, name: string): PaletteEntry {
  return { id: makeId(), name, state: initialPaletteState(seed) }
}

export function createDocument(seeds: PaletteSeed[] = [], selected = -1): DocumentState {
  const palettes = seeds.length
    ? seeds.map((seed) => makeEntry(seed.config, seed.name))
    : [makeEntry(FALLBACK_BASE, 'brand')]
  // Default to the last one: that is the working palette, the one the toolbox
  // opens under, with the finished ones stacked above it.
  const index = selected >= 0 && selected < palettes.length ? selected : palettes.length - 1
  return { palettes, selectedId: palettes[index].id }
}

export const selectedEntry = (state: DocumentState): PaletteEntry =>
  state.palettes.find((entry) => entry.id === state.selectedId) ?? state.palettes[0]

const indexOfId = (state: DocumentState, id: string) =>
  state.palettes.findIndex((entry) => entry.id === id)

/** Base colour for a new palette, stepped around the wheel from `from`. */
function steppedBase(from: PaletteConfig | undefined): string {
  if (!from) return FALLBACK_BASE
  const base = resolveBase(from)
  return toHex({ ...base, h: normalizeHue(base.h + NEW_PALETTE_HUE_STEP) })
}

function replaceEntry(
  state: DocumentState,
  id: string,
  change: (entry: PaletteEntry) => PaletteEntry,
): DocumentState {
  const index = indexOfId(state, id)
  if (index < 0) return state
  const palettes = [...state.palettes]
  palettes[index] = change(palettes[index])
  return { ...state, palettes }
}

export function documentReducer(state: DocumentState, action: DocumentAction): DocumentState {
  switch (action.type) {
    case 'palette': {
      const current = selectedEntry(state)
      const next = paletteReducer(current.state, action.action)
      if (next === current.state) return state
      return replaceEntry(state, current.id, (entry) => ({ ...entry, state: next }))
    }

    case 'new': {
      const entry = makeEntry(
        steppedBase(selectedEntry(state).state.config),
        `palette ${state.palettes.length + 1}`,
      )
      return { palettes: [...state.palettes, entry], selectedId: entry.id }
    }

    case 'select':
      return indexOfId(state, action.id) < 0 ? state : { ...state, selectedId: action.id }

    case 'remove': {
      // The document is never empty: with one palette left there is nothing to
      // switch to and the toolbox would have nothing to edit.
      if (state.palettes.length < 2) return state
      const index = indexOfId(state, action.id)
      if (index < 0) return state
      const palettes = state.palettes.filter((entry) => entry.id !== action.id)
      const selectedId =
        action.id === state.selectedId
          ? palettes[Math.min(index, palettes.length - 1)].id
          : state.selectedId
      return { palettes, selectedId }
    }

    case 'move': {
      const index = indexOfId(state, action.id)
      const target = index + action.by
      if (index < 0 || target < 0 || target >= state.palettes.length) return state
      const palettes = [...state.palettes]
      ;[palettes[index], palettes[target]] = [palettes[target], palettes[index]]
      return { ...state, palettes }
    }

    case 'rename':
      return replaceEntry(state, action.id, (entry) => ({ ...entry, name: action.name }))
  }
}

/**
 * Which edits belong to the same undo entry.
 *
 * A drag and a burst of typing are each one thing the designer did, however
 * many actions they dispatched. Everything discrete — a click, a preset, a
 * choice from a select — begins an entry of its own.
 */
export function coalesceKey(action: DocumentAction): string | null {
  if (action.type !== 'palette') {
    // Renaming is the one document-level edit typed a character at a time.
    return action.type === 'rename' ? `rename:${action.id}` : null
  }

  const edit = action.action
  switch (edit.type) {
    case 'setCurve':
      // A drag and an arrow-key nudge both name the control they moved. A
      // shape preset arrives through the same action naming none, and is a
      // single click that deserves its own entry.
      return edit.moved ? `curve:${edit.key}:${edit.moved}` : null
    case 'setEndpoint':
      // Start and End commit on every keystroke, not on blur.
      return `endpoint:${edit.key}:${edit.end}`
    case 'setBase':
      return 'base'
    case 'setSteps':
      return 'steps'
    default:
      return null
  }
}

/**
 * Selecting a palette moves the toolbox; it does not change the document.
 * Undo should step back through edits, not retrace where you were looking —
 * and each snapshot carries its own selection, so undoing an edit still
 * returns you to the palette it was made on.
 */
export const isTransient = (action: DocumentAction) => action.type === 'select'
