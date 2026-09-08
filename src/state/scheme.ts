import { clamp } from '../color/curve'
import type { HarmonyId } from '../color/harmony'
import { normalizeHue, type Gamut, type Oklch } from '../color/oklch'
import {
  AUTO_RULE,
  DEFAULT_SLOTS,
  generateScheme,
  MAX_SLOTS,
  MIN_SLOTS,
  type ProfileSetting,
  type RuleId,
  type Slot,
} from '../color/scheme'
import { mulberry32 } from './random'

/**
 * A scheme is a short, ordered run of flat colours, some of them held.
 *
 * Kept apart from the palette document rather than folded into it. The two are
 * not the same object: a document is up to twenty-four curve-driven ramps, a
 * scheme is five colours, and `locked` has no home on a palette. More to the
 * point, they want different undo stacks — a spacebar press in this mode must
 * not be able to re-roll the base underneath curves somebody spent an hour on.
 * What joins them is an explicit handoff in each direction, not shared state.
 */

export type SchemeState = {
  slots: Slot[]
  /** What the rule control is set to, which may be `auto`. */
  rule: RuleId
  /**
   * The rule the last roll actually used, or `null` for colours that were not
   * rolled in this session — loaded from a link, or seeded from the document.
   *
   * Held separately so `auto` can stay `auto`: overwriting `rule` with the
   * roll would silently pin the control to whatever came up first. This is
   * only ever displayed. It is how the board answers "why do these go
   * together" for a scheme nobody chose a rule for, and saying nothing is the
   * right answer for colours that never came out of a rule at all.
   */
  rolled: HarmonyId | null
  profile: ProfileSetting
}

export type SchemeAction =
  /** The seed is rolled by the caller, not in here: a reducer stays pure, and
   *  an undo has to replay to the same colours it produced the first time. */
  | { type: 'generate'; seed: number }
  | { type: 'toggleLock'; id: string }
  | { type: 'setColor'; id: string; color: Oklch }
  /** `at` is a boundary, 0 through length: the index the new slot lands on. */
  | { type: 'add'; at?: number }
  | { type: 'remove'; id: string }
  | { type: 'reorder'; sourceId: string; targetId: string }
  | { type: 'setRule'; value: RuleId }
  | { type: 'setProfile'; value: ProfileSetting }
  | { type: 'setCount'; value: number }
  /** Replace the whole scheme, from a link, from storage, or from the palette
   *  document. Locks come along, since a seeded slot is one you chose. */
  | { type: 'load'; slots: Slot[] }

let nextId = 0

/**
 * Distinct per evaluation of this module, which matters only in development.
 *
 * A bare counter resets when the dev server hot-replaces this file, while the
 * reducer's state survives the reload — so the next slot created is handed an
 * id an existing slot is already using. Two bars then share a React key, and
 * reconciliation puts the new colour somewhere other than where it was
 * inserted, which looks for all the world like the insert going to the wrong
 * place. The reducer is right; the keys were lying about which bar was which.
 */
const RUN = Math.random().toString(36).slice(2, 7)

/** Per-session handles for React keys and lock targets, never persisted — the
 *  same contract palette ids have in `document.ts`. */
const makeId = () => `s${RUN}-${++nextId}`

export const newSlot = (color: Oklch, locked = false): Slot => ({
  id: makeId(),
  color,
  locked,
})

/**
 * The scheme a fresh session opens on.
 *
 * Rolled rather than hard-coded. The whole mode is a generator, and opening it
 * on the same five colours every time would say the opposite.
 */
export function createScheme(
  slots: Slot[] = [],
  rule: RuleId = AUTO_RULE,
  profile: ProfileSetting = 'even',
  gamut: Gamut = 'srgb',
  seed = Date.now(),
): SchemeState {
  if (slots.length) {
    return { slots, rule, rolled: null, profile }
  }
  const blank = Array.from({ length: DEFAULT_SLOTS }, () =>
    newSlot({ l: 0.6, c: 0.1, h: 0 }),
  )
  const rolled = generateScheme(blank, rule, profile, gamut, mulberry32(seed))
  return { slots: rolled.slots, rule, rolled: rolled.rule, profile }
}

const indexOfId = (state: SchemeState, id: string) =>
  state.slots.findIndex((slot) => slot.id === id)

/** Midway round the shorter arc, so blending 350° and 10° gives 0° and not 180°. */
function meetHue(a: number, b: number): number {
  const gap = ((b - a + 540) % 360) - 180
  return normalizeHue(a + gap / 2)
}

/**
 * A colour for a slot being inserted at `at`, before anything is rolled into it.
 *
 * Between two bars it is the two of them met in the middle, so a new colour
 * arrives belonging where it was put rather than interrupting the run — which
 * is the whole reason the insert is at a boundary and not at the end. At
 * either end there is only one neighbour, so it steps away from that one
 * instead. Either way the next generate gives it a hue of its own.
 */
function colorAt(slots: Slot[], at: number): Oklch {
  if (!slots.length) return { l: 0.6, c: 0.12, h: 0 }

  const before = slots[at - 1]?.color
  const after = slots[at]?.color

  if (before && after) {
    return {
      l: (before.l + after.l) / 2,
      c: (before.c + after.c) / 2,
      h: meetHue(before.h, after.h),
    }
  }
  const only = (before ?? after)!
  return { ...only, h: normalizeHue(only.h + (before ? 30 : -30)) }
}

export function schemeReducer(
  state: SchemeState,
  action: SchemeAction,
  gamut: Gamut = 'srgb',
): SchemeState {
  switch (action.type) {
    case 'generate': {
      const next = generateScheme(
        state.slots,
        state.rule,
        state.profile,
        gamut,
        mulberry32(action.seed),
      )
      // Every slot locked means there was nothing to roll. Returning the state
      // it was handed is how the history reducer is told not to record an
      // entry, and it is the truth: pressing space changed nothing. The rule
      // the roll would have used is dropped with it, since no colour on screen
      // came from it and reporting it would be a caption for nothing.
      if (next.slots.every((slot, index) => slot === state.slots[index])) return state
      return { ...state, slots: next.slots, rolled: next.rule }
    }

    case 'toggleLock': {
      const index = indexOfId(state, action.id)
      if (index < 0) return state
      const slots = [...state.slots]
      slots[index] = { ...slots[index], locked: !slots[index].locked }
      return { ...state, slots }
    }

    case 'setColor': {
      const index = indexOfId(state, action.id)
      if (index < 0) return state
      const current = state.slots[index].color
      if (
        current.l === action.color.l &&
        current.c === action.color.c &&
        current.h === action.color.h
      ) {
        return state
      }
      const slots = [...state.slots]
      // Editing a colour by hand locks it. Anything else is a trap: you pick
      // the exact blue you wanted, press space to see what goes with it, and
      // the tool throws it away.
      slots[index] = { ...slots[index], color: action.color, locked: true }
      return { ...state, slots }
    }

    case 'add': {
      if (state.slots.length >= MAX_SLOTS) return state
      const at = clamp(Math.round(action.at ?? state.slots.length), 0, state.slots.length)
      const slots = [...state.slots]
      slots.splice(at, 0, newSlot(colorAt(state.slots, at)))
      return { ...state, slots }
    }

    case 'remove': {
      if (state.slots.length <= MIN_SLOTS) return state
      const index = indexOfId(state, action.id)
      if (index < 0) return state
      return { ...state, slots: state.slots.filter((slot) => slot.id !== action.id) }
    }

    case 'reorder': {
      const from = indexOfId(state, action.sourceId)
      const to = indexOfId(state, action.targetId)
      if (from < 0 || to < 0 || from === to) return state
      const slots = [...state.slots]
      const [moved] = slots.splice(from, 1)
      slots.splice(to, 0, moved)
      return { ...state, slots }
    }

    case 'setRule':
      return action.value === state.rule ? state : { ...state, rule: action.value }

    case 'setProfile':
      return action.value === state.profile ? state : { ...state, profile: action.value }

    case 'setCount': {
      const count = clamp(Math.round(action.value), MIN_SLOTS, MAX_SLOTS)
      if (count === state.slots.length) return state
      if (count < state.slots.length) {
        // Trimmed from the end, which is where `add` puts them.
        return { ...state, slots: state.slots.slice(0, count) }
      }
      const slots = [...state.slots]
      while (slots.length < count) slots.push(newSlot(colorAt(slots, slots.length)))
      return { ...state, slots }
    }

    case 'load':
      // `rolled` goes with the colours it described. Colours arriving from a
      // link or from the palette stack did not come out of a rule, and the
      // last roll's name is not a caption for them.
      return action.slots.length ? { ...state, slots: action.slots, rolled: null } : state
  }
}

/**
 * Which edits belong to the same undo entry.
 *
 * Almost nothing here coalesces, and that is the point of the mode: every
 * press of generate is its own entry, so a run of them can be stepped back
 * through one roll at a time to the one you liked. Only dragging a colour in
 * the picker is a gesture rather than a decision.
 */
export function coalesceKey(action: SchemeAction): string | null {
  return action.type === 'setColor' ? `color:${action.id}` : null
}
