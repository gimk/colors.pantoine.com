import { CHANNEL_ORDER, clamp, curvesEqual, type Curve } from '../color/curve'
import { normalizeHue, parseGamut, parseToOklch, toHex, type Gamut } from '../color/oklch'
import { maxChromaFor } from '../color/gamut'
import { nameForColor } from '../color/names'
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
 * Order is top-to-bottom on screen, and new palettes are appended, so the ones
 * you finished stack up above the ones you just made. The quick-add leaves you
 * on its single new palette at the bottom; a batch leaves you on the *first*
 * of the batch, which is the one whose colour the designer named first.
 */

export type PaletteEntry = {
  id: string
  name: string
  nameCustom?: boolean
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
  /**
   * Whether the step count is locked/shared across all palettes (true by default),
   * or independent per palette (false).
   */
  stepsLocked: boolean
}

export type DocumentAction =
  /** Forwarded to whichever palette is selected. */
  | { type: 'palette'; action: PaletteAction }
  | { type: 'new' }
  /** Append one palette per base colour, in the order given. */
  | { type: 'add'; bases: BaseSeed[] }
  | { type: 'select'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; by: -1 | 1 }
  | { type: 'reorder'; sourceId: string; targetId: string }
  | { type: 'rename'; id: string; name: string }
  | { type: 'setSteps'; value: number }
  | { type: 'setPaletteSteps'; id: string; value: number }
  | { type: 'setStepsLocked'; value: boolean }
  | { type: 'setGamut'; value: Gamut }
  /**
   * Copy the selected palette's curve for one channel onto other palettes:
   * every other palette in the document, or only the ones `to` names.
   */
  | { type: 'syncChannel'; key: CurveKey; to?: string[] }

/**
 * How far around the hue circle a new palette lands from the one you were
 * editing. The golden angle, so a run of quick-adds keeps landing in the gaps
 * rather than retracing a fifth of the wheel back onto colours you already
 * have — two near-identical ramps being no use to anyone building a scheme.
 */
export const NEW_PALETTE_HUE_STEP = 137.5

/** Spread either side of that step, and of the lightness a new base takes. */
export const HUE_JITTER = 60
const LIGHTNESS_JITTER = 0.3

let nextId = 0

/** Ids are per-session handles for React keys and selection, never persisted. */
const makeId = () => `p${++nextId}`

export type PaletteSeed = { name: string; config: PaletteConfig; nameCustom?: boolean }

/**
 * A palette to create, named by whoever asked for it.
 *
 * Deliberately not called a "seed": `PaletteSeed` above and `makeEntry`'s own
 * parameter already mean two different things by that word in this file.
 */
export type BaseSeed = { base: string; name?: string }

/**
 * As many palettes as one document is any use with.
 *
 * A cap rather than a refusal, the way `setSteps` clamps: someone pasting a
 * hundred hex codes should get a document, not an error. The limit is about
 * what a person can read down a page and what fits in a share link — the
 * derivation itself would happily do more.
 */
export const MAX_PALETTES = 24

function makeEntry(
  seed: string | PaletteConfig,
  name: string,
  steps?: number,
  gamut: Gamut = 'srgb',
  nameCustom = false,
): PaletteEntry {
  if (typeof seed === 'string') {
    return {
      id: makeId(),
      name,
      nameCustom,
      state: {
        config: createPalette(seed, steps ?? DEFAULT_STEPS, gamut),
        edited: { ...NOTHING_EDITED },
      },
    }
  }
  // A config seed arrives fully formed, from a link or from storage, so
  // `steps` has nothing to derive and is deliberately unused:
  // overriding its curves here would discard someone's saved work.
  return { id: makeId(), name, nameCustom, state: initialPaletteState(seed, gamut) }
}

export function createDocument(
  seeds: PaletteSeed[] = [],
  selected = -1,
  gamut: Gamut = 'srgb',
  stepsLocked = true,
): DocumentState {
  const globalSteps = seeds.length ? seeds[0].config.steps : DEFAULT_STEPS
  const palettes = seeds.length
    ? seeds.map((seed) => {
        const isCustom = seed.nameCustom ?? !looksDerived(seed.name, seed.config.base)
        const entry = makeEntry(seed.config, seed.name, undefined, gamut, isCustom)
        if (stepsLocked && entry.state.config.steps !== globalSteps) {
          entry.state = paletteReducer(
            entry.state,
            { type: 'setSteps', value: globalSteps },
            gamut,
          )
        }
        return entry
      })
    : [makeEntry(FALLBACK_BASE, 'brand', globalSteps, gamut, false)]
  // Default to the last one: that is the working palette, the one the toolbox
  // opens under, with the finished ones stacked above it.
  const index = selected >= 0 && selected < palettes.length ? selected : palettes.length - 1
  return { palettes, selectedId: palettes[index].id, gamut, stepsLocked }
}

export const selectedEntry = (state: DocumentState): PaletteEntry =>
  state.palettes.find((entry) => entry.id === state.selectedId) ?? state.palettes[0]

const indexOfId = (state: DocumentState, id: string) =>
  state.palettes.findIndex((entry) => entry.id === id)

/**
 * Base colour for a new palette, stepped around the wheel from `from` with
 * enough variation that no two quick-adds hand you the same colour.
 *
 * Lightness and chroma wander as well as hue: stepping hue alone off a very
 * dark or very washed-out base gives you a row of equally unusable ramps. The
 * chroma is taken as a fraction of what this particular hue and lightness can
 * actually hold, so a new base is vivid without being clipped on arrival.
 */
function steppedBase(from: PaletteConfig | undefined, gamut: Gamut = 'srgb'): string {
  if (!from) return FALLBACK_BASE
  const base = resolveBase(from)
  const h = normalizeHue(base.h + NEW_PALETTE_HUE_STEP + (Math.random() - 0.5) * HUE_JITTER)
  const l = clamp(0.48 + (Math.random() - 0.5) * LIGHTNESS_JITTER, 0.38, 0.82)
  const c = clamp(maxChromaFor(l, h, gamut) * (0.65 + Math.random() * 0.28), 0.08, 0.32)
  return toHex({ l, c, h })
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

/**
 * A default name for a palette created from a colour rather than from an
 * ordinal. Someone pasting eight brand colours wants to see `ff5722`, not
 * `palette 4` — and it cannot collide with a count that has drifted out of
 * step with the stack after a deletion.
 */
function nameForBase(base: string): string {
  return nameForColor(base)
}

/**
 * Whether a name looks derived from the colour rather than typed by a person.
 *
 * Only ever asked of a link or a saved document written before `nameCustom`
 * travelled alongside the name; anything newer states the answer outright.
 * The trailing ordinal is stripped first because `uniqueName` appends one when
 * two palettes land on the same colour, and `Red 2` is still a derived name.
 */
function looksDerived(name: string, base: string): boolean {
  return name === 'brand' || name.replace(/ \d+$/, '') === nameForBase(base)
}

/** `name`, or the first `name 2`, `name 3` … not already spoken for. Records
 *  whatever it hands out, so a batch cannot collide with itself. */
function uniqueName(taken: Set<string>, name: string): string {
  let candidate = name
  for (let n = 2; taken.has(candidate); n++) candidate = `${name} ${n}`
  taken.add(candidate)
  return candidate
}

export function documentReducer(state: DocumentState, action: DocumentAction): DocumentState {
  switch (action.type) {
    case 'syncChannel': {
      if (state.palettes.length < 2) return state
      const current = selectedEntry(state)
      const sourceCurve = current.state.config[action.key]
      // No list at all means the whole document. An empty list means nobody
      // was picked, which is a different thing and must change nothing.
      const chosen = action.to && new Set(action.to)
      if (chosen && chosen.size === 0) return state
      const palettes = state.palettes.map((entry) =>
        entry.id === current.id || (chosen && !chosen.has(entry.id))
          ? entry
          : applyChannelSync(entry, action.key, sourceCurve, state.gamut),
      )
      return sameStack(state, palettes)
    }

    case 'setGamut': {
      const nextGamut = parseGamut(action.value)
      if (!nextGamut || nextGamut === state.gamut) return state
      const palettes = state.palettes.map((entry) => {
        const next = paletteReducer(entry.state, { type: 'regamut' }, nextGamut)
        return next === entry.state ? entry : { ...entry, state: next }
      })
      return { ...state, gamut: nextGamut, palettes }
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

    case 'setPaletteSteps': {
      const steps = clamp(Math.round(action.value), MIN_STEPS, MAX_STEPS)
      const target = state.palettes.find((entry) => entry.id === action.id)
      if (!target || target.state.config.steps === steps) return state
      const next = paletteReducer(target.state, { type: 'setSteps', value: steps }, state.gamut)
      if (next === target.state) return state
      return replaceEntry(state, action.id, (entry) => ({ ...entry, state: next }))
    }

    case 'setStepsLocked': {
      const stepsLocked = action.value
      if (stepsLocked === state.stepsLocked) return state
      if (stepsLocked) {
        // When locking, synchronize all palettes to the currently selected palette's step count
        const currentSteps = selectedEntry(state).state.config.steps
        const palettes = state.palettes.map((entry) => {
          if (entry.state.config.steps === currentSteps) return entry
          const next = paletteReducer(
            entry.state,
            { type: 'setSteps', value: currentSteps },
            state.gamut,
          )
          return { ...entry, state: next }
        })
        return { ...state, stepsLocked: true, palettes }
      }
      return { ...state, stepsLocked: false }
    }

    case 'palette': {
      if (action.action.type === 'setSteps' && state.stepsLocked) {
        return documentReducer(state, { type: 'setSteps', value: action.action.value })
      }
      const current = selectedEntry(state)
      const next = paletteReducer(current.state, action.action, state.gamut)
      if (next === current.state) return state

      // A palette still carrying the name this app gave it is really showing
      // its colour, so picking a new base renames it to match. Once someone
      // has typed a name of their own it is theirs, and no edit overwrites it.
      //
      // Only once the base parses, though. The field keeps half-typed input so
      // the designer can finish the hex, and the name holds its last good
      // colour the way the ramp does rather than flickering through the
      // fallback on `#`, `#1`, `#1e`…
      if (
        action.action.type === 'setBase' &&
        !current.nameCustom &&
        parseToOklch(next.config.base) !== null
      ) {
        // Every other palette's name is spoken for; this one's is being
        // replaced, so it is not counted against itself.
        const taken = new Set(
          state.palettes.filter((entry) => entry.id !== current.id).map((entry) => entry.name),
        )
        const name = uniqueName(taken, nameForBase(next.config.base))
        return replaceEntry(state, current.id, (entry) => ({ ...entry, name, state: next }))
      }

      return replaceEntry(state, current.id, (entry) => ({ ...entry, state: next }))
    }

    case 'add': {
      // Unparseable bases are dropped rather than kept. `createPalette` stores
      // the raw string while falling back to violet for the curves, which is
      // right for the base *field* — the designer is mid-keystroke and can
      // finish typing — but wrong here: a batch has no field to correct, so a
      // bad string would persist through storage and links forever.
      const usable = action.bases
        .map((entry) => ({ ...entry, base: entry.base.trim() }))
        .filter((entry) => parseToOklch(entry.base) !== null)
        .slice(0, Math.max(0, MAX_PALETTES - state.palettes.length))
      if (!usable.length) return state

      const steps = selectedEntry(state).state.config.steps
      // Seeded with the names already in the document and added to as the batch
      // runs. `palettes.length` cannot grow inside one reducer call, so an
      // ordinal scheme would hand every palette in the batch the same name —
      // and identical names make identical link segments, which the merge in
      // storage.ts de-dupes into one.
      const taken = new Set(state.palettes.map((entry) => entry.name))
      const entries = usable.map((entry) =>
        makeEntry(
          entry.base,
          uniqueName(taken, entry.name || nameForBase(entry.base)),
          steps,
          state.gamut,
          Boolean(entry.name),
        ),
      )

      return {
        ...state,
        palettes: [...state.palettes, ...entries],
        selectedId: entries[0].id,
      }
    }

    case 'new': {
      const currentConfig = selectedEntry(state).state.config
      const currentSteps = currentConfig.steps
      const base = steppedBase(currentConfig, state.gamut)
      const taken = new Set(state.palettes.map((entry) => entry.name))
      const entry = makeEntry(
        base,
        uniqueName(taken, nameForBase(base)),
        currentSteps,
        state.gamut,
        false,
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
      return replaceEntry(state, action.id, (entry) => {
        // Typing a name claims it: from here on the palette keeps it, whatever
        // the base becomes. Clearing the field is how you hand it back — the
        // derived name returns and starts following the colour again.
        const nameCustom = action.name.trim().length > 0
        const name = nameCustom ? action.name : nameForBase(entry.state.config.base)
        return entry.name === name && entry.nameCustom === nameCustom
          ? entry
          : { ...entry, name, nameCustom }
      })
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
  if (action.type === 'setPaletteSteps') {
    return `steps:${action.id}`
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
