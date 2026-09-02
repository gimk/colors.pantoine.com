import { useState } from 'react'
import type { Gamut } from '../color/oklch'
import type { Swatch } from '../color/ramp'
import { TEXT_FORMATS } from '../export/formats'
import {
  copyPng,
  downloadPng,
  downloadSvg,
  SIZE_PRESETS,
  toSvg,
  type ImageOptions,
} from '../export/image'
import { useCopy } from './useCopy'

type Props = {
  ramp: Swatch[]
  /** Link that reopens the whole document, curves intact. */
  shareHref: string
  name: string
  /** Named in the output, since `clipped` is relative to it. */
  gamut?: Gamut
}

export function ExportPanel({ ramp, name, shareHref, gamut = 'srgb' }: Props) {
  const { copy, copied } = useCopy()
  const [sizeId, setSizeId] = useState(SIZE_PRESETS[1].id)
  const [labels, setLabels] = useState(false)
  const [imageNote, setImageNote] = useState<string | null>(null)

  const size = SIZE_PRESETS.find((preset) => preset.id === sizeId) ?? SIZE_PRESETS[1]
  const options: ImageOptions = { size: size.size, labels }

  const announce = (message: string) => {
    setImageNote(message)
    window.setTimeout(() => setImageNote(null), 2000)
  }

  return (
    <section className="panel export">
      <header className="panel__head">
        <span className="panel__title">Export</span>
        <span className="panel__axis">{ramp.length} steps</span>
      </header>

      {/* The two gestures that carry almost every hand-off — paste the ramp
          into Figma as pixels, or as layers — with the one option that
          changes what they produce. Everything else is a drawer down. */}
      <div className="export__group">
        <div className="export__buttons">
          <button
            type="button"
            onClick={async () => {
              const ok = await copyPng(ramp, options)
              announce(ok ? 'PNG copied' : 'Clipboard blocked — use download')
            }}
            title="Paste onto a Figma canvas and eyedrop the steps"
          >
            Copy PNG
          </button>
          <button
            type="button"
            onClick={() => copy('svg', toSvg(ramp, options, name))}
            title="Paste into Figma as one named, editable rectangle per step"
          >
            {copied === 'svg' ? 'SVG copied' : 'Copy SVG'}
          </button>
          <label className="field">
            <input
              type="checkbox"
              checked={labels}
              onChange={(event) => setLabels(event.target.checked)}
            />
            <span>Labels</span>
          </label>
        </div>
        <p className="export__hint">
          {imageNote ??
            (labels
              ? 'Labels are baked in — turn them off if you plan to eyedrop this.'
              : 'Flat blocks, no gaps or rules, so a pipette always lands on a real step.')}
        </p>
      </div>

      {/* Native <details>: no state to hold, and the keyboard and screen
          reader behaviour comes for free. Its contents scroll inside
          `drawer__body` rather than growing the panel, so opening it cannot
          push the dock taller and leave the three curve panels beside it
          stretched over empty space. */}
      <details className="drawer">
        <summary>
          <span className="legend">Other formats</span>
        </summary>

        <div className="drawer__body">
          <div className="panel__row">
            <button
              type="button"
              onClick={() => copy('share', shareHref)}
              title="A link that reopens every palette here, with every curve intact"
            >
              {copied === 'share' ? 'Link copied' : 'Copy link'}
            </button>
          </div>

          <div className="export__group">
            <span className="legend">As text</span>
            <div className="export__buttons">
              {TEXT_FORMATS.map((format) => (
                <button
                  key={format.id}
                  type="button"
                  onClick={() => copy(format.id, format.build(ramp, name, gamut))}
                >
                  {copied === format.id ? 'Copied' : format.label}
                </button>
              ))}
            </div>
          </div>

          <div className="export__group">
            <span className="legend">As a file</span>
            <div className="panel__row panel__row--flush">
              <label className="field">
                <span>Size</span>
                <select value={sizeId} onChange={(event) => setSizeId(event.target.value)}>
                  {SIZE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label} · {preset.size}px
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="export__buttons">
              <button type="button" onClick={() => downloadPng(ramp, options, name)}>
                Download PNG
              </button>
              <button type="button" onClick={() => downloadSvg(ramp, options, name)}>
                Download SVG
              </button>
            </div>
            <p className="export__hint">Size applies to the copies above as well.</p>
          </div>
        </div>
      </details>
    </section>
  )
}
