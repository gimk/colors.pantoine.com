import { useMemo } from 'react'
import { CHANNEL_ORDER, type Curve, type CurveControl } from '../color/curve'
import { parseToOklch } from '../color/oklch'
import { FALLBACK_BASE, type CurveKey } from '../color/presets'
import { chromaCeilingProfile } from '../color/ramp'
import type { DocumentApi } from '../state/useDocument'
import { BaseColorInput } from './BaseColorInput'
import { CurvePanel } from './CurvePanel'
import { ExportPanel } from './ExportPanel'

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
    <section className="toolbox">
      <header className="toolbox__head">
        <span className="panel__title">Toolbox</span>
        <span className="panel__axis">editing “{selected.name}”</span>
      </header>

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

          <span className="toolbox__separator" aria-hidden="true" />

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

          <span className="toolbox__separator" aria-hidden="true" />

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

          <span className="toolbox__separator" aria-hidden="true" />

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
        </div>

        <span className="spacer" />

        <div className="toolbox__group">
          <button
            type="button"
            disabled={doc.palettes.length < 2}
            onClick={doc.syncAll}
            title={
              doc.palettes.length < 2
                ? 'Requires at least two palettes in the document'
                : 'Make all other palettes match this palette’s lightness, chroma, and hue curves'
            }
          >
            Match all curves
          </button>

          <button
            type="button"
            disabled={!selected.edited}
            onClick={doc.rederive}
            title="Throw away every curve edit and rebuild this ramp from the base colour"
          >
            Re-derive
          </button>
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
