import { useCallback, useMemo, useReducer } from 'react'
import {
  CHANNELS,
  clamp,
  clampCurve,
  sampleCurve,
  type Curve,
  type CurveControl,
} from '../color/curve'
import { parseToOklch, type Oklch } from '../color/oklch'
import {
  chromaCurveFor,
  createPalette,
  defaultCurves,
  holdBase,
  lightnessCurveFor,
  MAX_STEPS,
  MIN_STEPS,
  type CurveKey,
  type PaletteConfig,
} from '../color/presets'
import { generateRamp, resolveBase, type Swatch } from '../color/ramp'

const CURVE_KEYS: CurveKey[] = ['lightness', 'chroma', 'hue']

type Edited = Record<CurveKey, boolean>

const NOTHING_EDITED: Edited = { lightness: false, chroma: false, hue: false }

type State = {
  config: PaletteConfig
  /**
   * Tracked per channel, not as one flag, so moving the base to a different
   * step can rebuild the curves it has to rebuild without throwing away a
   * chroma curve the designer shaped by hand.
   */
  edited: Edited
}

type Action =
  | { type: 'setBase'; value: string }
  | { type: 'setSteps'; value: number }
  | { type: 'setBaseIndex'; value: number }
  | { type: 'setBaseLocked'; value: boolean }
  | { type: 'setCurve'; key: CurveKey; curve: Curve; moved?: CurveControl }
  | { type: 'setEndpoint'; key: CurveKey; end: 'start' | 'end'; value: number }
  | { type: 'resetCurve'; key: CurveKey }
  | { type: 'rederive' }

const anyEdited = (edited: Edited) => CURVE_KEYS.some((key) => edited[key])

/** Step whose current lightness sits closest to `l`. */
function nearestStep(curve: Curve, steps: number, l: number): number {
  const last = Math.max(steps - 1, 1)
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < steps; i++) {
    const distance = Math.abs(sampleCurve(curve, i / last) - l)
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}

/** Re-pin every curve to the base colour. */
function holdAll(config: PaletteConfig, base: Oklch): PaletteConfig {
  const next = { ...config }
  for (const key of CURVE_KEYS) {
    next[key] = holdBase(config[key], key, base, config.steps, config.baseIndex)
  }
  return next
}

function reducer(state: State, action: Action): State {
  const { config } = state
  const base = resolveBase(config)

  switch (action.type) {
    case 'setBase': {
      const parsed = parseToOklch(action.value)
      // Unparseable input is kept in the field so the designer can keep
      // typing; the ramp simply holds its last good colour.
      if (!parsed) return { ...state, config: { ...config, base: action.value } }

      if (!anyEdited(state.edited)) {
        const fresh = createPalette(action.value, config.steps)
        return { ...state, config: { ...fresh, baseLocked: config.baseLocked } }
      }

      const moved: PaletteConfig = {
        ...config,
        base: action.value,
        baseIndex: nearestStep(config.lightness, config.steps, parsed.l),
      }
      return {
        ...state,
        config: config.baseLocked ? holdAll(moved, parsed) : moved,
      }
    }

    case 'setSteps': {
      const steps = clamp(Math.round(action.value), MIN_STEPS, MAX_STEPS)
      if (steps === config.steps) return state
      if (!anyEdited(state.edited)) {
        const fresh = createPalette(config.base, steps)
        return { ...state, config: { ...fresh, baseLocked: config.baseLocked } }
      }
      // Hold the base's relative position on the ramp.
      const ratio = config.baseIndex / Math.max(config.steps - 1, 1)
      return {
        ...state,
        config: { ...config, steps, baseIndex: Math.round(ratio * (steps - 1)) },
      }
    }

    case 'setBaseIndex': {
      const baseIndex = clamp(Math.round(action.value), 0, config.steps - 1)
      if (baseIndex === config.baseIndex) return state

      // Lightness has to be re-solved: which step carries the base colour
      // *is* a statement about how lightness is distributed. The designer's
      // own ramp ends are kept, so Start and End survive the move.
      const lightness = lightnessCurveFor(
        base,
        config.steps,
        baseIndex,
        config.lightness.start,
        config.lightness.end,
      )

      // Chroma targets are derived from lightness, so an untouched chroma
      // curve is stale and gets rebuilt. An edited one is the designer's, so
      // it is only re-pinned to keep the base colour exact.
      const chroma = state.edited.chroma
        ? holdBase(config.chroma, 'chroma', base, config.steps, baseIndex)
        : chromaCurveFor(base, config.steps, baseIndex, lightness)

      const hue = config.baseLocked
        ? holdBase(config.hue, 'hue', base, config.steps, baseIndex)
        : config.hue

      return { ...state, config: { ...config, baseIndex, lightness, chroma, hue } }
    }

    case 'setBaseLocked': {
      const locked = { ...config, baseLocked: action.value }
      // Turning the lock on makes the base exact first, then keeps it that
      // way. Locking a base that has already drifted should not preserve the
      // drift.
      return { ...state, config: action.value ? holdAll(locked, base) : locked }
    }

    case 'setCurve': {
      const clamped = clampCurve(action.curve, CHANNELS[action.key])
      const next = config.baseLocked
        ? holdBase(clamped, action.key, base, config.steps, config.baseIndex, action.moved)
        : clamped
      return {
        edited: { ...state.edited, [action.key]: true },
        config: { ...config, [action.key]: next },
      }
    }

    case 'setEndpoint': {
      const channel = CHANNELS[action.key]
      const proposed: Curve = {
        ...config[action.key],
        [action.end]: clamp(action.value, channel.min, channel.max),
      }
      const next = config.baseLocked
        ? holdBase(proposed, action.key, base, config.steps, config.baseIndex, action.end)
        : proposed
      return {
        edited: { ...state.edited, [action.key]: true },
        config: { ...config, [action.key]: next },
      }
    }

    case 'resetCurve': {
      const fresh = defaultCurves(base, config.steps, config.baseIndex)
      return {
        edited: { ...state.edited, [action.key]: false },
        config: { ...config, [action.key]: fresh[action.key] },
      }
    }

    case 'rederive': {
      const fresh = createPalette(config.base, config.steps)
      return {
        edited: { ...NOTHING_EDITED },
        config: { ...fresh, baseLocked: config.baseLocked },
      }
    }
  }
}

export type PaletteApi = {
  config: PaletteConfig
  ramp: Swatch[]
  edited: boolean
  setBase: (value: string) => void
  setSteps: (value: number) => void
  setBaseIndex: (value: number) => void
  setBaseLocked: (value: boolean) => void
  setCurve: (key: CurveKey, curve: Curve, moved?: CurveControl) => void
  setEndpoint: (key: CurveKey, end: 'start' | 'end', value: number) => void
  resetCurve: (key: CurveKey) => void
  rederive: () => void
}

export function usePalette(initial: string | PaletteConfig): PaletteApi {
  const [state, dispatch] = useReducer(reducer, initial, (seed) => ({
    config: typeof seed === 'string' ? createPalette(seed) : seed,
    // A palette restored from a shared link counts as edited: its curves are
    // someone's deliberate work, so changing the base must not discard them.
    edited:
      typeof seed === 'string'
        ? { ...NOTHING_EDITED }
        : { lightness: true, chroma: true, hue: true },
  }))

  const ramp = useMemo(() => generateRamp(state.config), [state.config])

  return {
    config: state.config,
    ramp,
    edited: anyEdited(state.edited),
    setBase: useCallback((value: string) => dispatch({ type: 'setBase', value }), []),
    setSteps: useCallback((value: number) => dispatch({ type: 'setSteps', value }), []),
    setBaseIndex: useCallback((value: number) => dispatch({ type: 'setBaseIndex', value }), []),
    setBaseLocked: useCallback(
      (value: boolean) => dispatch({ type: 'setBaseLocked', value }),
      [],
    ),
    setCurve: useCallback(
      (key: CurveKey, curve: Curve, moved?: CurveControl) =>
        dispatch({ type: 'setCurve', key, curve, moved }),
      [],
    ),
    setEndpoint: useCallback(
      (key: CurveKey, end: 'start' | 'end', value: number) =>
        dispatch({ type: 'setEndpoint', key, end, value }),
      [],
    ),
    resetCurve: useCallback((key: CurveKey) => dispatch({ type: 'resetCurve', key }), []),
    rederive: useCallback(() => dispatch({ type: 'rederive' }), []),
  }
}
