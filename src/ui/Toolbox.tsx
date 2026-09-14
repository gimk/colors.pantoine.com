import { useEffect, useMemo, useState } from 'react'
import { CHANNEL_ORDER, type Curve, type CurveControl } from '../color/curve'
import { parseToOklch } from '../color/oklch'
import { FALLBACK_BASE, MAX_STEPS, MIN_STEPS, type CurveKey } from '../color/presets'
import { chromaCeilingProfile } from '../color/ramp'
import type { DocumentApi, PaletteView } from '../state/useDocument'
import { BaseColorInput } from './BaseColorInput'
import { CurvePanel } from './CurvePanel'
import { NameField } from './NameField'
import { NumberField } from './NumberField'

/* Its own key, not the one the bottom dock wrote. That one held the height of
   a graph in a row of three; this one holds the width of a column of three,
   and a number saved under the old shape means nothing under this one. */
const STORAGE_KEY = 'colors.pantoine.com/toolbox-w'
const DEFAULT_W = 380
const MIN_W = 300
const MAX_W = 560

function initialWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_W
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const val = parseInt(raw, 10)
      if (!isNaN(val) && val >= MIN_W && val <= MAX_W) return val
    }
  } catch {}
  return DEFAULT_W
}

type Props = {
  doc: DocumentApi
  /** The palette being edited. Passed in rather than read off `doc`, because
   *  the document can now be empty and this panel has no meaning without one —
   *  so the caller decides whether there is anything to show. */
  selected: PaletteView
}

/**
 * Everything that edits one palette, in one block that sits directly under it.
 *
 * The base colour settings live here rather than in the top bar because they
 * belong to a palette, not to the document: with a stack of palettes, a base
 * field far from the ramp it drives would be ambiguous.
 */
export function Toolbox({ doc, selected }: Props) {
  const parsedBase = parseToOklch(selected.config.base)
  const [width, setWidth] = useState(initialWidth)
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(width))
    } catch {}
  }, [width])


  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    setIsResizing(true)

    const onPointerMove = (moveEvent: PointerEvent) => {
      // The grip is on the panel's left edge and the panel is pinned right,
      // so dragging towards the stack is what makes it wider.
      const deltaX = startX - moveEvent.clientX
      const nextW = Math.round(Math.max(MIN_W, Math.min(MAX_W, startW + deltaX)))
      setWidth(nextW)
    }

    const onPointerUp = () => {
      setIsResizing(false)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  // Sixty-five bisections per redraw is not free, and the profile only moves
  // when the lightness curve, the hue curve, the base hue or the gamut do —
  // never on a chroma drag, which is when this graph redraws most.
  const ceiling = useMemo(
    () => chromaCeilingProfile(selected.config, doc.gamut),
    [
      selected.config.lightness,
      selected.config.hue,
      selected.config.base,
      selected.config.steps,
      doc.gamut,
    ],
  )

  /** Everything a curve could be copied onto: the stack, less the one it is on. */
  const syncTargets = useMemo(
    () => doc.palettes.filter((palette) => palette.id !== selected.id),
    [doc.palettes, selected.id],
  )

  return (
    <section
      className="toolbox"
      style={{ '--toolbox-w': `${width}px` } as React.CSSProperties}
    >
      <div
        className={`toolbox__resizer${isResizing ? ' is-dragging' : ''}`}
        onPointerDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the toolbox"
        title="Drag to widen the toolbox"
      >
        <span className="toolbox__resizer-grip" />
      </div>
      {/* The grip is the panel's own edge and must not scroll with what it
          sizes, so everything else goes in one scrolling body beside it. */}
      <div className="toolbox__body">
        {/* The name is the panel's title, not a labelled field among five
            others. Everything below answers to one palette, so saying which
            one is the first thing the column does — and it reads as a heading
            until you put a caret in it. */}
        <header className="toolbox__head">
          <span className="toolbox__eyebrow">Palette</span>
          {/* Keyed so switching palettes brings a fresh field rather than
              carrying a half-typed name across to the next one. */}
          <NameField
            key={selected.id}
            name={selected.name}
            onRename={(name) => doc.rename(selected.id, name)}
          />
        </header>

        {/* One column of titled panels — Source, then a channel each. The
            settings up here used to be a grid of six equal tags with no name
            on the group, which read as a preamble to the curves rather than as
            what it is: the thing the curves are derived *from*. */}
        <div className="toolbox__panels">
          <section className="panel panel--source">
            <header className="panel__head">
              <span className="panel__title">Source</span>
            </header>

            <div className="panel__body">
              <BaseColorInput
                value={selected.config.base}
                color={parsedBase ?? parseToOklch(FALLBACK_BASE)!}
                gamut={doc.gamut}
                valid={parsedBase !== null}
                onChange={doc.setBase}
                onGamut={doc.setGamut}
              />

              {/* Steps and position are both counts along the same ramp, so
                  they share a row; the hex above needs the whole width to be
                  read back. */}
              <div className="panel__pair">
                {!doc.stepsLocked && (
                  <NumberField
                    label="Steps"
                    title="Number of steps for this palette"
                    value={selected.config.steps}
                    min={MIN_STEPS}
                    max={MAX_STEPS}
                    step={1}
                    decimals={0}
                    stacked
                    inputClassName="toolbox__input-steps"
                    onCommit={(value) => doc.setPaletteSteps(selected.id, value)}
                  />
                )}

                <label className="field field--stacked">
                  <span className="field__tag">Base position</span>
                  <select
                    className="toolbox__select-step"
                    value={selected.config.baseIndex}
                    onChange={(event) => doc.setBaseIndex(Number(event.target.value))}
                    title="Which step carries your base colour. Moving it redistributes lightness across the ramp."
                  >
                    {/* Counted from one, not the token name. The labels are
                        derived from lightness, so they renumber as the ramp is
                        dragged — a position tells you where on the ramp the
                        base sits, which is what this control is choosing. The
                        value stays the config's own zero-based index. */}
                    {selected.ramp.map((swatch) => (
                      <option key={swatch.index} value={swatch.index}>
                        {swatch.index + 1}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* The two verbs of the group, on one line and equally weighted:
                  they were tagged "Constraint" and "Reset", which named them
                  twice and made two buttons look like two more settings. */}
              <div className="panel__pair">
                <button
                  type="button"
                  className={`toolbox__btn-lock ${selected.config.baseLocked ? 'is-on' : ''}`}
                  aria-pressed={selected.config.baseLocked}
                  onClick={() => doc.setBaseLocked(!selected.config.baseLocked)}
                  title={
                    selected.config.baseLocked
                      ? 'Curve edits are being corrected so they cannot move the base colour'
                      : 'Pin the base colour so curve edits cannot change it'
                  }
                >
                  {selected.config.baseLocked ? 'Base locked' : 'Lock base'}
                </button>
                <button
                  type="button"
                  className="toolbox__btn-rederive"
                  disabled={!selected.edited}
                  onClick={doc.rederive}
                  title="Throw away every curve edit and rebuild this ramp from the base colour"
                >
                  Re-derive
                </button>
              </div>
            </div>
          </section>

        {CHANNEL_ORDER.map((key: CurveKey) => (
          <CurvePanel
            key={key}
            channelKey={key}
            curve={selected.config[key]}
            swatches={selected.ramp}
            lockedIndex={
              selected.config.baseLocked ? selected.config.baseIndex : undefined
            }
            canSync={doc.palettes.length > 1}
            onSync={() => doc.syncChannel(key)}
            syncTargets={syncTargets}
            onSyncTo={(ids) => doc.syncChannel(key, ids)}
            ceiling={key === 'chroma' ? ceiling : undefined}
            onChange={(curve: Curve, moved?: CurveControl) => doc.setCurve(key, curve, moved)}
            onEndpoint={(end, value) => doc.setEndpoint(key, end, value)}
            onReset={() => doc.resetCurve(key)}
          />
        ))}
      </div>
      </div>
    </section>
  )
}
