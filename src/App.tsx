import { useEffect, useState } from 'react'
import { FORMATS, parseToOklch, type Format } from './color/oklch'
import { baseIndexFor } from './color/presets'
import { countDuplicateSteps } from './color/ramp'
import { restoreDocument, saveDocument } from './state/storage'
import { documentUrl, encodeDocument } from './state/url'
import { useDocument, type PaletteView } from './state/useDocument'
import { PaletteRow } from './ui/PaletteRow'
import { Toolbox } from './ui/Toolbox'
import { useCopy } from './ui/useCopy'

/** Read once, at mount. Guarded so the tree also renders without a DOM. */
function readSession() {
  if (typeof window === 'undefined') return { seeds: [], selected: 0 }
  return restoreDocument(window.location.hash)
}

/** What the address bar and storage both hold: every palette, in order. */
const seedsOf = (palettes: PaletteView[]) =>
  palettes.map((entry) => ({ config: entry.config, name: entry.name }))

export function App() {
  const [session] = useState(readSession)
  const doc = useDocument(session)
  const [format, setFormat] = useState<Format>('hex')
  const [dark, setDark] = useState(false)
  const [seamless, setSeamless] = useState(false)
  const [bare, setBare] = useState(false)
  const { copy, copied } = useCopy()

  useEffect(() => {
    document.documentElement.dataset.canvas = dark ? 'dark' : 'light'
  }, [dark])

  // Keep the address bar and the saved document in step, without stacking up a
  // history entry for every pixel of a curve drag.
  useEffect(() => {
    const seeds = seedsOf(doc.palettes)
    const hash = `#${encodeDocument(seeds)}`
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash)
    }
    saveDocument(seeds, doc.selectedIndex)
  }, [doc.palettes, doc.selectedIndex])

  const { selected } = doc
  const parsedBase = parseToOklch(selected.config.base)
  const duplicates = countDuplicateSteps(selected.ramp)
  const measuredIndex = parsedBase
    ? baseIndexFor(parsedBase, selected.config.steps)
    : selected.config.baseIndex

  const shareHref = typeof window === 'undefined' ? '' : documentUrl(seedsOf(doc.palettes))

  return (
    <div className={`app${bare ? ' app--bare' : ''}`}>
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
        <button
          type="button"
          onClick={doc.newPalette}
          title="Add a palette below this one and bring the toolbox to it"
        >
          New palette
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
          onClick={() => setSeamless((on) => !on)}
          title="A rule beside a colour changes how you read it. Drop them to see the steps meet."
        >
          {seamless ? 'Show dividers' : 'Hide dividers'}
        </button>

        <button
          type="button"
          className={bare ? 'is-on' : undefined}
          aria-pressed={bare}
          onClick={() => setBare((on) => !on)}
          title="Put every tool away and look at nothing but the palettes"
        >
          {bare ? 'Show tools' : 'Hide tools'}
        </button>

        <button
          type="button"
          onClick={() => setDark((on) => !on)}
          title="Judge the ramp against the other ground"
        >
          {dark ? 'Light canvas' : 'Dark canvas'}
        </button>
      </div>

      <div className="stack">
        {doc.palettes.map((palette, index) => (
          <div key={palette.id} className="stack__item">
            <PaletteRow
              palette={palette}
              index={index}
              count={doc.palettes.length}
              selected={palette.id === selected.id}
              format={format}
              seamless={seamless}
              bare={bare}
              copiedKey={copied}
              onSelect={() => doc.select(palette.id)}
              onRemove={() => doc.remove(palette.id)}
              onMove={(by) => doc.move(palette.id, by)}
              onCopy={copy}
            />
            {/* The toolbox follows the selection down the stack, so the
                controls are always next to the ramp they act on. */}
            {!bare && palette.id === selected.id && (
              <Toolbox doc={doc} shareHref={shareHref} />
            )}
          </div>
        ))}
      </div>

      {!bare && (
        <p className="footnote">
          Click a swatch to copy it, or click another palette to bring the toolbox to
          it. Drag the round handles, or focus one and use the arrow keys (hold shift
          for bigger steps). A notched corner means the curve asked for more chroma
          than sRGB can show, and the colour was mapped to the nearest one it can —
          hue held, chroma reduced. Your palettes are saved in this browser, and the
          address bar holds all of them, so a link carries the whole set.
        </p>
      )}

      {/* Out of flow, and last in the tree. It comes and goes mid-drag as the
          ramp squeezes and relaxes, so anything in flow here would shove the
          curve you are dragging up and down under the pointer. */}
      {!bare && duplicates > 0 && (
        <p className="notice" role="status">
          {duplicates === 1 ? '1 step is' : `${duplicates} steps are`} identical to
          the one before in “{selected.name}”. Holding the base at{' '}
          <strong>{selected.ramp[selected.config.baseIndex]?.label}</strong> squeezes
          the ramp toward one end — move it nearer{' '}
          <strong>{selected.ramp[measuredIndex]?.label}</strong>, where this colour&rsquo;s
          own lightness sits, or widen the lightness Start and End.
        </p>
      )}
    </div>
  )
}
