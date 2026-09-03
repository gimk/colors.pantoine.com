import { useCallback, useEffect, useRef, useState } from 'react'
import { FORMATS, GAMUTS, type Format, type Gamut } from './color/oklch'
import { MAX_STEPS, MIN_STEPS } from './color/presets'
import { restoreDocument, saveDocument } from './state/storage'
import { documentUrl } from './state/url'
import { useDocument, type PaletteView } from './state/useDocument'
import { useReview } from './state/useReview'
import { NewPaletteDialog } from './ui/NewPaletteDialog'
import { NumberField } from './ui/NumberField'
import { HelpDialog } from './ui/HelpDialog'
import { PaletteRow } from './ui/PaletteRow'
import { ReviewBoard } from './ui/ReviewBoard'
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
  /**
   * The review board, which is a mode rather than a set of things hidden.
   *
   * It replaced a `Hide labels` and a `Hide tools` toggle that between them
   * could put the editor into four states, only one of which anybody wanted:
   * the one where the tools are away and the labels are off. That is this
   * board, and having it as a mode is what lets it also have a layout —
   * an axis, a spacing, and sizes — which a pair of toggles could not.
   */
  const [review, setReview] = useState(false)
  const { copy, copied } = useCopy()

  const layout = useReview(
    doc.palettes.map((palette) => palette.id),
    doc.selected.config.steps,
  )

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

  const isInitialMount = useRef(true)
  const [scrollTrigger, setScrollTrigger] = useState(0)
  const triggerScroll = useCallback(() => {
    setScrollTrigger((c) => c + 1)
  }, [])

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }

    let rafId: number
    const timer = setTimeout(() => {
      rafId = requestAnimationFrame(() => {
        const rowEl = document.querySelector<HTMLElement>('.prow--selected')
        const toolboxEl = document.querySelector<HTMLElement>('.toolbox')
        if (!rowEl || !toolboxEl) return

        const rowRect = rowEl.getBoundingClientRect()
        const toolboxRect = toolboxEl.getBoundingClientRect()

        // 14px gap above toolbox (accommodates 2px outline + 5px offset + 7px breathing room)
        const GAP_ABOVE_TOOLBOX = 14
        const targetBottom = toolboxRect.top - GAP_ABOVE_TOOLBOX
        const delta = rowRect.bottom - targetBottom

        // Ensure the top of the palette doesn't scroll behind sticky .controls
        const controlsEl = document.querySelector<HTMLElement>('.controls')
        const minTop = controlsEl ? controlsEl.getBoundingClientRect().bottom + 12 : 12

        const scrollAmount = Math.min(delta, rowRect.top - minTop)

        if (Math.abs(scrollAmount) > 2) {
          if (typeof window.scrollBy === 'function') {
            window.scrollBy({ top: scrollAmount, behavior: 'smooth' })
          }
        }
      })
    }, 40)

    return () => {
      clearTimeout(timer)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [selected.id, scrollTrigger])

  const shareHref =
    typeof window === 'undefined' ? '' : documentUrl(seedsOf(doc.palettes), gamut)

  /**
   * The board is a different page, not the editor with things switched off,
   * so it replaces the tree rather than hiding parts of it. Every hook above
   * still runs: reordering a palette on the board is a real document edit, so
   * the undo shortcut and the autosave have to keep working while it is up.
   */
  if (review) {
    return (
      <ReviewBoard
        doc={doc}
        review={layout}
        format={format}
        onFormat={setFormat}
        gamut={gamut}
        dark={dark}
        onDark={() => setDark((on) => !on)}
        onExit={() => setReview(false)}
        copiedKey={copied}
        onCopy={copy}
      />
    )
  }

  return (
    <div className="app">
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
          <NewPaletteDialog
            palettes={doc.palettes}
            selected={selected}
            gamut={gamut}
            onAdd={(bases) => {
              doc.addPalettes(bases)
              triggerScroll()
            }}
          />

          {/* The old behaviour, kept as a shortcut. A fifth of the wheel is a
              poor guess for a scheme but a fine one for "just give me another
              ramp", and that is worth not making anyone open a dialog for. */}
          <button
            type="button"
            onClick={() => {
              doc.newPalette()
              triggerScroll()
            }}
            title="Add a palette a fifth of the way around the hue wheel, without the dialog"
          >
            + Quick add
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

          <div className="controls__steps">
            <NumberField
              label="Steps"
              title={
                doc.stepsLocked
                  ? 'Number of steps, shared across every palette in the document'
                  : 'Global steps — lock to synchronize all palettes to this step count'
              }
              value={selected.config.steps}
              min={MIN_STEPS}
              max={MAX_STEPS}
              step={1}
              decimals={0}
              onCommit={doc.setSteps}
            />
            <button
              type="button"
              className={`controls__btn-lock ${doc.stepsLocked ? 'is-locked' : 'is-unlocked'}`}
              aria-label={doc.stepsLocked ? 'Unlock steps per palette' : 'Lock steps across all palettes'}
              title={
                doc.stepsLocked
                  ? 'Steps are shared across all palettes — click to unlock and customize per palette'
                  : 'Steps are independent per palette — click to lock all palettes to this step count'
              }
              onClick={() => doc.setStepsLocked(!doc.stepsLocked)}
            >
              {doc.stepsLocked ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="11" width="18" height="11" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              ) : (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="11" width="18" height="11" />
                  <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <span className="spacer" />

        <div className="controls__group">
          <button
            type="button"
            onClick={() => setReview(true)}
            title="Put every tool and every label away and look at the whole document at once, laid out however you arrange it"
          >
            Review
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
            copiedKey={copied}
            stepsLocked={doc.stepsLocked}
            onStepsChange={(steps) => doc.setPaletteSteps(palette.id, steps)}
            onSelect={() => {
              doc.select(palette.id)
              triggerScroll()
            }}
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
      <Toolbox doc={doc} shareHref={shareHref} />
    </div>
  )
}
