import { useEffect, useState } from 'react'
import { CHANNEL_ORDER } from './color/curve'
import { FORMATS, parseToOklch, toHex, type Format } from './color/oklch'
import { baseIndexFor, FALLBACK_BASE, MAX_STEPS, MIN_STEPS } from './color/presets'
import { countDuplicateSteps } from './color/ramp'
import { usePalette } from './state/usePalette'
import { decodePalette, encodePalette } from './state/url'
import { BaseColorInput } from './ui/BaseColorInput'
import { CurvePanel } from './ui/CurvePanel'
import { ExportPanel } from './ui/ExportPanel'
import { RampStrip } from './ui/RampStrip'
import { useCopy } from './ui/useCopy'

/** Read once, at mount. Guarded so the tree also renders without a DOM. */
function readSharedPalette() {
  if (typeof window === 'undefined') return null
  return decodePalette(window.location.hash)
}

export function App() {
  const [restored] = useState(readSharedPalette)
  const palette = usePalette(restored?.config ?? FALLBACK_BASE)
  const [name, setName] = useState(restored?.name ?? 'brand')
  const [format, setFormat] = useState<Format>('hex')
  const [dark, setDark] = useState(false)
  const { copy, copied } = useCopy()

  useEffect(() => {
    document.documentElement.dataset.canvas = dark ? 'dark' : 'light'
  }, [dark])

  // Keep the address bar in step with the palette, without stacking up a
  // history entry for every pixel of a curve drag.
  useEffect(() => {
    const hash = `#${encodePalette(palette.config, name)}`
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash)
    }
  }, [palette.config, name])

  const parsedBase = parseToOklch(palette.config.base)
  const duplicates = countDuplicateSteps(palette.ramp)
  const measuredIndex = parsedBase
    ? baseIndexFor(parsedBase, palette.config.steps)
    : palette.config.baseIndex

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>colors.pantoine.com — tints &amp; shades</h1>
          <p>
            Every step is computed in OKLCH, so the ramp is perceptually even and
            lightness, chroma and hue are yours to shape.
          </p>
        </div>
        <span className="badge badge--solid">OKLCH</span>
      </header>

      <div className="controls">
        <BaseColorInput
          value={palette.config.base}
          resolvedHex={toHex(parsedBase ?? parseToOklch(FALLBACK_BASE)!)}
          valid={parsedBase !== null}
          onChange={palette.setBase}
        />

        <label className="field">
          <span>Steps</span>
          <input
            type="number"
            min={MIN_STEPS}
            max={MAX_STEPS}
            value={palette.config.steps}
            onChange={(event) => palette.setSteps(Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span>Base at</span>
          <select
            value={palette.config.baseIndex}
            onChange={(event) => palette.setBaseIndex(Number(event.target.value))}
            title="Which step carries your base colour. Moving it redistributes lightness across the ramp."
          >
            {palette.ramp.map((swatch) => (
              <option key={swatch.index} value={swatch.index}>
                {swatch.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={palette.config.baseLocked ? 'is-on' : undefined}
          aria-pressed={palette.config.baseLocked}
          onClick={() => palette.setBaseLocked(!palette.config.baseLocked)}
          title={
            palette.config.baseLocked
              ? 'Curve edits are being corrected so they cannot move the base colour'
              : 'Pin the base colour so curve edits cannot change it'
          }
        >
          {palette.config.baseLocked ? 'Base locked' : 'Lock base'}
        </button>

        <label className="field">
          <span>Click copies</span>
          <select value={format} onChange={(event) => setFormat(event.target.value as Format)}>
            {FORMATS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <span className="spacer" />

        <button
          type="button"
          onClick={() => setDark((on) => !on)}
          title="Judge the ramp against the other ground"
        >
          {dark ? 'Light canvas' : 'Dark canvas'}
        </button>

        <button
          type="button"
          disabled={!palette.edited}
          onClick={palette.rederive}
          title="Throw away every curve edit and rebuild the ramp from the base colour"
        >
          Re-derive
        </button>
      </div>

      {duplicates > 0 && (
        <p className="notice">
          {duplicates === 1 ? '1 step is' : `${duplicates} steps are`} identical to
          the one before. Holding the base at{' '}
          <strong>{palette.ramp[palette.config.baseIndex]?.label}</strong> squeezes
          the ramp toward one end — move it nearer{' '}
          <strong>{palette.ramp[measuredIndex]?.label}</strong>, where this colour&rsquo;s
          own lightness sits, or widen the lightness Start and End.
        </p>
      )}

      <RampStrip ramp={palette.ramp} format={format} copiedKey={copied} onCopy={copy} />

      <div className="curves">
        {CHANNEL_ORDER.map((key) => (
          <CurvePanel
            key={key}
            channelKey={key}
            curve={palette.config[key]}
            swatches={palette.ramp}
            lockedIndex={palette.config.baseLocked ? palette.config.baseIndex : undefined}
            onChange={(curve, moved) => palette.setCurve(key, curve, moved)}
            onEndpoint={(end, value) => palette.setEndpoint(key, end, value)}
            onReset={() => palette.resetCurve(key)}
          />
        ))}

        <ExportPanel
          ramp={palette.ramp}
          config={palette.config}
          name={name}
          onName={setName}
        />
      </div>

      <p className="footnote">
        Click a swatch to copy it. Drag the round handles, or focus one and use the
        arrow keys (hold shift for bigger steps). A notched corner means the curve
        asked for more chroma than sRGB can show, and the colour was mapped to the
        nearest one it can — hue held, chroma reduced.
      </p>
    </div>
  )
}
