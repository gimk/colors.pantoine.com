import { CHANNEL_ORDER, clamp, curvesEqual, type Curve } from '../color/curve'
import { normalizeHue, toHex, type Gamut } from '../color/oklch'
import {
  chromaCurveFor,
  createPalette,
  DEFAULT_STEPS,
  FALLBACK_BASE,
  holdBase,
  MAX_STEPS,
  MIN_STEPS,
  type CurveKey,
  type PaletteConfig,
} from '../color/presets'
import { resolveBase } from '../color/ramp'
import {
  initialPaletteState,
  nearestStep,
  NOTHING_EDITED,
  paletteReducer,
  type Edited,
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
  /**
   * Which display gamut the whole document is being designed for. Document
   * state rather than a view preference: it decides how much chroma every
   * derived curve is allowed to ask for, so it is part of the work, and it
   * travels in the link and in storage with everything else.
   */
  gamut: Gamut
}

export type DocumentAction =
  /** Forwarded to whichever palette is selected. */
  | { type: 'palette'; action: PaletteAction }
  | { type: 'new' }
  | { type: 'select'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; by: -1 | 1 }
  | { type: 'reorder'; sourceId: string; targetId: string }
  | { type: 'rename'; id: string; name: string }
  | { type: 'setSteps'; value: number }
  | { type: 'setGamut'; value: Gamut }
  | { type: 'syncChannel'; key: CurveKey }
  | { type: 'syncAll' }

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

function makeEntry(
  seed: string | PaletteConfig,
  name: string,
  steps?: number,
  gamut: Gamut = 'srgb',
): PaletteEntry {
  if (typeof seed === 'string') {
    return {
      id: makeId(),
      name,
      state: {
        config: createPalette(seed, steps ?? DEFAULT_STEPS, gamut),
        edited: { ...NOTHING_EDITED },
      },
    }
  }
  // A config seed arrives fully formed, from a link or from storage, so
  // `steps` and `gamut` have nothing to derive and are deliberately unused:
  // overriding its curves here would discard someone's saved work.
  return { id: makeId(), name, state: initialPaletteState(seed) }
}

export function createDocument(
  seeds: PaletteSeed[] = [],
  selected = -1,
  gamut: Gamut = 'srgb',
): DocumentState {
  // A document has a unified global step count across all palettes.
  const globalSteps = seeds.length ? seeds[0].config.steps : DEFAULT_STEPS
  const palettes = seeds.length
    ? seeds.map((seed) => {
        const entry = makeEntry(seed.config, seed.name)
        if (entry.state.config.steps !== globalSteps) {
          entry.state = paletteReducer(
            entry.state,
            { type: 'setSteps', value: globalSteps },
            gamut,
          )
        }
        return entry
      })
    : [makeEntry(FALLBACK_BASE, 'brand', globalSteps, gamut)]
  // Default to the last one: that is the working palette, the one the toolbox
  // opens under, with the finished ones stacked above it.
  const index = selected >= 0 && selected < palettes.length ? selected : palettes.length - 1
  return { palettes, selectedId: palettes[index].id, gamut }
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

const cloneCurve = (curve: Curve): Curve => ({
  start: curve.start,
  end: curve.end,
  h1: { ...curve.h1 },
  h2: { ...curve.h2 },
})

/**
 * The entry it was handed, when the sync would have changed nothing.
 *
 * Applying a curve a palette already has must not count as an edit: the
 * reducers report "nothing happened" by identity, and without this every
 * click of Apply all would push an undo entry over an unchanged document.
 */
function settled(
  targetEntry: PaletteEntry,
  config: PaletteConfig,
  edited: Edited,
): PaletteEntry {
  const before = targetEntry.state
  const unchanged =
    config.baseIndex === before.config.baseIndex &&
    CHANNEL_ORDER.every((key) => curvesEqual(config[key], before.config[key])) &&
    CHANNEL_ORDER.every((key) => edited[key] === before.edited[key])
  return unchanged ? targetEntry : { ...targetEntry, state: { config, edited } }
}

function applyChannelSync(
  targetEntry: PaletteEntry,
  key: CurveKey,
  sourceCurve: Curve,
  gamut: Gamut,
): PaletteEntry {
  const { config, edited } = targetEntry.state
  const base = resolveBase(config)
  const curveCopy = cloneCurve(sourceCurve)

  if (key === 'lightness') {
    const baseIndex = nearestStep(curveCopy, config.steps, base.l)
    const finalLightness = config.baseLocked
      ? holdBase(curveCopy, 'lightness', base, config.steps, baseIndex)
      : curveCopy

    const finalChroma = !edited.chroma
      ? chromaCurveFor(base, config.steps, baseIndex, finalLightness, gamut)
      : config.baseLocked
        ? holdBase(config.chroma, 'chroma', base, config.steps, baseIndex)
        : config.chroma

    return settled(
      targetEntry,
      { ...config, baseIndex, lightness: finalLightness, chroma: finalChroma },
      { ...edited, lightness: true },
    )
  }

  if (key === 'chroma') {
    const finalChroma = config.baseLocked
      ? holdBase(curveCopy, 'chroma', base, config.steps, config.baseIndex)
      : curveCopy

    return settled(targetEntry, { ...config, chroma: finalChroma }, { ...edited, chroma: true })
  }

  // key === 'hue'
  const finalHue = config.baseLocked
    ? holdBase(curveCopy, 'hue', base, config.steps, config.baseIndex)
    : curveCopy

  return settled(targetEntry, { ...config, hue: finalHue }, { ...edited, hue: true })
}

function applyAllSync(targetEntry: PaletteEntry, sourceConfig: PaletteConfig): PaletteEntry {
  const { config } = targetEntry.state
  const base = resolveBase(config)

  const lCopy = cloneCurve(sourceConfig.lightness)
  const cCopy = cloneCurve(sourceConfig.chroma)
  const hCopy = cloneCurve(sourceConfig.hue)

  const baseIndex = nearestStep(lCopy, config.steps, base.l)

  const finalLightness = config.baseLocked
    ? holdBase(lCopy, 'lightness', base, config.steps, baseIndex)
    : lCopy
  const finalChroma = config.baseLocked
    ? holdBase(cCopy, 'chroma', base, config.steps, baseIndex)
    : cCopy
  const finalHue = config.baseLocked
    ? holdBase(hCopy, 'hue', base, config.steps, baseIndex)
    : hCopy

  return settled(
    targetEntry,
    {
      ...config,
      baseIndex,
      lightness: finalLightness,
      chroma: finalChroma,
      hue: finalHue,
    },
    { lightness: true, chroma: true, hue: true },
  )
}

/**
 * The state it was handed, when every entry came back untouched.
 *
 * `map` always allocates, so a document-wide pass has to be checked entry by
 * entry: history records an entry for any new state object, and a pass that
 * changed nothing should not be undoable.
 */
function sameStack(state: DocumentState, palettes: PaletteEntry[]): DocumentState {
  return palettes.every((entry, index) => entry === state.palettes[index])
    ? state
    : { ...state, palettes }
}

export function documentReducer(state: DocumentState, action: DocumentAction): DocumentState {
  switch (action.type) {
    case 'syncChannel': {
      if (state.palettes.length < 2) return state
      const current = selectedEntry(state)
      const sourceCurve = current.state.config[action.key]
      const palettes = state.palettes.map((entry) =>
        entry.id === current.id
          ? entry
          : applyChannelSync(entry, action.key, sourceCurve, state.gamut),
      )
      return sameStack(state, palettes)
    }

    case 'syncAll': {
      if (state.palettes.length < 2) return state
      const current = selectedEntry(state)
      const palettes = state.palettes.map((entry) =>
        entry.id === current.id ? entry : applyAllSync(entry, current.state.config),
      )
      return sameStack(state, palettes)
    }

    case 'setGamut': {
      if (action.value === state.gamut) return state
      const palettes = state.palettes.map((entry) => {
        const next = paletteReducer(entry.state, { type: 'regamut' }, action.value)
        return next === entry.state ? entry : { ...entry, state: next }
      })
      return { ...state, gamut: action.value, palettes }
    }
    case 'setSteps': {
      const steps = clamp(Math.round(action.value), MIN_STEPS, MAX_STEPS)
      if (state.palettes.every((entry) => entry.state.config.steps === steps)) return state

      const palettes = state.palettes.map((entry) => {
        const next = paletteReducer(entry.state, { type: 'setSteps', value: steps }, state.gamut)
        return next === entry.state ? entry : { ...entry, state: next }
      })
      return sameStack(state, palettes)
    }

    case 'palette': {
      if (action.action.type === 'setSteps') {
        return documentReducer(state, { type: 'setSteps', value: action.action.value })
      }
      const current = selectedEntry(state)
      const next = paletteReducer(current.state, action.action, state.gamut)
      if (next === current.state) return state
      return replaceEntry(state, current.id, (entry) => ({ ...entry, state: next }))
    }

    case 'new': {
      const currentConfig = selectedEntry(state).state.config
      const currentSteps = currentConfig.steps
      const entry = makeEntry(
        steppedBase(currentConfig),
        `palette ${state.palettes.length + 1}`,
        currentSteps,
        state.gamut,
      )
      return { ...state, palettes: [...state.palettes, entry], selectedId: entry.id }
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
      return { ...state, palettes, selectedId }
    }

    case 'move': {
      const index = indexOfId(state, action.id)
      const target = index + action.by
      if (index < 0 || target < 0 || target >= state.palettes.length) return state
      const palettes = [...state.palettes]
      ;[palettes[index], palettes[target]] = [palettes[target], palettes[index]]
      return { ...state, palettes }
    }

    case 'reorder': {
      const from = indexOfId(state, action.sourceId)
      const to = indexOfId(state, action.targetId)
      if (from < 0 || to < 0 || from === to) return state
      const palettes = [...state.palettes]
      const [moved] = palettes.splice(from, 1)
      palettes.splice(to, 0, moved)
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
  if (action.type === 'setSteps') {
    return 'steps'
  }

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
      // Start and End commit on every keystroke that parses, and again on
      // blur if the field ends up somewhere new, so a typed value is one
      // entry rather than one per character.
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
