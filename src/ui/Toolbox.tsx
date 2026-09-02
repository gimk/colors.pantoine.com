import { CHANNEL_ORDER, type Curve, type CurveControl } from '../color/curve'
import { parseToOklch, toHex } from '../color/oklch'
import { FALLBACK_BASE, type CurveKey } from '../color/presets'
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

  return (
    <section className="toolbox">
      <header className="toolbox__head">
        <span className="panel__title">Toolbox</span>
        <span className="panel__axis">editing “{selected.name}”</span>
      </header>

      <div className="toolbox__controls">
        <label className="field">
          <span>Name</span>
          <input
            type="text"
            value={selected.name}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => doc.rename(selected.id, event.target.value)}
          />
        </label>

        <BaseColorInput
          value={selected.config.base}
          resolvedHex={toHex(parsedBase ?? parseToOklch(FALLBACK_BASE)!)}
          valid={parsedBase !== null}
          onChange={doc.setBase}
        />

        <label className="field">
          <span>Base at</span>
          <select
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

        <button
          type="button"
          className={selected.config.baseLocked ? 'is-on' : undefined}
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

        <span className="spacer" />

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
