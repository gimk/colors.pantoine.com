import { useCallback, useEffect, useRef, useState } from 'react'
import {
  formatColor,
  FORMATS,
  GAMUTS,
  parseToOklch,
  type Format,
  type Gamut,
} from './color/oklch'
import type { Vision } from './color/vision'
import { DEFAULT_STEPS, MAX_STEPS, MIN_STEPS } from './color/presets'
import { resolveBase } from './color/ramp'
import { MAX_SLOTS, type Slot } from './color/scheme'
import type { Mode } from './state/mode'
import { newSlot } from './state/scheme'
import {
  BLANK_SCHEME,
  restoreDocument,
  restoreMode,
  restoreScheme,
  saveDocument,
  saveMode,
  saveScheme,
} from './state/storage'
import type { DecodedScheme } from './state/url'
import { useDocument, type PaletteView } from './state/useDocument'
import { useReview } from './state/useReview'
import { useScheme } from './state/useScheme'
import { ExportDialog } from './ui/ExportDialog'
import { Masthead } from './ui/Masthead'
import { NewPaletteDialog } from './ui/NewPaletteDialog'
import { NumberField } from './ui/NumberField'
import { PaletteRow } from './ui/PaletteRow'
import { ReviewBoard } from './ui/ReviewBoard'
import { SchemeBoard } from './ui/SchemeBoard'
import { Toolbox } from './ui/Toolbox'
import { useCopy } from './ui/useCopy'

/** Read once, at mount. Guarded so the tree also renders without a DOM. */
function readSession() {
  if (typeof window === 'undefined') {
    // The editor rather than `DEFAULT_MODE`. Without a window there is no link
    // to read and nothing saved to honour, so nothing is being defaulted to —
    // and a DOM-less render is a smoke test, which wants the tree that has
    // something to smoke: a stack of ramps, three curve graphs and a toolbox.
    return { seeds: null, selected: 0, scheme: BLANK_SCHEME, mode: 'ramps' as Mode }
  }
  const { hash } = window.location
  return {
    ...restoreDocument(hash),
    scheme: restoreScheme(hash) ?? BLANK_SCHEME,
    mode: restoreMode(hash),
  }
}

/**
 * The stored scheme as slots.
 *
 * Colours arrive as text because that is what a link carries; anything that
 * will not parse was already dropped by the decoder, so the fallback here is
 * only ever reached by a colour that parses to nothing, and an empty list
 * leaves `createScheme` to roll a fresh one.
 */
function slotsFrom(scheme: DecodedScheme): Slot[] {
  return scheme.colors
    .map((entry, index) => {
      const color = parseToOklch(entry)
      return color ? newSlot(color, scheme.locks[index] ?? false) : null
    })
    .filter((slot): slot is Slot => slot !== null)
}

/** What the address bar and storage both hold: every palette, in order. */
const seedsOf = (palettes: PaletteView[]) =>
  palettes.map((entry) => ({
    config: entry.config,
    name: entry.name,
    nameCustom: entry.nameCustom,
  }))

export function App() {
  const [session] = useState(readSession)
  const doc = useDocument(session)
  const { gamut } = doc
  const [format, setFormat] = useState<Format>('hex')
  const [dark, setDark] = useState(false)
  /**
   * Whose eyes the review board is painted for.
   *
   * Sits here beside the canvas rather than in the board's stored layout,
   * because it is the same kind of thing — a condition the palettes are being
   * judged under — and because the two want the same lifetime: kept while you
   * duck back into the editor to fix what the check turned up, and gone by
   * the next session, so nobody ever opens the tool on a grey board.
   */
  const [vision, setVision] = useState<Vision>('normal')
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
  /**
   * Which half of the tool is up.
   *
   * A third view rather than a flag the editor reads: the scheme board shares
   * the gamut, the format and the eye with the editor and nothing else, so
   * every mode renders its own tree the way the review board already does.
   */
  const [mode, setMode] = useState<Mode>(session.mode)
  const { copy, copied } = useCopy()

  /**
   * The scheme, on its own history.
   *
   * Separate from the document on purpose: a press of Space here rolls five
   * new colours, and if the two shared state that press would re-base every
   * ramp in the stack and take an hour of curve work with it. What joins them
   * is the pair of handoffs below, which are deliberate and one-directional.
   */
  const scheme = useScheme(
    {
      slots: slotsFrom(session.scheme),
      rule: session.scheme.rule,
      profile: session.scheme.profile,
    },
    gamut,
  )

  const layout = useReview(
    doc.palettes.map((palette) => palette.id),
    // The board lays out whatever the document holds, and an empty one holds
    // no step count, so it falls back to the default rather than to nothing.
    doc.selected?.config.steps ?? DEFAULT_STEPS,
  )

  useEffect(() => {
    document.documentElement.dataset.canvas = dark ? 'dark' : 'light'
  }, [dark])

  // Ctrl/Cmd+Z and Ctrl+Shift+Z (or Ctrl+Y), on whichever history is in view.
  // The two modes keep separate stacks, so the shortcut has to follow the eye:
  // undoing on the scheme board must step back a roll, not an edit made in the
  // editor half an hour ago.
  const { undo, redo } = mode === 'scheme' ? scheme : doc
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
    saveDocument(seeds, doc.selectedIndex, gamut, doc.stepsLocked)
  }, [doc.palettes, doc.selectedIndex, gamut, doc.stepsLocked])

  // The scheme saves to a key of its own, so a session that ends on the board
  // opens back onto the colours it ended on rather than on a fresh roll.
  const { state: schemeState } = scheme
  useEffect(() => {
    saveScheme(schemeState.slots, schemeState.rule, schemeState.profile)
  }, [schemeState])

  // And the mode itself, so the tool opens where you left it. Written on every
  // change rather than on the way out: there is no reliable way out of a tab,
  // and a switch is one state change, so this costs a string per click.
  useEffect(() => {
    saveMode(mode)
  }, [mode])

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
  }, [selected?.id, scrollTrigger])

  /**
   * The scheme board, which is the other half of the tool rather than another
   * way of looking at this one. Same treatment as the review board: it
   * replaces the tree, and every hook above still runs, so the document is
   * still saved and still undoable while you are away from it.
   */
  if (mode === 'scheme') {
    return (
      <SchemeBoard
        scheme={scheme}
        mode={mode}
        onMode={setMode}
        format={format}
        onFormat={setFormat}
        gamut={gamut}
        onGamut={doc.setGamut}
        vision={vision}
        onVision={setVision}
        /* One palette per colour, in scheme order, named from the colour the
           way every other derived palette is. The base goes across as
           `oklch()` rather than as hex: a scheme made on a P3 document holds
           colours sRGB cannot write down. */
        onSendToRamps={() => {
          doc.addPalettes(
            scheme.slots.map((slot) => ({ base: formatColor(slot.color, 'oklch') })),
          )
          setMode('ramps')
          triggerScroll()
        }}
        /* One bar's own way over. Same handoff, one color: the scheme is
           left standing, so the board is still there to come back to with
           the other four colors as they were. */
        onSendColorToRamps={(color) => {
          doc.addPalettes([{ base: formatColor(color, 'oklch') }])
          setMode('ramps')
          triggerScroll()
        }}
        /* The other direction, and locked on arrival: a colour you already
           chose and built a ramp from is not one a roll should overwrite. */
        onSeedFromRamps={() =>
          scheme.load(
            doc.palettes
              .slice(0, MAX_SLOTS)
              .map((palette) => newSlot(resolveBase(palette.config), true)),
          )
        }
        copiedKey={copied}
        onCopy={copy}
      />
    )
  }

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
        vision={vision}
        onVision={setVision}
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
      <Masthead mode={mode} onMode={setMode} gamut={gamut} />

      <div className="controls">
        <div className="controls__group">
          {/* First in the bar and filled solid: it is the one thing here that
              adds to the document rather than adjusting it. Both it and the
              quick add stand down while the document is empty, where the same
              pair is the whole of the page. */}
          {selected && (
          <NewPaletteDialog
            palettes={doc.palettes}
            selected={selected}
            gamut={gamut}
            onAdd={(bases) => {
              doc.addPalettes(bases)
              triggerScroll()
            }}
          />
          )}

          {/* The old behaviour, kept as a shortcut. A guessed colour is a poor
              answer for a scheme but a fine one for "just give me another
              ramp", and that is worth not making anyone open a dialog for. */}
          {selected && (
          <button
            type="button"
            onClick={() => {
              doc.newPalette()
              triggerScroll()
            }}
            title="Add a palette in a fresh colour further round the hue wheel, without the dialog"
          >
            + Quick add
          </button>
          )}

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

          {selected && (
          <div className="controls__steps">
            <NumberField
              label="Steps"
              title={
                doc.stepsLocked
                  ? 'Number of steps, shared across every palette in the document'
                  : 'Global steps — lock to synchronize all palettes to this step count'
              }
              value={selected?.config.steps ?? DEFAULT_STEPS}
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
          )}
        </div>

        <span className="spacer" />

        <div className="controls__group">
          {/* Both of these answer to a stack of palettes, so neither has anything
              to say about an empty one. */}
          {selected && (
          <button
            type="button"
            onClick={() => setReview(true)}
            title="Put every tool and every label away and look at the whole document at once, laid out however you arrange it"
          >
            Review
          </button>
          )}

          <button
            type="button"
            onClick={() => setDark((on) => !on)}
            title="Judge the ramp against the other ground"
          >
            {dark ? 'Light canvas' : 'Dark canvas'}
          </button>

          {/* Last in the bar, with Review and the canvas: the three things
              here that answer to the whole document rather than to the
              palette the toolbox happens to be on. */}
          {selected && (
          <ExportDialog
            palettes={doc.palettes}
            gamut={gamut}
            stepsLocked={doc.stepsLocked}
          />
          )}
        </div>
      </div>

      {/* An emptied document is a real state, not an error, so it gets the two
          ways back into one rather than an apology. Centred and on its own,
          because there is nothing else on the page to compete with — and the
          same two controls the bar leads with, which is why the bar drops them
          while this is up rather than offering each of them twice. */}
      {!selected ? (
        <div className="blank">
          <p className="blank__note">No palettes.</p>
          <div className="blank__actions">
            <NewPaletteDialog
              palettes={doc.palettes}
              selected={selected}
              gamut={gamut}
              onAdd={(bases) => {
                doc.addPalettes(bases)
                triggerScroll()
              }}
            />
            <button
              type="button"
              onClick={() => {
                doc.newPalette()
                triggerScroll()
              }}
              title="Start from a colour picked for you"
            >
              + Quick add
            </button>
          </div>
        </div>
      ) : (
      <div className="stack">
        {doc.palettes.map((palette) => (
          <PaletteRow
            key={palette.id}
            palette={palette}
            count={doc.palettes.length}
            selected={palette.id === selected?.id}
            format={format}
            gamut={gamut}
            copiedKey={copied}
            stepsLocked={doc.stepsLocked}
            onStepsChange={(steps) => doc.setPaletteSteps(palette.id, steps)}
            onSelect={() => {
              doc.select(palette.id)
              triggerScroll()
            }}
            onDuplicate={() => {
              doc.duplicate(palette.id)
              triggerScroll()
            }}
            onRemove={() => doc.remove(palette.id)}
            onReorder={doc.reorder}
            onCopy={copy}
          />
        ))}
      </div>
      )}

      {/* Docked, not trailing the selection down the stack. Last in the tree
          so `position: sticky; bottom` pins it to the foot of the window while
          the palettes scroll behind, and it names the palette it is editing
          since it is no longer beside it. Gone entirely on an empty document,
          where it would be a panel of controls for a palette that is not
          there. */}
      {selected && <Toolbox doc={doc} selected={selected} />}
    </div>
  )
}
