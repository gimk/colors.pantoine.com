import { useCallback, useMemo, useReducer } from 'react'
import type { Curve, CurveControl } from '../color/curve'
import type { CurveKey, PaletteConfig } from '../color/presets'
import { generateRamp, type Swatch } from '../color/ramp'
import {
  createDocument,
  documentReducer,
  selectedEntry,
  type DocumentState,
  type PaletteSeed,
} from './document'
import { anyEdited } from './paletteReducer'

/**
 * Ramps are cached against the config object that produced them.
 *
 * Configs are immutable and replaced on every edit, so identity is a sound
 * key, and it means a drag on one palette does not re-map every step of every
 * other palette in the stack through the gamut. A WeakMap so retired configs
 * are collectable.
 */
const ramps = new WeakMap<PaletteConfig, Swatch[]>()

function rampFor(config: PaletteConfig): Swatch[] {
  const cached = ramps.get(config)
  if (cached) return cached
  const ramp = generateRamp(config)
  ramps.set(config, ramp)
  return ramp
}

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
  newPalette: () => void
  select: (id: string) => void
  remove: (id: string) => void
  move: (id: string, by: -1 | 1) => void
  rename: (id: string, name: string) => void
  setBase: (value: string) => void
  setSteps: (value: number) => void
  setBaseIndex: (value: number) => void
  setBaseLocked: (value: boolean) => void
  setCurve: (key: CurveKey, curve: Curve, moved?: CurveControl) => void
  setEndpoint: (key: CurveKey, end: 'start' | 'end', value: number) => void
  resetCurve: (key: CurveKey) => void
  rederive: () => void
}

type Seed = { seeds: PaletteSeed[]; selected: number }

export function useDocument(seed: Seed): DocumentApi {
  const [state, dispatch] = useReducer(
    documentReducer,
    seed,
    (initial): DocumentState => createDocument(initial.seeds, initial.selected),
  )

  const palettes = useMemo(
    () =>
      state.palettes.map((entry) => ({
        id: entry.id,
        name: entry.name,
        config: entry.state.config,
        ramp: rampFor(entry.state.config),
        edited: anyEdited(entry.state.edited),
      })),
    [state.palettes],
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
    newPalette: useCallback(() => dispatch({ type: 'new' }), []),
    select: useCallback((id: string) => dispatch({ type: 'select', id }), []),
    remove: useCallback((id: string) => dispatch({ type: 'remove', id }), []),
    move: useCallback((id: string, by: -1 | 1) => dispatch({ type: 'move', id, by }), []),
    rename: useCallback(
      (id: string, name: string) => dispatch({ type: 'rename', id, name }),
      [],
    ),
    setBase: useCallback(
      (value: string) => dispatch({ type: 'palette', action: { type: 'setBase', value } }),
      [],
    ),
    setSteps: useCallback(
      (value: number) => dispatch({ type: 'palette', action: { type: 'setSteps', value } }),
      [],
    ),
    setBaseIndex: useCallback(
      (value: number) => dispatch({ type: 'palette', action: { type: 'setBaseIndex', value } }),
      [],
    ),
    setBaseLocked: useCallback(
      (value: boolean) => dispatch({ type: 'palette', action: { type: 'setBaseLocked', value } }),
      [],
    ),
    setCurve: useCallback(
      (key: CurveKey, curve: Curve, moved?: CurveControl) =>
        dispatch({ type: 'palette', action: { type: 'setCurve', key, curve, moved } }),
      [],
    ),
    setEndpoint: useCallback(
      (key: CurveKey, end: 'start' | 'end', value: number) =>
        dispatch({ type: 'palette', action: { type: 'setEndpoint', key, end, value } }),
      [],
    ),
    resetCurve: useCallback(
      (key: CurveKey) => dispatch({ type: 'palette', action: { type: 'resetCurve', key } }),
      [],
    ),
    rederive: useCallback(() => dispatch({ type: 'palette', action: { type: 'rederive' } }), []),
  }
}
