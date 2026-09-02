import { useCallback, useMemo, useReducer } from 'react'
import { CHANNELS, clamp, clampCurve, sampleCurve, type ChannelKey, type Curve } from '../color/curve'
import { parseToOklch } from '../color/oklch'
import {
  createPalette,
  defaultCurves,
  MAX_STEPS,
  MIN_STEPS,
  type PaletteConfig,
} from '../color/presets'
import { generateRamp, resolveBase, type Swatch } from '../color/ramp'

type State = {
  config: PaletteConfig
  /** Set once any curve is touched. Until then, changing the base colour
   *  re-derives the whole ramp so the typed colour stays exact; afterwards
   *  the designer's curve shape wins and only the hue follows the base. */
  edited: boolean
}

type Action =
  | { type: 'setBase'; value: string }
  | { type: 'setSteps'; value: number }
  | { type: 'setCurve'; key: ChannelKey; curve: Curve }
  | { type: 'setEndpoint'; key: ChannelKey; end: 'start' | 'end'; value: number }
  | { type: 'resetCurve'; key: ChannelKey }
  | { type: 'rederive' }

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

function rederived(base: string, steps: number): PaletteConfig {
  return createPalette(base, steps)
}

function reducer(state: State, action: Action): State {
  const { config } = state

  switch (action.type) {
    case 'setBase': {
      const parsed = parseToOklch(action.value)
      // Unparseable input is kept in the field so the designer can keep
      // typing; the ramp simply holds its last good colour.
      if (!parsed) return { ...state, config: { ...config, base: action.value } }
      if (!state.edited) {
        return { ...state, config: rederived(action.value, config.steps) }
      }
      return {
        ...state,
        config: {
          ...config,
          base: action.value,
          baseIndex: nearestStep(config.lightness, config.steps, parsed.l),
        },
      }
    }

    case 'setSteps': {
      const steps = clamp(Math.round(action.value), MIN_STEPS, MAX_STEPS)
      if (steps === config.steps) return state
      if (!state.edited) return { ...state, config: rederived(config.base, steps) }
      // Hold the base's relative position on the ramp.
      const ratio = config.baseIndex / Math.max(config.steps - 1, 1)
      return {
        ...state,
        config: { ...config, steps, baseIndex: Math.round(ratio * (steps - 1)) },
      }
    }

    case 'setCurve':
      return {
        edited: true,
        config: { ...config, [action.key]: clampCurve(action.curve, CHANNELS[action.key]) },
      }

    case 'setEndpoint': {
      const channel = CHANNELS[action.key]
      const next: Curve = {
        ...config[action.key],
        [action.end]: clamp(action.value, channel.min, channel.max),
      }
      return { edited: true, config: { ...config, [action.key]: next } }
    }

    case 'resetCurve': {
      const fresh = defaultCurves(resolveBase(config), config.steps, config.baseIndex)
      return { ...state, config: { ...config, [action.key]: fresh[action.key] } }
    }

    case 'rederive':
      return { edited: false, config: rederived(config.base, config.steps) }
  }
}

export type PaletteApi = {
  config: PaletteConfig
  ramp: Swatch[]
  edited: boolean
  setBase: (value: string) => void
  setSteps: (value: number) => void
  setCurve: (key: ChannelKey, curve: Curve) => void
  setEndpoint: (key: ChannelKey, end: 'start' | 'end', value: number) => void
  resetCurve: (key: ChannelKey) => void
  rederive: () => void
}

export function usePalette(initial: string | PaletteConfig): PaletteApi {
  const [state, dispatch] = useReducer(reducer, initial, (seed) => ({
    config: typeof seed === 'string' ? createPalette(seed) : seed,
    // A palette restored from a shared link counts as edited: its curves are
    // someone's deliberate work, so changing the base must not discard them.
    edited: typeof seed !== 'string',
  }))

  const ramp = useMemo(() => generateRamp(state.config), [state.config])

  return {
    config: state.config,
    ramp,
    edited: state.edited,
    setBase: useCallback((value: string) => dispatch({ type: 'setBase', value }), []),
    setSteps: useCallback((value: number) => dispatch({ type: 'setSteps', value }), []),
    setCurve: useCallback(
      (key: ChannelKey, curve: Curve) => dispatch({ type: 'setCurve', key, curve }),
      [],
    ),
    setEndpoint: useCallback(
      (key: ChannelKey, end: 'start' | 'end', value: number) =>
        dispatch({ type: 'setEndpoint', key, end, value }),
      [],
    ),
    resetCurve: useCallback((key: ChannelKey) => dispatch({ type: 'resetCurve', key }), []),
    rederive: useCallback(() => dispatch({ type: 'rederive' }), []),
  }
}
