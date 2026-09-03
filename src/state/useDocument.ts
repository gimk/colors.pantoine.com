import { useCallback, useMemo, useReducer } from 'react'
import type { Curve, CurveControl } from '../color/curve'
import type { CurveKey, PaletteConfig } from '../color/presets'
import { generateRamp, type Swatch } from '../color/ramp'
import {
  coalesceKey,
  createDocument,
  documentReducer,
  isTransient,
  selectedEntry,
  type BaseSeed,
  type DocumentAction,
  type DocumentState,
  type PaletteSeed,
} from './document'
import type { Gamut } from '../color/oklch'
import { canRedo, canUndo, initHistory, withHistory } from './history'
import { anyEdited } from './paletteReducer'

/**
 * Ramps are cached against the config object that produced them and the active gamut.
 *
 * Configs are immutable and replaced on every edit, so identity is a sound
 * key, and it means a drag on one palette does not re-map every step of every
 * other palette in the stack through the gamut. It also makes undo instant:
 * the snapshot holds the very configs whose ramps are already cached. A
 * WeakMap so retired configs are collectable.
 */
const ramps = new WeakMap<PaletteConfig, Map<Gamut, Swatch[]>>()

function rampFor(config: PaletteConfig, gamut: Gamut = 'srgb'): Swatch[] {
  let byGamut = ramps.get(config)
  if (!byGamut) {
    byGamut = new Map()
    ramps.set(config, byGamut)
  }
  const cached = byGamut.get(gamut)
  if (cached) return cached
  const ramp = generateRamp(config, gamut)
  byGamut.set(gamut, ramp)
  return ramp
}

const historyReducer = withHistory(documentReducer, {
  coalesce: coalesceKey,
  transient: isTransient,
})

/** One palette as the UI needs it: its config, its colours, its identity. */
export type PaletteView = {
  id: string
  name: string
  config: PaletteConfig
  ramp: Swatch[]
  edited: boolean
}

export type DocumentApi = {
  palettes: PaletteView[]
  selected: PaletteView
  /** Index of the selected palette in the stack, for persisting the selection. */
  selectedIndex: number
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  newPalette: () => void
  /** Append one palette per base colour and land on the first of them. */
  addPalettes: (bases: BaseSeed[]) => void
  select: (id: string) => void
  remove: (id: string) => void
  move: (id: string, by: -1 | 1) => void
  reorder: (sourceId: string, targetId: string) => void
  rename: (id: string, name: string) => void
  setBase: (value: string) => void
  setSteps: (value: number) => void
  setPaletteSteps: (id: string, value: number) => void
  stepsLocked: boolean
  setStepsLocked: (value: boolean) => void
  setBaseIndex: (value: number) => void
  setBaseLocked: (value: boolean) => void
  setCurve: (key: CurveKey, curve: Curve, moved?: CurveControl) => void
  setEndpoint: (key: CurveKey, end: 'start' | 'end', value: number) => void
  resetCurve: (key: CurveKey) => void
  rederive: () => void
  syncChannel: (key: CurveKey) => void
  /** The gamut the document is designed for, and what every ramp is mapped to. */
  gamut: Gamut
  setGamut: (value: Gamut) => void
}

type Seed = {
  seeds: PaletteSeed[]
  selected: number
  gamut?: Gamut
  stepsLocked?: boolean
}

export function useDocument(seed: Seed): DocumentApi {
  const [history, dispatch] = useReducer(historyReducer, seed, (initial) =>
    initHistory<DocumentState>(
      createDocument(
        initial.seeds,
        initial.selected,
        initial.gamut ?? 'srgb',
        initial.stepsLocked,
      ),
    ),
  )

  const state = history.present

  /** Every edit goes through here, stamped so coalescing stays pure. */
  const send = useCallback(
    (action: DocumentAction) => dispatch({ type: 'do', action, at: Date.now() }),
    [],
  )

  const palettes = useMemo(
    () =>
      state.palettes.map((entry) => ({
        id: entry.id,
        name: entry.name,
        config: entry.state.config,
        ramp: rampFor(entry.state.config, state.gamut),
        edited: anyEdited(entry.state.edited),
      })),
    [state.palettes, state.gamut],
  )

  const selectedId = selectedEntry(state).id
  const selectedIndex = Math.max(
    palettes.findIndex((entry) => entry.id === selectedId),
    0,
  )

  return {
    palettes,
    selected: palettes[selectedIndex],
    selectedIndex,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    newPalette: useCallback(() => send({ type: 'new' }), [send]),
    addPalettes: useCallback((bases: BaseSeed[]) => send({ type: 'add', bases }), [send]),
    select: useCallback((id: string) => send({ type: 'select', id }), [send]),
    remove: useCallback((id: string) => send({ type: 'remove', id }), [send]),
    move: useCallback((id: string, by: -1 | 1) => send({ type: 'move', id, by }), [send]),
    reorder: useCallback(
      (sourceId: string, targetId: string) => send({ type: 'reorder', sourceId, targetId }),
      [send],
    ),
    rename: useCallback((id: string, name: string) => send({ type: 'rename', id, name }), [send]),
    setBase: useCallback(
      (value: string) => send({ type: 'palette', action: { type: 'setBase', value } }),
      [send],
    ),
    setSteps: useCallback(
      (value: number) => send({ type: 'setSteps', value }),
      [send],
    ),
    setPaletteSteps: useCallback(
      (id: string, value: number) => send({ type: 'setPaletteSteps', id, value }),
      [send],
    ),
    stepsLocked: state.stepsLocked,
    setStepsLocked: useCallback(
      (value: boolean) => send({ type: 'setStepsLocked', value }),
      [send],
    ),
    setBaseIndex: useCallback(
      (value: number) => send({ type: 'palette', action: { type: 'setBaseIndex', value } }),
      [send],
    ),
    setBaseLocked: useCallback(
      (value: boolean) => send({ type: 'palette', action: { type: 'setBaseLocked', value } }),
      [send],
    ),
    setCurve: useCallback(
      (key: CurveKey, curve: Curve, moved?: CurveControl) =>
        send({ type: 'palette', action: { type: 'setCurve', key, curve, moved } }),
      [send],
    ),
    setEndpoint: useCallback(
      (key: CurveKey, end: 'start' | 'end', value: number) =>
        send({ type: 'palette', action: { type: 'setEndpoint', key, end, value } }),
      [send],
    ),
    resetCurve: useCallback(
      (key: CurveKey) => send({ type: 'palette', action: { type: 'resetCurve', key } }),
      [send],
    ),
    rederive: useCallback(() => send({ type: 'palette', action: { type: 'rederive' } }), [send]),
    syncChannel: useCallback((key: CurveKey) => send({ type: 'syncChannel', key }), [send]),
    gamut: state.gamut,
    setGamut: useCallback((value: Gamut) => send({ type: 'setGamut', value }), [send]),
  }
}
