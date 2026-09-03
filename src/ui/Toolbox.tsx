import { useEffect, useMemo, useState } from 'react'
import { CHANNEL_ORDER, type Curve, type CurveControl } from '../color/curve'
import { parseToOklch } from '../color/oklch'
import { FALLBACK_BASE, type CurveKey } from '../color/presets'
import { chromaCeilingProfile } from '../color/ramp'
import type { DocumentApi } from '../state/useDocument'
import { BaseColorInput } from './BaseColorInput'
import { CurvePanel } from './CurvePanel'
import { ExportPanel } from './ExportPanel'

const STORAGE_KEY = 'colors.pantoine.com/toolbox-graph-h'
const DEFAULT_GRAPH_H = 228
const PANEL_CHROME_H = 108

function initialGraphH(): number {
  if (typeof window === 'undefined') return DEFAULT_GRAPH_H
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const val = parseInt(raw, 10)
      if (!isNaN(val) && val >= 140 && val <= 800) return val
    }
  } catch {}
  return DEFAULT_GRAPH_H
}

type Props = {
  doc: DocumentApi
  shareHref: string
}

/**
 * Everything that edits one palette, in one block that sits directly under it.
 *
 * The base colour settings live here rather than in the top bar because they
 * belong to a palette, not to the document: with a stack of palettes, a base
 * field far from the ramp it drives would be ambiguous.
 */
export function Toolbox({ doc, shareHref }: Props) {
  const { selected } = doc
  const parsedBase = parseToOklch(selected.config.base)
  const [graphH, setGraphH] = useState(initialGraphH)
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(graphH))
    } catch {}
  }, [graphH])

  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = graphH
    setIsResizing(true)

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - startY
      const minH = 160
      const maxH = Math.max(300, window.innerHeight - 200)
      const nextH = Math.round(Math.max(minH, Math.min(maxH, startH - deltaY)))
      setGraphH(nextH)
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

  const panelH = graphH + PANEL_CHROME_H

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

  return (
    <section
      className="toolbox"
      style={{ '--panel-h': `${panelH}px` } as React.CSSProperties}
    >
      <div
        className={`toolbox__resizer${isResizing ? ' is-dragging' : ''}`}
        onPointerDown={handleResizeStart}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize curves and export height"
        title="Drag to resize curves and export panel"
      >
        <span className="toolbox__resizer-grip" />
      </div>
      <div className="toolbox__controls">
        <div className="toolbox__primary">
          <div className="toolbox__param">
            <label className="field field--stacked">
              <span className="field__tag">Name</span>
              <input
                type="text"
                className="toolbox__input-name"
                value={selected.name}
                spellCheck={false}
                autoComplete="off"
                placeholder="Palette name"
                onChange={(event) => doc.rename(selected.id, event.target.value)}
              />
            </label>
          </div>

          <div className="toolbox__param">
            <BaseColorInput
              value={selected.config.base}
              color={parsedBase ?? parseToOklch(FALLBACK_BASE)!}
              gamut={doc.gamut}
              valid={parsedBase !== null}
              onChange={doc.setBase}
              onGamut={doc.setGamut}
            />
          </div>

          <div className="toolbox__param">
            <label className="field field--stacked">
              <span className="field__tag">Base at</span>
              <select
                className="toolbox__select-step"
                value={selected.config.baseIndex}
                onChange={(event) => doc.setBaseIndex(Number(event.target.value))}
                title="Which step carries your base colour. Moving it redistributes lightness across the ramp."
              >
                {selected.ramp.map((swatch) => (
                  <option key={swatch.index} value={swatch.index}>
                    {swatch.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <span className="spacer" />

          <div className="toolbox__param">
            <div className="field field--stacked">
              <span className="field__tag">Constraint</span>
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
            </div>
          </div>

          <div className="toolbox__param">
            <div className="field field--stacked">
              <span className="field__tag">Reset</span>
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
        </div>
      </div>

      <div className="curves">
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
            ceiling={key === 'chroma' ? ceiling : undefined}
            graphH={graphH}
            onChange={(curve: Curve, moved?: CurveControl) => doc.setCurve(key, curve, moved)}
            onEndpoint={(end, value) => doc.setEndpoint(key, end, value)}
            onReset={() => doc.resetCurve(key)}
          />
        ))}

        <ExportPanel
          ramp={selected.ramp}
          name={selected.name}
          gamut={doc.gamut}
          shareHref={shareHref}
        />
      </div>
    </section>
  )
}
