import { useCallback, useMemo, useReducer } from 'react'
import type { HarmonyId } from '../color/harmony'
import { mapToGamut, type Gamut, type Oklch } from '../color/oklch'
import type { ProfileSetting, RuleId, Slot } from '../color/scheme'
import { canRedo, canUndo, initHistory, withHistory } from './history'
import { rollSeed } from './random'
import {
  coalesceKey,
  createScheme,
  schemeReducer,
  type SchemeAction,
  type SchemeState,
} from './scheme'

/** One slot as the board needs it: the colour, and what it looks like here. */
export type SlotView = {
  id: string
  color: Oklch
  locked: boolean
  /** CSS suitable for a background, mapped into the document's gamut. */
  displayColor: string
  /** Nearest sRGB rendition, which is what every export writes. */
  hex: string
  /** The colour the screen actually emits, which is what a vision simulation
   *  and an ink choice both have to reason about. */
  shown: Oklch
  /** True when the display could not give the chroma back. */
  clipped: boolean
}

export type SchemeApi = {
  slots: SlotView[]
  rule: RuleId
  /** The rule the last roll used, for a board that has to explain itself. */
  rolled: HarmonyId | null
  profile: ProfileSetting
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  generate: () => void
  toggleLock: (id: string) => void
  setColor: (id: string, color: Oklch) => void
  /** Insert a colour at a boundary, 0 through length. Defaults to the end. */
  add: (at?: number) => void
  remove: (id: string) => void
  reorder: (sourceId: string, targetId: string) => void
  setRule: (value: RuleId) => void
  setProfile: (value: ProfileSetting) => void
  setCount: (value: number) => void
  load: (slots: Slot[]) => void
  /** The raw state, for encoding into the link and into storage. */
  state: SchemeState
}

type Seed = {
  slots?: Slot[]
  rule?: RuleId
  profile?: ProfileSetting
}

/**
 * The scheme, its history, and everything the board reads off it.
 *
 * The gamut is passed in rather than held: it belongs to the document, since
 * it says which display the work is for, and a second copy of it here could
 * disagree with the one the ramps are mapped through.
 */
export function useScheme(seed: Seed, gamut: Gamut): SchemeApi {
  // Bound to the gamut, so widening the document re-derives every colour the
  // generator is asked for from that point on. Rebuilt when the gamut changes,
  // which is fine: the history reducer is stateless and the stack lives in the
  // reducer's own state, not in the closure.
  const historyReducer = useMemo(
    () =>
      withHistory<SchemeState, SchemeAction>(
        (state, action) => schemeReducer(state, action, gamut),
        { coalesce: coalesceKey },
      ),
    [gamut],
  )

  const [history, dispatch] = useReducer(historyReducer, seed, (initial) =>
    initHistory(createScheme(initial.slots, initial.rule, initial.profile, gamut)),
  )

  const state = history.present

  const send = useCallback(
    (action: SchemeAction) => dispatch({ type: 'do', action, at: Date.now() }),
    [],
  )

  const slots = useMemo(
    () =>
      state.slots.map((slot) => {
        const mapped = mapToGamut(slot.color, gamut)
        return {
          id: slot.id,
          color: slot.color,
          locked: slot.locked,
          displayColor: mapped.displayColor,
          hex: mapped.hex,
          clipped: mapped.clipped,
          // What the display emits, not what was asked for. Every generated
          // colour is inside the gamut by construction, so the two are almost
          // always the same — but a slot picked by hand, or arriving from a
          // link made on a wider display, can still be outside it, and a
          // simulation of a colour the screen never showed simulates nothing.
          shown: {
            l: slot.color.l,
            c: Math.max(0, slot.color.c - mapped.chromaLost),
            h: slot.color.h,
          },
        }
      }),
    [state.slots, gamut],
  )

  return {
    slots,
    rule: state.rule,
    rolled: state.rolled,
    profile: state.profile,
    state,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    // The seed is rolled here and travels in the action, so the reducer stays
    // pure and an undo replays to the colours it produced the first time.
    generate: useCallback(
      () => send({ type: 'generate', seed: rollSeed() }),
      [send],
    ),
    toggleLock: useCallback((id: string) => send({ type: 'toggleLock', id }), [send]),
    setColor: useCallback(
      (id: string, color: Oklch) => send({ type: 'setColor', id, color }),
      [send],
    ),
    add: useCallback((at?: number) => send({ type: 'add', at }), [send]),
    remove: useCallback((id: string) => send({ type: 'remove', id }), [send]),
    reorder: useCallback(
      (sourceId: string, targetId: string) => send({ type: 'reorder', sourceId, targetId }),
      [send],
    ),
    setRule: useCallback((value: RuleId) => send({ type: 'setRule', value }), [send]),
    setProfile: useCallback((value: ProfileSetting) => send({ type: 'setProfile', value }), [send]),
    setCount: useCallback((value: number) => send({ type: 'setCount', value }), [send]),
    load: useCallback((next: Slot[]) => send({ type: 'load', slots: next }), [send]),
  }
}
