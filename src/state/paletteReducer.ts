/* The reducer for one palette. Lifted out of the hook so a document can
   hold several and apply it to whichever one is being edited. */

import {
  CHANNELS,
  clamp,
  clampCurve,
  curvesEqual,
  flat,
  sampleCurve,
  type Curve,
  type CurveControl,
} from '../color/curve'
import { parseToOklch, type Gamut, type Oklch } from '../color/oklch'
import {
  chromaCurveFor,
  createPalette,
  defaultCurves,
  FALLBACK_BASE,
  holdBase,
  lightnessCurveFor,
  MAX_STEPS,
  MIN_STEPS,
  type CurveKey,
  type PaletteConfig,
} from '../color/presets'
import { resolveBase } from '../color/ramp'

const CURVE_KEYS: CurveKey[] = ['lightness', 'chroma', 'hue']

export type Edited = Record<CurveKey, boolean>

export const NOTHING_EDITED: Edited = { lightness: false, chroma: false, hue: false }

export type PaletteState = {
  config: PaletteConfig
  /**
   * Tracked per channel, not as one flag, so moving the base to a different
   * step can rebuild the curves it has to rebuild without throwing away a
   * chroma curve the designer shaped by hand.
   */
  edited: Edited
}

export type PaletteAction =
  | { type: 'setBase'; value: string }
  | { type: 'setSteps'; value: number }
  | { type: 'setBaseIndex'; value: number }
  | { type: 'setBaseLocked'; value: boolean }
  | { type: 'setCurve'; key: CurveKey; curve: Curve; moved?: CurveControl }
  | { type: 'setEndpoint'; key: CurveKey; end: 'start' | 'end'; value: number }
  | { type: 'resetCurve'; key: CurveKey }
  | { type: 'rederive' }
  /** The document's gamut changed under this palette. */
  | { type: 'regamut' }

export const anyEdited = (edited: Edited) => CURVE_KEYS.some((key) => edited[key])

/** Step whose current lightness sits closest to `l`. */
export function nearestStep(curve: Curve, steps: number, l: number): number {
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

/**
 * `gamut` is threaded in rather than read from a module global because it
 * belongs to the document: every derivation that samples a chroma ceiling
 * needs the one the designer is actually looking at.
 */
export function paletteReducer(
  state: PaletteState,
  action: PaletteAction,
  gamut: Gamut = 'srgb',
): PaletteState {
  const { config } = state
  const base = resolveBase(config)

  switch (action.type) {
    case 'setBase': {
      const parsed = parseToOklch(action.value)
      // Unparseable input is kept in the field so the designer can keep
      // typing; the ramp simply holds its last good colour.
      if (!parsed) return { ...state, config: { ...config, base: action.value } }

      if (!anyEdited(state.edited)) {
        if (config.baseLocked) {
          const baseIndex = config.baseIndex
          const lightness = lightnessCurveFor(
            parsed,
            config.steps,
            baseIndex,
            config.lightness.start,
            config.lightness.end,
          )
          const chroma = chromaCurveFor(parsed, config.steps, baseIndex, lightness, gamut)
          const hue = flat(0)
          return {
            ...state,
            config: {
              ...config,
              base: action.value,
              baseIndex,
              lightness,
              chroma,
              hue,
            },
          }
        }
        const fresh = createPalette(action.value, config.steps, gamut)
        return { ...state, config: { ...fresh, baseLocked: config.baseLocked } }
      }

      const baseIndex = config.baseLocked
        ? config.baseIndex
        : nearestStep(config.lightness, config.steps, parsed.l)
      const lightness = state.edited.lightness
        ? config.baseLocked
          ? holdBase(config.lightness, 'lightness', parsed, config.steps, baseIndex)
          : config.lightness
        : lightnessCurveFor(
            parsed,
            config.steps,
            baseIndex,
            config.lightness.start,
            config.lightness.end,
          )

      const chroma = state.edited.chroma
        ? config.baseLocked
          ? holdBase(config.chroma, 'chroma', parsed, config.steps, baseIndex)
          : config.chroma
        : chromaCurveFor(parsed, config.steps, baseIndex, lightness, gamut)

      const hue = state.edited.hue
        ? config.baseLocked
          ? holdBase(config.hue, 'hue', parsed, config.steps, baseIndex)
          : config.hue
        : flat(0)

      return {
        ...state,
        config: {
          ...config,
          base: action.value,
          baseIndex,
          lightness,
          chroma,
          hue,
        },
      }
    }

    case 'setSteps': {
      const steps = clamp(Math.round(action.value), MIN_STEPS, MAX_STEPS)
      if (steps === config.steps) return state
      if (!anyEdited(state.edited)) {
        const fresh = createPalette(config.base, steps, gamut)
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
        : chromaCurveFor(base, config.steps, baseIndex, lightness, gamut)

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
      const fresh = defaultCurves(base, config.steps, config.baseIndex, gamut)
      return {
        edited: { ...state.edited, [action.key]: false },
        config: { ...config, [action.key]: fresh[action.key] },
      }
    }

    case 'regamut': {
      // A gamut change makes an underived chroma curve stale in exactly the
      // way moving the base does: its targets are a fraction of a ceiling
      // that has just changed shape. An edited curve is the designer's and is
      // left alone — Re-derive is how they ask for it to be rebuilt.
      if (state.edited.chroma) return state
      const chroma = chromaCurveFor(base, config.steps, config.baseIndex, config.lightness, gamut)
      if (curvesEqual(chroma, config.chroma)) return state
      return { ...state, config: { ...config, chroma } }
    }

    case 'rederive': {
      const fresh = createPalette(config.base, config.steps, gamut)
      return {
        edited: { ...NOTHING_EDITED },
        config: { ...fresh, baseLocked: config.baseLocked },
      }
    }
  }
}

/**
 * A palette restored from a link or from storage checks which curves
 * were actually customized against the default curves for this base color.
 */
export function initialPaletteState(
  seed: string | PaletteConfig,
  gamut: Gamut = 'srgb',
): PaletteState {
  if (typeof seed === 'string') {
    return {
      config: createPalette(seed, undefined, gamut),
      edited: { ...NOTHING_EDITED },
    }
  }
  const base = parseToOklch(seed.base) ?? parseToOklch(FALLBACK_BASE)!
  const defaults = defaultCurves(base, seed.steps, seed.baseIndex, gamut)
  return {
    config: seed,
    edited: {
      lightness: !curvesEqual(seed.lightness, defaults.lightness),
      chroma: !curvesEqual(seed.chroma, defaults.chroma),
      hue: !curvesEqual(seed.hue, defaults.hue),
    },
  }
}
