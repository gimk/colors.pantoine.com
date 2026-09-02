import { useEffect, useState } from 'react'
import { FORMATS, GAMUTS, type Format, type Gamut } from './color/oklch'
import { MAX_STEPS, MIN_STEPS } from './color/presets'
import { restoreDocument, saveDocument } from './state/storage'
import { documentUrl } from './state/url'
import { useDocument, type PaletteView } from './state/useDocument'
import { NumberField } from './ui/NumberField'
import { HelpDialog } from './ui/HelpDialog'
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
  const { gamut } = doc
  const [format, setFormat] = useState<Format>('hex')
  const [dark, setDark] = useState(false)
  const [labels, setLabels] = useState(true)
  const [bare, setBare] = useState(false)
  const { copy, copied } = useCopy()

  useEffect(() => {
    document.documentElement.dataset.canvas = dark ? 'dark' : 'light'
  }, [dark])

  // Ctrl/Cmd+Z and Ctrl+Shift+Z (or Ctrl+Y) on the document.
  const { undo, redo } = doc
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      // Inside a field the shortcut belongs to the field: someone fixing a
      // typo in a hex expects the browser's own text undo, not the document's.
      if ((event.target as HTMLElement | null)?.closest('input, select, textarea')) return
      event.preventDefault()
      if (key === 'y' || event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // Clear hash from the address bar so the page URL stays clean and short.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [])

  // Auto-save the document to local storage without writing giant strings to the address bar.
  useEffect(() => {
    const seeds = seedsOf(doc.palettes)
    saveDocument(seeds, doc.selectedIndex, gamut)
  }, [doc.palettes, doc.selectedIndex, gamut])

  const { selected } = doc

  const shareHref =
    typeof window === 'undefined' ? '' : documentUrl(seedsOf(doc.palettes), gamut)

  return (
    <div className={`app${bare ? ' app--bare' : ''}`}>
      <header className="masthead">
        <h1>colors.pantoine.com — tints &amp; shades</h1>
        <span className="spacer" />
        <span className="badge badge--solid">OKLCH</span>
        <HelpDialog gamut={gamut} />
      </header>

      <div className="controls">
        <div className="controls__group">
          {/* First in the bar and filled solid: it is the one thing here that
              adds to the document rather than adjusting it. */}
          <button
            type="button"
            className="is-primary"
            onClick={doc.newPalette}
            title="Add a palette below this one and bring the toolbox to it"
          >
            + New palette
          </button>

          <button
            type="button"
            disabled={!doc.canUndo}
            onClick={undo}
            title="Undo the last edit (Ctrl+Z)"
          >
            Undo
          </button>

          <button
            type="button"
            disabled={!doc.canRedo}
            onClick={redo}
            title="Redo (Ctrl+Shift+Z)"
          >
            Redo
          </button>
        </div>

        <span className="divider" aria-hidden="true" />

        <div className="controls__group">
          <label className="field">
            <span>Click copies</span>
            <select value={format} onChange={(event) => setFormat(event.target.value as Format)}>
              {FORMATS.map((option) => {
                const unavailable =
                  gamut !== 'srgb' && (option === 'hex' || option === 'rgb' || option === 'hsl')
                return (
                  <option
                    key={option}
                    value={option}
                    style={unavailable ? { color: 'var(--muted)' } : undefined}
                  >
                    {option}{unavailable ? ' (sRGB only)' : ''}
                  </option>
                )
              })}
            </select>
          </label>

          <label className="field">
            <span>Gamut</span>
            <select
              value={gamut}
              onChange={(event) => doc.setGamut(event.target.value as Gamut)}
              title="Which display the palette is designed for. Widening it lets every derived chroma curve ask for more."
            >
              {GAMUTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <NumberField
            label="Steps"
            title="Number of steps, across every palette in the document"
            value={selected.config.steps}
            min={MIN_STEPS}
            max={MAX_STEPS}
            step={1}
            decimals={0}
            onCommit={doc.setSteps}
          />
        </div>

        <span className="spacer" />

        <div className="controls__group">
          <button
            type="button"
            className={!labels ? 'is-on' : undefined}
            aria-pressed={!labels}
            onClick={() => setLabels((on) => !on)}
            title="Drop the step names, values and contrast figures, and look at nothing but the colours"
          >
            {labels ? 'Hide labels' : 'Show labels'}
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
      </div>

      <div className="stack">
        {doc.palettes.map((palette) => (
          <PaletteRow
            key={palette.id}
            palette={palette}
            count={doc.palettes.length}
            selected={palette.id === selected.id}
            format={format}
            gamut={gamut}
            labels={labels}
            bare={bare}
            copiedKey={copied}
            onSelect={() => doc.select(palette.id)}
            onRemove={() => doc.remove(palette.id)}
            onReorder={doc.reorder}
            onCopy={copy}
          />
        ))}
      </div>

      {/* Docked, not trailing the selection down the stack. Last in the tree
          so `position: sticky; bottom` pins it to the foot of the window while
          the palettes scroll behind, and it names the palette it is editing
          since it is no longer beside it. */}
      {!bare && <Toolbox doc={doc} shareHref={shareHref} />}
    </div>
  )
}
